import chalk from 'chalk'
import ora   from 'ora'
import os    from 'os' // Importação do OS para detectar a plataforma
const inquirer  = require('inquirer')
const { spawn } = require('child_process')
const fs        = require('fs')
const path      = require('path')
import { Command }   from 'commander'
import { loadConfig, hasConfig } from './init'
import { ProviderFactory }       from '../providers/provider.factory'
import { LLMMessage }            from '../providers/llm-provider.interface'
import { retrieve }              from '../rag/retriever'

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES AUXILIARES
// ─────────────────────────────────────────────────────────────────────────────

function readProjectFiles(projectRoot: string): { name: string; content: string }[] {
  const result: { name: string; content: string }[] = []
  const scan = (dir: string, depth: number) => {
    if (depth > 2) return
    let entries; try { entries = fs.readdirSync(dir) } catch { return }
    for (const entry of entries) {
      if (['node_modules', '.git', 'dist'].includes(entry)) continue
      const fullPath = path.join(dir, entry)
      if (fs.statSync(fullPath).isDirectory()) scan(fullPath, depth + 1)
      else if (/\.(json|yaml|yml|toml|ini|conf)$/i.test(entry) || ['Makefile', 'Dockerfile'].includes(entry)) {
        try { result.push({ name: fullPath.replace(projectRoot + path.sep, ''), content: fs.readFileSync(fullPath, 'utf-8').slice(0, 3000) }) } catch {}
      }
    }
  }
  scan(projectRoot, 0); return result
}

// O "Cheat Sheet" Dinâmico que blinda qualquer monorepo
function getMonorepoRules(monorepo: string, pm: string): string {
  if (monorepo === 'none' || monorepo === 'unknown') return ''
  
  return `
REGRAS DE EXECUÇÃO EM MONOREPO (Ativo: ${monorepo.toUpperCase()} via ${pm}):
- NUNCA misture argumentos de escopo do gerenciador de pacotes (${pm} --filter / --workspace) com a chamada da ferramenta do monorepo.
- Sempre use a sintaxe oficial e direta da ferramenta via npx:
  * Turborepo: npx turbo run <comando> --filter=<nome_do_pacote>
  * Nx: npx nx run <nome_do_pacote>:<comando>  OU  npx nx <comando> <nome_do_pacote>
  * Lerna: npx lerna run <comando> --scope=<nome_do_pacote>
`.trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// COMUNICAÇÃO COM O LLM (AGORA COM CONSCIÊNCIA DE SISTEMA OPERATIVO)
// ─────────────────────────────────────────────────────────────────────────────

async function askLLMForCommand(intent: string, projectRoot: string, config: any): Promise<string | null> {
  const retrieved = await retrieve(`comando para ${intent} scripts turbo nx lerna package`, projectRoot, { topK: 5 })
  let filesContext = retrieved.success && retrieved.contexts ? retrieved.contexts.map(c => `### ${c.filePath}\n\`\`\`\n${c.content}\n\`\`\``).join('\n\n') : ''
  
  let workspacesContext = ''
  if (config.profile.apps && config.profile.apps.length > 0) {
    const mappings = config.profile.apps.map((appPath: string) => {
      try {
        const pkgPath = path.join(projectRoot, appPath, 'package.json')
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        return `- Pasta: ${appPath} -> Nome exato do pacote: "${pkg.name}"`
      } catch { 
        return `- Pasta: ${appPath} -> (package.json não encontrado)` 
      }
    })
    workspacesContext = `\nPACOTES DO MONOREPO (Use o "Nome exato do pacote" nos filtros da ferramenta):\n${mappings.join('\n')}\n`
  }

  const monorepoRules = getMonorepoRules(config.profile.monorepo, config.profile.packageManager)

  // ---------------------------------------------------------------------------
  // DETECÇÃO DE SISTEMA OPERATIVO
  // ---------------------------------------------------------------------------
  const isWindows = process.platform === 'win32';
  const osName = isWindows ? 'Windows (PowerShell)' : 'Linux/Mac (Bash)';

  const fileCreationRule = isWindows
    ? `3. PARA CRIAR ARQUIVOS NO WINDOWS (PowerShell):
   Use New-Item para criar pastas e arquivos. Use Set-Content com Here-Strings (@" ... "@) para inserir o código.
   Atenção: A aspa dupla de fechamento "@ DEVE ficar no início absoluto da linha!
   Exemplo Correto:
   New-Item -ItemType Directory -Force -Path "app/models" | Out-Null
   Set-Content -Path "app/models/anexo_model.py" -Value @"
from sqlalchemy import Column
"@`
    : `3. PARA CRIAR ARQUIVOS NO LINUX/MAC (Bash):
   Use mkdir -p para pastas e cat com EOF para arquivos.
   Exemplo Correto:
   mkdir -p app/models
   cat << 'EOF' > app/models/anexo_model.py
from sqlalchemy import Column
EOF`;

  const messages: LLMMessage[] = [
    { 
      role: 'system', 
      content: `Você é um Engenheiro de Software Sênior, expert em terminal ${osName} e dev de arquiteturas escaláveis.
Arquitetura atual: ${config.profile.architecturalSummary || 'Desconhecida'}.
${workspacesContext}

REGRAS ESTRITAS E OBRIGATÓRIAS DE TERMINAL:
1. Você DEVE gerar APENAS comandos válidos nativos para ${osName}.
2. NUNCA invente ferramentas que não existem (NÃO use 'create-file', 'append-file', 'write', etc).
${fileCreationRule}
4. PARA MÚLTIPLOS ARQUIVOS OU COMANDOS: Escreva os comandos sequencialmente linha por linha.
5. Responda APENAS com o código puro do terminal, sem formatação markdown (sem envolver em \`\`\`), sem explicações de texto.

${monorepoRules}` 
    },
    { 
      role: 'user', 
      content: `Arquivos relevantes lidos do projeto via RAG:\n${filesContext}\n\nEscreva APENAS o script de terminal (${osName}) para a seguinte ação (linhas separadas sequenciais): ${intent}` 
    }
  ]
  
  try {
    const result = await ProviderFactory.create(config.ai).complete(messages, { temperature: 0.1 })
    if (!result.success || !result.content) return null
    
    let cmd = result.content.trim()
    
    const codeBlockMatch = cmd.match(/```[a-z]*\n([\s\S]+?)\n```/i) || cmd.match(/```([\s\S]+?)```/i)
    if (codeBlockMatch) {
        cmd = codeBlockMatch[1].trim()
    } else {
        cmd = cmd.replace(/`/g, '').trim()
        if (cmd.toLowerCase().startsWith('bash\n')) cmd = cmd.substring(5).trim()
        if (cmd.toLowerCase().startsWith('sh\n')) cmd = cmd.substring(3).trim()
        if (cmd.toLowerCase().startsWith('powershell\n')) cmd = cmd.substring(10).trim()
    }
    
    return cmd
  } catch { return null }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUÇÃO PRINCIPAL DO COMANDO RUN
// ─────────────────────────────────────────────────────────────────────────────

export async function runRun(options: { projectRoot?: string } = {}) {
  const projectRoot = options.projectRoot || process.cwd()
  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('  ❌ Projeto não inicializado. Execute primeiro: agent init\n'))
    process.exit(1)
  }
  
  const config = loadConfig(projectRoot)!

  const directScripts: { label: string; command: string }[] = []
  const pkgPath = path.join(projectRoot, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const pm = config.profile.packageManager || 'npm'
      for (const name of Object.keys(pkg.scripts || {})) directScripts.push({ label: name, command: `${pm} run ${name}` })
    } catch {}
  }

  console.log(chalk.bold.cyan('\n  🔧 Agent Run\n'))
  const { selected } = await inquirer.prompt([{
    type: 'list', name: 'selected', message: 'O que executar?',
    choices: [...directScripts.map(s => ({ name: s.label, value: s.command })), new inquirer.Separator(), { name: '💡 Descrever o que quer fazer (LLM descobre)', value: '__describe__' }]
  }])

  let finalCommand = selected
  if (selected === '__describe__') {
    const { intent } = await inquirer.prompt([{ type: 'input', name: 'intent', message: 'Descreva a ação que deseja realizar:' }])
    const spinner = ora('Analisando arquitetura e contextos via RAG...').start()
    const cmd = await askLLMForCommand(intent, projectRoot, config)
    spinner.stop()
    
    if (cmd) { 
      console.log(chalk.green(`  Comando descoberto (${process.platform === 'win32' ? 'PowerShell' : 'Bash'}):\n${chalk.white(cmd)}`))
      finalCommand = cmd 
    } else { 
      console.log(chalk.yellow('\n  ⚠️ Não consegui gerar o comando automaticamente.'))
      finalCommand = (await inquirer.prompt([{ type: 'input', name: 'm', message: 'Digite o comando manualmente:' }])).m 
    }
  }

  const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: `Executar o comando acima?`, default: true }])
  if (!ok) {
    console.log(chalk.gray('  Cancelado.\n'))
    process.exit(0)
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)))
  
  // ---------------------------------------------------------------------------
  // O SEGREDO DA EXECUÇÃO CROSS-PLATFORM: Configuração Dinâmica da Shell
  // ---------------------------------------------------------------------------
  const shellConfig = process.platform === 'win32' ? 'powershell.exe' : true;
  
  const exitCode = await new Promise(res => { 
    spawn(finalCommand, [], { cwd: projectRoot, stdio: 'inherit', shell: shellConfig })
      .on('close', res)
      .on('error', () => res(1)) 
  })
  console.log(chalk.gray('  ' + '─'.repeat(50) + '\n'))
  
  if (exitCode !== 0 && (await inquirer.prompt([{ type: 'confirm', name: 'a', message: 'Analisar erro com a IA?', default: true }])).a) {
    const spinner = ora('Analisando o erro...').start()
    const result = await ProviderFactory.create(config.ai).complete([
      { role: 'system', content: `Você é um desenvolvedor corrigindo um erro em um projeto ${config.profile.architecture}. Analise a falha de terminal e diga o que fazer para corrigir.` }, 
      { role: 'user', content: `O comando falhou: ${finalCommand}` }
    ])
    spinner.stop()
    if (result.success) console.log(chalk.white(`\n  💡 Análise e Correção:\n  ${result.content}\n`))
  } else if (exitCode === 0) {
    console.log(chalk.green('  ✅ Concluído!\n'))
  }
}

export function runCommand(): Command {
  return new Command('run')
    .description('Executa tarefas gerando e rodando comandos (ex: criar CRUDs)')
    .action(async () => await runRun())
}