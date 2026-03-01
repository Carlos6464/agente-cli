import chalk from 'chalk'
import ora   from 'ora'
const inquirer  = require('inquirer')
const { spawn } = require('child_process')
const fs        = require('fs')
const path      = require('path')
import { Command }   from 'commander'
import { loadConfig, hasConfig } from './init'
import { OllamaProvider }        from '../providers/ollama.provider'
import { LLMMessage }            from '../providers/llm-provider.interface'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT RUN — zero conhecimento embutido
//
// Responsabilidade do TypeScript: ler arquivos do disco e rodar comandos.
// Responsabilidade do LLM: entender as ferramentas, versões e descobrir comandos.
//
// Este arquivo não sabe nada sobre turborepo, nx, pnpm, yarn, prisma,
// docker, ou qualquer outra ferramenta. O LLM descobre tudo lendo
// os arquivos reais do projeto.
// ─────────────────────────────────────────────────────────────────────────────

// Lê todos os arquivos de configuração relevantes do projeto e retorna
// como string para o LLM analisar. Sem interpretar o conteúdo.
function readProjectFiles(projectRoot: string): { name: string; content: string }[] {
  const result: { name: string; content: string }[] = []

  // Lê recursivamente até 2 níveis de profundidade procurando configs
  const scan = (dir: string, depth: number) => {
    if (depth > 2) return
    let entries: string[]
    try { entries = fs.readdirSync(dir) } catch { return }

    for (const entry of entries) {
      if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage'].includes(entry)) continue
      const fullPath = path.join(dir, entry)
      let stat: any
      try { stat = fs.statSync(fullPath) } catch { continue }

      if (stat.isDirectory()) {
        scan(fullPath, depth + 1)
      } else {
        // Lê qualquer arquivo que possa ter informação sobre como rodar o projeto
        const ext = path.extname(entry).toLowerCase()
        const relevant = [
          '.json', '.yaml', '.yml', '.toml', '.ini', '.conf',
          'Makefile', 'Dockerfile', '.env.example', 'Procfile', 'justfile'
        ]
        const isRelevant = relevant.some(r => entry.endsWith(r) || entry === r)
        if (!isRelevant) continue

        try {
          const content = fs.readFileSync(fullPath, 'utf-8') as string
          const relative = fullPath.replace(projectRoot + path.sep, '')
          result.push({ name: relative, content: content.slice(0, 3000) })
        } catch {}
      }
    }
  }

  scan(projectRoot, 0)
  return result
}

// Pede ao LLM para descobrir o comando lendo os arquivos reais
async function askLLMForCommand(
  intent:      string,
  files:       { name: string; content: string }[],
  config:      any
): Promise<string | null> {

  const filesContext = files
    .map(f => `### ${f.name}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n')

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `Você descobre comandos de terminal analisando arquivos de configuração de projetos.
Responda APENAS com o comando exato e completo, pronto para rodar no terminal.
Sem explicações, sem markdown, sem aspas. Se não souber, responda: UNKNOWN`
    },
    {
      role: 'user',
      content: `Projeto: ${config.profile.projectName}

Arquivos de configuração encontrados no projeto:
${filesContext}

Com base nesses arquivos, qual é o comando exato para: ${intent}`
    }
  ]

  try {
    const provider = new OllamaProvider(config.ollama.defaultModel, config.ollama.baseUrl)
    const result   = await provider.complete(messages, { temperature: 0.1 })
    if (!result.success || !result.content) return null
    const cmd = result.content.trim()
    if (cmd === 'UNKNOWN' || cmd.length === 0 || cmd.length > 300) return null
    return cmd
  } catch {
    return null
  }
}

export async function runRun(options: { projectRoot?: string } = {}) {
  const projectRoot = options.projectRoot || process.cwd()

  console.log('')
  console.log(chalk.bold.cyan('  🔧 Agent Run\n'))

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('  ❌ Projeto não inicializado.'))
    console.log(chalk.yellow('  Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const config = loadConfig(projectRoot)!

  // ── Lê os scripts diretos (sem interpretar) ────────────────────────────────

  const directScripts: { label: string; command: string }[] = []

  // package.json — lê scripts como estão, sem transformar
  const pkgPath = path.join(projectRoot, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      // Detecta o package manager lendo os lock files — sem assumir nada
      let pm = 'npm'
      if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) pm = 'pnpm'
      else if (fs.existsSync(path.join(projectRoot, 'yarn.lock')))  pm = 'yarn'
      else if (fs.existsSync(path.join(projectRoot, 'bun.lockb')))  pm = 'bun'

      for (const name of Object.keys(pkg.scripts || {})) {
        directScripts.push({ label: name, command: `${pm} run ${name}` })
      }
    } catch {}
  }

  // Makefile — targets diretos
  const makefilePath = path.join(projectRoot, 'Makefile')
  if (fs.existsSync(makefilePath)) {
    try {
      const content = fs.readFileSync(makefilePath, 'utf-8') as string
      const targets = (content.match(/^([a-zA-Z][a-zA-Z0-9_-]*):/gm) || [])
        .map((t: string) => t.replace(':', ''))
      for (const name of targets) {
        directScripts.push({ label: `make ${name}`, command: `make ${name}` })
      }
    } catch {}
  }

  const choices = [
    ...directScripts.map(s => ({ name: s.label, value: s.command })),
    new inquirer.Separator(),
    { name: chalk.cyan('💡 Descrever o que quero fazer (LLM descobre o comando)'), value: '__describe__' },
    { name: '✏️  Digitar manualmente',                                              value: '__manual__'  },
  ]

  console.log(chalk.gray(`  ${directScripts.length} script(s) disponível(eis)\n`))

  const { selected } = await inquirer.prompt([{
    type: 'list', name: 'selected',
    message: 'O que executar?',
    choices, pageSize: 20
  }])

  let finalCommand = ''

  if (selected === '__manual__') {
    const { cmd } = await inquirer.prompt([{
      type: 'input', name: 'cmd', message: 'Comando:',
      validate: (v: string) => v.trim().length > 0 || 'Não pode ser vazio'
    }])
    finalCommand = cmd.trim()

  } else if (selected === '__describe__') {
    const { intent } = await inquirer.prompt([{
      type: 'input', name: 'intent',
      message: 'Descreva o que quer fazer:',
      validate: (v: string) => v.trim().length > 0 || 'Descreva a intenção'
    }])

    const spinner = ora('Lendo o projeto e descobrindo o comando...').start()
    const files   = readProjectFiles(projectRoot)
    const cmd     = await askLLMForCommand(intent.trim(), files, config)
    spinner.stop()

    if (cmd) {
      console.log(chalk.green(`\n  Comando descoberto: ${chalk.white(cmd)}\n`))
      finalCommand = cmd
    } else {
      console.log(chalk.yellow('\n  Não consegui determinar o comando automaticamente.'))
      const { manual } = await inquirer.prompt([{
        type: 'input', name: 'manual', message: 'Digite manualmente:',
        validate: (v: string) => v.trim().length > 0 || 'Não pode ser vazio'
      }])
      finalCommand = manual.trim()
    }

  } else {
    finalCommand = selected
  }

  // ── Confirma e executa ────────────────────────────────────────────────────

  console.log('')
  console.log(chalk.bold('  Comando:'))
  console.log(chalk.cyan(`  $ ${finalCommand}\n`))

  const { ok } = await inquirer.prompt([{
    type: 'confirm', name: 'ok', message: 'Executar?', default: true
  }])

  if (!ok) { console.log(chalk.gray('\n  Cancelado.\n')); process.exit(0) }

  console.log('')
  console.log(chalk.gray('  ' + '─'.repeat(50)))
  const exitCode = await runLive(finalCommand, projectRoot)
  console.log(chalk.gray('  ' + '─'.repeat(50) + '\n'))

  if (exitCode !== 0) {
    console.log(chalk.red(`  ❌ Falhou (código ${exitCode})\n`))
    const { analyze } = await inquirer.prompt([{
      type: 'confirm', name: 'analyze', message: 'Analisar o erro com LLM?', default: true
    }])
    if (analyze) {
      const spinner  = ora('Analisando...').start()
      const files    = readProjectFiles(projectRoot)
      const filesCtx = files.map(f => `### ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
      const messages: LLMMessage[] = [{
        role: 'system', content: 'Analise o erro e sugira como corrigir. Seja direto e específico.'
      }, {
        role: 'user',
        content: `Projeto: ${config.profile.projectName}\n\nArquivos de config:\n${filesCtx}\n\nComando que falhou: "${finalCommand}"\nCódigo de saída: ${exitCode}\n\nComo corrigir?`
      }]
      const provider = new OllamaProvider(config.ollama.defaultModel, config.ollama.baseUrl)
      const result   = await provider.complete(messages, { temperature: 0.2 })
      spinner.stop()
      if (result.success && result.content) {
        console.log(chalk.bold('\n  💡 Análise:\n'))
        console.log(chalk.white('  ' + result.content.replace(/\n/g, '\n  ')))
        console.log('')
      }
    }
  } else {
    console.log(chalk.green('  ✅ Concluído!\n'))
  }
}

function runLive(command: string, cwd: string): Promise<number> {
  return new Promise(resolve => {
    const proc = spawn(command, [], { cwd, stdio: 'inherit', shell: true })
    proc.on('close', (code: number) => resolve(code || 0))
    proc.on('error', (err: Error) => { console.log(chalk.red(`\n  ${err.message}`)); resolve(1) })
  })
}

export function runCommand(): Command {
  const cmd = new Command('run')
  cmd.description('Executa scripts do projeto — o LLM descobre comandos lendo os arquivos reais')
     .action(async () => { await runRun() })
  return cmd
}