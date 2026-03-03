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

  // ── Seleção do tipo de IA ─────────────────────────────────────────────────
  const { aiType } = await inquirer.prompt([{
    type:    'list',
    name:    'aiType',
    message: 'Como você deseja rodar a IA?',
    choices: [
      { name: '☁️  Cloud (OpenAI, Gemini, Claude) — Rápido e inteligente', value: 'cloud' },
      { name: '💻 Local (Ollama) — 100% privado, requer PC forte',          value: 'local' },
    ]
  }])

  let aiConfig: AIConfig = {
    provider:       'ollama',
    defaultModel:   'deepseek-coder-v2:latest',
    embeddingModel: 'nomic-embed-text'
  }

  // ── Configuração LOCAL (Ollama) ───────────────────────────────────────────
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

  // ── Configuração CLOUD ────────────────────────────────────────────────────
  } else {
    const { providerChoice } = await inquirer.prompt([{
      type:    'list',
      name:    'providerChoice',
      message: 'Provedor de IA:',
      choices: [
        { name: '✨ OpenAI / ChatGPT',    value: 'openai' },
        { name: '🟦 Google Gemini',        value: 'gemini' },
        { name: '🟣 Anthropic Claude',     value: 'claude' },
      ]
    }])

    // Modelos disponíveis por provedor
    const modelChoices: Record<string, { name: string; value: string }[]> = {
      openai: [
        { name: 'gpt-4o       — mais capaz, ideal para geração complexa', value: 'gpt-4o'      },
        { name: 'gpt-4o-mini  — rápido e econômico (recomendado)',        value: 'gpt-4o-mini' },
      ],
      gemini: [
        { name: 'gemini-2.5-flash — rápido e eficiente (recomendado)', value: 'gemini-2.5-flash' },
        { name: 'gemini-2.5-pro   — máxima capacidade',                value: 'gemini-2.5-pro'   },
      ],
      claude: [
        { name: 'claude-sonnet-4-5 — equilíbrio perfeito (recomendado)', value: 'claude-sonnet-4-5' },
        { name: 'claude-opus-4-5   — máxima capacidade',                 value: 'claude-opus-4-5'   },
        { name: 'claude-haiku-4-5  — mais rápido e econômico',           value: 'claude-haiku-4-5'  },
      ]
    }

    const { modelChoice } = await inquirer.prompt([{
      type:    'list',
      name:    'modelChoice',
      message: 'Modelo:',
      choices: modelChoices[providerChoice]
    }])

    const providerLabels: Record<string, string> = {
      openai: 'OpenAI',
      gemini: 'Google (Gemini)',
      claude: 'Anthropic (Claude)'
    }

    const { apiKey } = await inquirer.prompt([{
      type:     'password',
      name:     'apiKey',
      message:  `API Key do ${providerLabels[providerChoice]}:`,
      validate: (v: string) => v.trim().length > 10 || 'Chave inválida — muito curta'
    }])

    // ── Configuração de embeddings (RAG) ──────────────────────────────────
    // OpenAI e Gemini têm embeddings nativos no mesmo provedor.
    // Claude não tem — precisa de um provedor externo para o RAG.

    let embeddingModel:    string             = ''
    let embeddingProvider: 'openai' | 'gemini' | 'ollama' | undefined = undefined
    let embeddingApiKey:   string | undefined = undefined

    if (providerChoice === 'openai') {
      embeddingModel    = 'text-embedding-3-small'
      embeddingProvider = 'openai'

    } else if (providerChoice === 'gemini') {
      embeddingModel    = 'gemini-embedding-001'
      embeddingProvider = 'gemini'

    } else if (providerChoice === 'claude') {
      console.log(chalk.yellow('\n  ℹ️  Claude não possui embeddings nativos. O RAG precisa de um provedor externo.\n'))

      const { embChoice } = await inquirer.prompt([{
        type:    'list',
        name:    'embChoice',
        message: 'Provedor de embeddings para o RAG:',
        choices: [
          { name: '🟦 Google Gemini Embeddings (recomendado)', value: 'gemini' },
          { name: '✨ OpenAI Embeddings (text-embedding-3-small)', value: 'openai' },
          { name: '⏭️  Pular RAG — sem indexação de código',       value: 'skip'   },
        ]
      }])

      if (embChoice !== 'skip') {
        embeddingProvider = embChoice
        embeddingModel    = embChoice === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small'

        const embLabel = embChoice === 'gemini' ? 'Google (Gemini)' : 'OpenAI'
        const { embKey } = await inquirer.prompt([{
          type:     'password',
          name:     'embKey',
          message:  `API Key do ${embLabel} (para embeddings):`,
          validate: (v: string) => v.trim().length > 10 || 'Chave inválida'
        }])
        embeddingApiKey = embKey.trim()
      }
    }

    aiConfig = {
      provider:          providerChoice,
      apiKey:            apiKey.trim(),
      defaultModel:      modelChoice,
      embeddingModel:    embeddingModel || 'nomic-embed-text',
      embeddingProvider,
      embeddingApiKey,
    }
  }

  // ── Detecção de stack ─────────────────────────────────────────────────────
  const detectSpinner = ora('Detectando stack (varredura do projeto)...').start()
  const detection     = detectStack(projectRoot)

  if (!detection.success || !detection.profile) {
    detectSpinner.fail(`Erro: ${detection.error}`)
    process.exit(1)
  }

  const profile = detection.profile
  detectSpinner.succeed('Stack detectada')

  console.log('')
  printDetectedStack(profile)

  if (profile.ambiguities.length > 0) {
    console.log(chalk.yellow(`\n  ⚠️  ${profile.ambiguities.length} campo(s) não detectado(s) automaticamente.\n`))
    await resolveAmbiguities(profile)
  }

  // ── Análise arquitetural com IA ───────────────────────────────────────────
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
    if (dirRes.success) {
      projectContext += `\n--- Estrutura de Pastas Raiz ---\n${dirRes.items?.map(i => i.name).join(', ')}`
    }

    if (profile.apps && profile.apps.length > 0) {
      projectContext += `\n--- Workspaces Encontrados ---\n${profile.apps.join('\n')}`
    }

    const result = await provider.complete([
      {
        role:    'system',
        content: 'Você é um Arquiteto de Software sênior. Responda em apenas 1 parágrafo: Qual a arquitetura exata do projeto? É monorepo? Onde ficam as regras de negócio de domínio e a infraestrutura?'
      },
      { role: 'user', content: projectContext }
    ])

    if (result.success && result.content) {
      (profile as any).architecturalSummary = result.content.trim()
      archSpinner.succeed('Arquitetura decifrada')
      console.log(chalk.gray(`  Resumo: ${result.content.trim()}`))
    } else {
      archSpinner.warn(`Análise arquitetural falhou: ${result.error || 'Erro desconhecido'}`)
    }
  } catch (e) {
    archSpinner.warn(`Análise arquitetural avançada falhou: ${(e as Error).message}`)
  }

  // ── Salva config e garante .gitignore ─────────────────────────────────────
  const config: AgentConfig = {
    version:     '1.0.0',
    createdAt:   new Date().toISOString(),
    projectRoot,
    profile,
    ai: aiConfig
  }

  saveConfig(config, projectRoot)
  ensureGitignore(projectRoot)

  // ── Indexação RAG ─────────────────────────────────────────────────────────
  console.log('')
  const { confirmed } = await inquirer.prompt([{
    type:    'confirm',
    name:    'confirmed',
    message: 'Iniciar indexação do projeto no RAG?',
    default: true
  }])

  if (confirmed) {
    console.log('')
    const indexSpinner = ora('Indexando código (isso pode demorar um pouco)...').start()

    const indexResult = await indexProject({
      projectRoot,
      model:        aiConfig.embeddingModel,
      forceReindex: isReindex,
      onProgress:   (msg) => { indexSpinner.text = msg }
    })

    if (indexResult.success) {
      indexSpinner.succeed(`Indexação concluída: ${indexResult.chunksCreated} chunks armazenados`)
    } else {
      indexSpinner.fail(`Falha na indexação: ${indexResult.error}`)
    }
  } else {
    console.log(chalk.gray('\n  Indexação ignorada. (Use "agent init --reindex" mais tarde).'))
  }

  console.log(chalk.bold.green('\n  ✅ Projeto inicializado com sucesso!\n'))
  console.log(chalk.bold('  Próximos passos:'))
  console.log(chalk.white('  agent generate <tipo> <nome>') + chalk.gray('  — gera código'))
  console.log(chalk.white('  agent chat                 ') + chalk.gray('  — conversa e age (use /agir)'))
  console.log(chalk.white('  agent run                  ') + chalk.gray('  — executa tarefas e corrige falhas\n'))
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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
    questions.push({
      type:    'list',
      name:    'database',
      message: 'Banco de dados?',
      choices: ['postgresql', 'mysql', 'sqlite', 'mongodb', 'redis', 'none']
    })
  }
  if (profile.ambiguities.includes('architecture')) {
    questions.push({
      type:    'list',
      name:    'architecture',
      message: 'Arquitetura?',
      choices: ['ddd', 'mvc', 'modular', 'simple']
    })
  }
  if (profile.ambiguities.includes('language')) {
    questions.push({
      type:    'list',
      name:    'language',
      message: 'Linguagem?',
      choices: ['typescript', 'javascript', 'python', 'php', 'ruby', 'go']
    })
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