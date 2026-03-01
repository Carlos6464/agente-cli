import chalk  from 'chalk'
import ora    from 'ora'
import os     from 'os'
const inquirer = require('inquirer')
const fs       = require('fs')
const path     = require('path')
import { Command } from 'commander'

import { detectStack, StackProfile } from '../core/detector/stack-detector'
import { indexProject } from '../rag/indexer'
import { AIConfig } from '../providers/llm-provider.interface'
import { ProviderFactory } from '../providers/provider.factory'
import { listDir, readFile } from '../tools/filesystem.tools'

export interface AgentConfig {
  version:     string
  createdAt:   string
  projectRoot: string
  profile:     StackProfile & { architecturalSummary?: string }
  ai:          AIConfig
}

export function saveConfig(config: AgentConfig, projectRoot: string = process.cwd()): void {
  const configDir  = path.join(projectRoot, '.agent')
  const configPath = path.join(configDir, 'config.json')
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

export function loadConfig(projectRoot: string = process.cwd()): AgentConfig | null {
  const configPath = path.join(projectRoot, '.agent', 'config.json')
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AgentConfig
  } catch {
    return null
  }
}

export function hasConfig(projectRoot: string = process.cwd()): boolean {
  return fs.existsSync(path.join(projectRoot, '.agent', 'config.json'))
}

export async function runInit(options: { reindex?: boolean; projectRoot?: string } = {}) {
  const projectRoot = options.projectRoot || process.cwd()
  const isReindex   = options.reindex || false

  console.log('')
  console.log(chalk.bold.cyan('  🤖 Agent Init'))
  console.log(chalk.gray(`  Projeto: ${projectRoot}\n`))

  const nodeVersion = parseInt(process.versions.node.split('.')[0])
  if (nodeVersion < 20) {
    console.log(chalk.red(`  ❌ Erro: O Agent CLI requer Node.js v20 ou superior. (Sua versão: v${process.versions.node})`))
    process.exit(1)
  }

  const { aiType } = await inquirer.prompt([{
    type: 'list', name: 'aiType',
    message: 'Como você deseja rodar a IA?',
    choices: [
      { name: '☁️  Cloud (Recomendado - Mais rápido, requer API Key)', value: 'cloud' },
      { name: '💻 Local (Ollama - Gratuito, usa seu hardware)', value: 'local' }
    ]
  }])

  let aiConfig: AIConfig = { provider: 'ollama', defaultModel: 'deepseek-coder-v2:latest', embeddingModel: 'nomic-embed-text' }

  if (aiType === 'local') {
    const totalRAM = os.totalmem() / (1024 * 1024 * 1024)
    if (totalRAM < 8) {
      console.log(chalk.yellow('\n  ⚠️  Aviso: Seu sistema tem menos de 8GB de RAM. Rodar IA local pode deixar o PC lento.\n'))
    }
    aiConfig.baseUrl = 'http://localhost:11434'
    const spinner = ora('Verificando Ollama...').start()
    const provider = ProviderFactory.create(aiConfig)
    if (!(await provider.isAvailable())) {
      spinner.fail('Ollama não está rodando. Inicie com: ollama serve')
      process.exit(1)
    }
    spinner.succeed('Ollama conectado')
  } else {
    const { providerChoice, apiKey } = await inquirer.prompt([
      { type: 'list', name: 'providerChoice', message: 'Provedor Cloud:', choices: [ { name: 'Google Gemini', value: 'gemini' } ] },
      { type: 'password', name: 'apiKey', message: 'API Key (Salva apenas localmente):', validate: (v: string) => v.length > 5 || 'Inválido' }
    ])
    // CORREÇÃO: Usando a nova versão da API
    aiConfig = { provider: providerChoice, apiKey, defaultModel: 'gemini-2.5-flash', embeddingModel: 'text-embedding-004' }
  }

  const detectSpinner = ora('Detectando stack (Varredura de Monorepo)...').start()
  const detection = detectStack(projectRoot)
  if (!detection.success || !detection.profile) {
    detectSpinner.fail(`Erro: ${detection.error}`); process.exit(1)
  }
  const profile = detection.profile
  detectSpinner.succeed('Stack base detectada')

  console.log('')
  printDetectedStack(profile)

  if (profile.ambiguities.length > 0) {
    console.log(chalk.yellow(`\n  ⚠️  ${profile.ambiguities.length} campo(s) não detectado(s) automaticamente.\n`))
    await resolveAmbiguities(profile)
  }

  const archSpinner = ora('IA analisando a arquitetura real do projeto...').start()
  try {
    const provider = ProviderFactory.create(aiConfig)
    const filesToRead = ['package.json', 'turbo.json', 'pnpm-workspace.yaml', 'nx.json', 'README.md']
    let projectContext = 'Arquivos Encontrados na Raiz:\n'
    
    filesToRead.forEach(file => {
      const res = readFile(path.join(projectRoot, file))
      if (res.success) projectContext += `\n--- ${file} ---\n${res.content?.slice(0, 2000)}\n`
    })

    const dirRes = listDir(projectRoot)
    if (dirRes.success) projectContext += `\n--- Estrutura de Pastas Raiz ---\n${dirRes.items?.map(i => i.name).join(', ')}`

    if (profile.apps && profile.apps.length > 0) {
      projectContext += `\n--- Workspaces Encontrados (Apps e Libs) ---\n${profile.apps.join('\n')}`
    }

    const result = await provider.complete([
      { role: 'system', content: 'Você é um Arquiteto de Software sênior. Responda em apenas 1 parágrafo: Qual a arquitetura exata do projeto? É monorepo? Onde (em qual pasta/workspace) ficam as regras de negócio de domínio (DDD se existir) e a infraestrutura?' },
      { role: 'user', content: projectContext }
    ])

    if (result.success && result.content) {
      (profile as any).architecturalSummary = result.content.trim()
      archSpinner.succeed('Arquitetura decifrada')
      console.log(chalk.gray(`  Resumo: ${result.content.trim()}`))
    } else {
      archSpinner.warn(`Não foi possível gerar análise avançada. Detalhe: ${result.error || 'Erro desconhecido'}`)
    }
  } catch (e) {
    archSpinner.warn(`Análise arquitetural avançada falhou: ${(e as Error).message}`)
  }

  console.log('')
  const { confirmed } = await inquirer.prompt([{
    type: 'confirm', name: 'confirmed', message: 'Iniciar indexação do projeto no RAG?', default: true
  }])

  if (!confirmed) {
    console.log(chalk.gray('\n  Cancelado.\n'))
    process.exit(0)
  }

  console.log('')
  const indexSpinner = ora('Indexando código (Isso pode demorar um pouco)...').start()
  const indexResult = await indexProject({ projectRoot, forceReindex: isReindex, onProgress: (msg) => { indexSpinner.text = msg } })
  indexResult.success ? indexSpinner.succeed(`Indexação concluída: ${indexResult.chunksCreated} chunks armazenados`) : indexSpinner.warn('Falha na indexação.')

  const config: AgentConfig = { version: '1.0.0', createdAt: new Date().toISOString(), projectRoot, profile, ai: aiConfig }
  saveConfig(config, projectRoot)
  ensureGitignore(projectRoot)
  
  console.log(chalk.bold.green('\n  ✅ Projeto inicializado com sucesso!\n'))
  console.log(chalk.bold('  Próximos passos:'))
  console.log(chalk.white('  agent generate <tipo> <nome>') + chalk.gray('  — gera código'))
  console.log(chalk.white('  agent chat                 ') + chalk.gray('  — conversa e age (use /agir)'))
  console.log(chalk.white('  agent run                  ') + chalk.gray('  — executa tarefas e corrige falhas\n'))
}

function printDetectedStack(profile: StackProfile) {
  const line = (label: string, value: string, ok: boolean = true) => {
    const icon = ok ? chalk.green('✓') : chalk.yellow('?')
    const val  = ok ? chalk.white(value) : chalk.yellow(value)
    console.log(`  ${icon} ${chalk.gray(label.padEnd(18))} ${val}`)
  }
  line('Linguagem',       profile.language)
  line('Package Manager', profile.packageManager)
  
  if (profile.monorepo !== 'none') {
    line('Monorepo', profile.monorepo)
    if (profile.apps.length > 0) line('Workspaces', profile.apps.join(', '))
  }

  if (profile.backend  !== 'none') line('Backend',  profile.backend)
  if (profile.frontend !== 'none') line('Frontend', profile.frontend)
  if (profile.mobile   !== 'none') line('Mobile',   profile.mobile)
  if (profile.orm      !== 'none') line('ORM',      profile.orm)
  line('Banco',       profile.database     === 'unknown' ? '(não detectado)' : profile.database,     profile.database     !== 'unknown')
  line('Arquitetura', profile.architecture === 'unknown' ? '(não detectado)' : profile.architecture, profile.architecture !== 'unknown')
  if (profile.testing !== 'none') line('Testes', profile.testing)
}

async function resolveAmbiguities(profile: StackProfile): Promise<void> {
  const questions: any[] = []
  if (profile.ambiguities.includes('database')) {
    questions.push({ type: 'list', name: 'database', message: 'Banco de dados?', choices: ['postgresql', 'mysql', 'sqlite', 'mongodb', 'redis', 'none'] })
  }
  if (profile.ambiguities.includes('architecture')) {
    questions.push({ type: 'list', name: 'architecture', message: 'Arquitetura?', choices: ['ddd', 'mvc', 'modular', 'simple'] })
  }
  if (profile.ambiguities.includes('language')) {
    questions.push({ type: 'list', name: 'language', message: 'Linguagem?', choices: ['typescript', 'javascript', 'python', 'php', 'ruby', 'go'] })
  }
  if (questions.length === 0) return
  const answers = await inquirer.prompt(questions)
  if (answers.database)     profile.database     = answers.database
  if (answers.architecture) profile.architecture = answers.architecture
  if (answers.language)     profile.language     = answers.language
  profile.ambiguities = profile.ambiguities.filter(a => !Object.keys(answers).includes(a))
}

function ensureGitignore(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  try {
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : ''
    if (!content.includes('.agent/')) {
      const sep = content.endsWith('\n') || content === '' ? '' : '\n'
      fs.writeFileSync(gitignorePath, content + sep + '\n# Agent CLI\n.agent/\n', 'utf-8')
    }
  } catch {}
}

export function initCommand(): Command {
  const command = new Command('init')
  command.description('Inicializa o agente em um projeto existente')
         .option('--reindex', 'Reindexe mesmo arquivos já indexados', false)
         .action(async (options) => { await runInit({ reindex: options.reindex }) })
  return command
}