import chalk from 'chalk'
import ora   from 'ora'
import os    from 'os'
const inquirer  = require('inquirer')
const { spawn } = require('child_process')
const fs        = require('fs')
const path      = require('path')
import { Command }   from 'commander'
import { loadConfig, hasConfig } from './init'
import { ProviderFactory }       from '../providers/provider.factory'
import { LLMMessage }            from '../providers/llm-provider.interface'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT RUN — zero conhecimento embutido, sem RAG de código
//
// DECISÃO ARQUITETURAL: O RAG foi REMOVIDO desta função.
//
// O problema anterior: retrieve() devolvia chunks de TypeScript
// (services, controllers) porque a query fazia match semântico com código.
// O LLM recebia blocos de TypeScript como "contexto" e alucinava comandos
// misturados com sintaxe de código.
//
// A solução: leitura DIRETA dos arquivos de configuração relevantes.
// package.json, turbo.json, nx.json, Makefile — esses arquivos têm
// exatamente o que o LLM precisa para descobrir comandos corretos,
// independente da versão da ferramenta instalada.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// LÊ ARQUIVOS DE CONFIGURAÇÃO DIRETAMENTE DO DISCO
// Sem RAG, sem embeddings — leitura direta e determinística
// ─────────────────────────────────────────────────────────────────────────────

function readConfigFilesForRun(projectRoot: string): string {
  // Arquivos que contêm informação sobre como executar o projeto
  // Ordenados por relevância — os primeiros têm prioridade
  const targets = [
    'package.json',
    'turbo.json',
    'nx.json',
    'lerna.json',
    'pnpm-workspace.yaml',
    'pnpm-workspace.yml',
    'Makefile',
    '.github/workflows/ci.yml',
    '.github/workflows/main.yml',
    '.github/workflows/build.yml',
  ]

  const found: string[] = []

  for (const file of targets) {
    const fullPath = path.join(projectRoot, file)
    if (!fs.existsSync(fullPath)) continue

    try {
      const content   = fs.readFileSync(fullPath, 'utf-8') as string
      const truncated = content.slice(0, 2500)
      found.push(`### ${file}\n\`\`\`\n${truncated}${content.length > 2500 ? '\n...(truncado)' : ''}\n\`\`\``)
    } catch {}
  }

  // Também lê package.json dos workspaces para ver scripts reais dos apps
  for (const wsDir of ['apps', 'packages', 'services', 'libs']) {
    const wsFull = path.join(projectRoot, wsDir)
    if (!fs.existsSync(wsFull)) continue

    try {
      for (const entry of fs.readdirSync(wsFull)) {
        const appPkg = path.join(wsFull, entry, 'package.json')
        if (!fs.existsSync(appPkg)) continue

        try {
          const content   = fs.readFileSync(appPkg, 'utf-8') as string
          const truncated = content.slice(0, 1500)
          found.push(`### ${wsDir}/${entry}/package.json\n\`\`\`\n${truncated}\n\`\`\``)
        } catch {}
      }
    } catch {}
  }

  return found.join('\n\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// LÊ SCRIPTS DIRETOS (para o menu)
// Scripts do package.json raiz — sem placeholders inúteis
// ─────────────────────────────────────────────────────────────────────────────

interface DirectScript {
  label:   string
  command: string
}

function readDirectScripts(projectRoot: string): DirectScript[] {
  const scripts: DirectScript[] = []

  const detectPm = (): string => {
    if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm'
    if (fs.existsSync(path.join(projectRoot, 'yarn.lock')))       return 'yarn'
    if (fs.existsSync(path.join(projectRoot, 'bun.lockb')))       return 'bun'
    return 'npm'
  }

  const pm = detectPm()

  // package.json raiz — pula scripts placeholder
  const pkgPath = path.join(projectRoot, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
        const cmdStr = String(cmd)

        // Pula scripts que são claramente placeholders sem utilidade
        if (
          cmdStr.includes('echo "Error:') ||
          cmdStr === 'true' ||
          cmdStr === 'false' ||
          cmdStr === 'exit 1' ||
          cmdStr.trim() === ''
        ) continue

        scripts.push({ label: name, command: `${pm} run ${name}` })
      }
    } catch {}
  }

  // Makefile — targets diretos
  const makefilePath = path.join(projectRoot, 'Makefile')
  if (fs.existsSync(makefilePath)) {
    try {
      const content  = fs.readFileSync(makefilePath, 'utf-8') as string
      const targets  = (content.match(/^([a-zA-Z][a-zA-Z0-9_-]*):/gm) || [])
        .map((t: string) => t.replace(':', ''))
        .filter((t: string) => !t.startsWith('.'))

      for (const name of targets) {
        scripts.push({ label: `make ${name}`, command: `make ${name}` })
      }
    } catch {}
  }

  return scripts
}

// ─────────────────────────────────────────────────────────────────────────────
// PEDE AO LLM O COMANDO CERTO
// Envia os arquivos de config reais — sem RAG, sem código TypeScript no contexto
// ─────────────────────────────────────────────────────────────────────────────

async function askLLMForCommand(
  intent:      string,
  projectRoot: string,
  config:      any
): Promise<string | null> {
  // Leitura direta dos configs — isso é o que o LLM precisa para descobrir comandos
  const configsContext = readConfigFilesForRun(projectRoot)

  if (!configsContext) return null

  // Mapeamento de nomes de pacotes para caminhos (útil para monorepos)
  let workspacesContext = ''
  if (config.profile.apps && config.profile.apps.length > 0) {
    const mappings = config.profile.apps.map((appPath: string) => {
      try {
        const pkgPath = path.join(projectRoot, appPath, 'package.json')
        const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        return `- Pasta: ${appPath} → Nome do pacote: "${pkg.name}"`
      } catch {
        return `- Pasta: ${appPath} → (sem package.json)`
      }
    })
    workspacesContext = `\nPACOTES DO MONOREPO:\n${mappings.join('\n')}\n`
  }

  // Detecção de SO para gerar comandos compatíveis
  const isWindows = process.platform === 'win32'
  const osHint    = isWindows ? 'Windows (PowerShell)' : 'Linux/Mac (Bash)'

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content:
        `Você descobre comandos de terminal lendo arquivos de configuração de projetos. ` +
        `SO atual: ${osHint}. ` +
        `Arquitetura: ${config.profile.architecturalSummary || 'Não disponível'}. ` +
        `${workspacesContext}\n` +
        `REGRAS:\n` +
        `1. Responda APENAS com o comando exato. Sem explicações, sem markdown.\n` +
        `2. Baseie-se SOMENTE nos arquivos fornecidos — não invente comandos.\n` +
        `3. Se não conseguir determinar o comando pelos arquivos, responda: UNKNOWN\n` +
        `4. Para monorepos, use o comando da ferramenta diretamente (ex: npx turbo run test --filter=@pkg/name)`
    },
    {
      role: 'user',
      content:
        `Arquivos de configuração do projeto:\n${configsContext}\n\n` +
        `Com base nesses arquivos, qual é o comando exato para: ${intent}`
    }
  ]

  try {
    const result = await ProviderFactory.create(config.ai).complete(messages, { temperature: 0.1 })
    if (!result.success || !result.content) return null

    let cmd = result.content.trim()

    // Remove markdown se o LLM ignorou a instrução
    const codeBlock = cmd.match(/```[a-z]*\n?([\s\S]+?)\n?```/i)
    if (codeBlock) cmd = codeBlock[1].trim()

    cmd = cmd.replace(/^`+|`+$/g, '').trim()

    if (cmd === 'UNKNOWN' || cmd.length === 0 || cmd.length > 500) return null
    return cmd

  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALISA ERRO COM LLM
// Usa os configs reais para contextualizar o erro — sem RAG de código
// ─────────────────────────────────────────────────────────────────────────────

async function analyzeError(
  command:     string,
  projectRoot: string,
  config:      any
): Promise<void> {
  const spinner       = ora('Analisando o erro...').start()
  const configContext = readConfigFilesForRun(projectRoot)

  try {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: 'Você analisa erros de terminal e sugere correções. Seja direto e específico.'
      },
      {
        role: 'user',
        content:
          `Projeto: ${config.profile.projectName}\n` +
          `Arquitetura: ${config.profile.architecturalSummary || 'Não disponível'}\n\n` +
          `Arquivos de configuração:\n${configContext}\n\n` +
          `Comando que falhou: "${command}"\n\n` +
          `Analise o provável erro e sugira como corrigir.`
      }
    ]

    const result = await ProviderFactory.create(config.ai).complete(messages, { temperature: 0.1 })
    spinner.stop()

    if (result.success && result.content) {
      console.log(chalk.bold('\n  💡 Análise e Correção:\n'))
      console.log(chalk.white('  ' + result.content.replace(/\n/g, '\n  ')))
      console.log('')
    }
  } catch (err) {
    spinner.fail(`Erro na análise: ${(err as Error).message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export async function runRun(options: { projectRoot?: string } = {}) {
  const projectRoot = options.projectRoot || process.cwd()

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('  ❌ Projeto não inicializado. Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const config = loadConfig(projectRoot)!

  const directScripts = readDirectScripts(projectRoot)

  console.log(chalk.bold.cyan('\n  🔧 Agent Run\n'))
  console.log(chalk.gray(`  ${directScripts.length} script(s) direto(s) disponível(eis)\n`))

  const choices = [
    ...directScripts.map(s => ({ name: s.label, value: s.command })),
    new inquirer.Separator(),
    {
      name:  chalk.cyan('💡 Descrever o que quero fazer (LLM descobre o comando lendo os configs)'),
      value: '__describe__'
    },
    { name: '✏️  Digitar manualmente', value: '__manual__' }
  ]

  const { selected } = await inquirer.prompt([{
    type:     'list',
    name:     'selected',
    message:  'O que executar?',
    choices,
    pageSize: 20
  }])

  let finalCommand = ''

  if (selected === '__manual__') {
    const { cmd } = await inquirer.prompt([{
      type:     'input',
      name:     'cmd',
      message:  'Comando:',
      validate: (v: string) => v.trim().length > 0 || 'Não pode ser vazio'
    }])
    finalCommand = cmd.trim()

  } else if (selected === '__describe__') {
    const { intent } = await inquirer.prompt([{
      type:     'input',
      name:     'intent',
      message:  'Descreva o que quer fazer:',
      validate: (v: string) => v.trim().length > 0 || 'Descreva a intenção'
    }])

    const spinner = ora('Lendo configurações do projeto e descobrindo o comando...').start()
    const cmd     = await askLLMForCommand(intent.trim(), projectRoot, config)
    spinner.stop()

    if (cmd) {
      console.log(chalk.green(`\n  Comando descoberto: ${chalk.white(cmd)}\n`))
      finalCommand = cmd
    } else {
      console.log(chalk.yellow('\n  ⚠️  Não consegui determinar o comando automaticamente.'))
      const { manual } = await inquirer.prompt([{
        type:     'input',
        name:     'manual',
        message:  'Digite manualmente:',
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

  if (!ok) {
    console.log(chalk.gray('\n  Cancelado.\n'))
    process.exit(0)
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)))

  const shellConfig = process.platform === 'win32' ? 'powershell.exe' : true

  const exitCode = await new Promise<number>(resolve => {
    spawn(finalCommand, [], { cwd: projectRoot, stdio: 'inherit', shell: shellConfig })
      .on('close', (code: number) => resolve(code || 0))
      .on('error', () => resolve(1))
  })

  console.log(chalk.gray('  ' + '─'.repeat(50) + '\n'))

  if (exitCode !== 0) {
    console.log(chalk.red(`  ❌ Falhou (código ${exitCode})\n`))

    const { analyze } = await inquirer.prompt([{
      type: 'confirm', name: 'analyze', message: 'Analisar erro com a IA?', default: true
    }])

    if (analyze) await analyzeError(finalCommand, projectRoot, config)

  } else {
    console.log(chalk.green('  ✅ Concluído!\n'))
  }
}

export function runCommand(): Command {
  return new Command('run')
    .description('Executa tarefas do projeto — LLM descobre comandos lendo os configs reais')
    .action(async () => await runRun())
}