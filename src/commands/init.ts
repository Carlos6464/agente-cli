import chalk  from 'chalk'
import ora    from 'ora'
const inquirer = require('inquirer')
const fs       = require('fs')
const path     = require('path')

import { detectStack, StackProfile }     from '../core/detector/stack-detector'
import { indexProject }                  from '../rag/indexer'
import { OllamaProvider, OLLAMA_MODELS } from '../providers/ollama.provider'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT CONFIG
// Estrutura salva em .agent/config.json na raiz do projeto
// Lida por todos os outros comandos
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  version:     string
  createdAt:   string
  projectRoot: string
  profile:     StackProfile
  ollama: {
    baseUrl:        string
    defaultModel:   string
    fastModel:      string
    embeddingModel: string
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// COMANDO INIT
// ─────────────────────────────────────────────────────────────────────────────

export async function runInit(options: { reindex?: boolean; projectRoot?: string } = {}) {
  const projectRoot = options.projectRoot || process.cwd()
  const isReindex   = options.reindex || false

  console.log('')
  console.log(chalk.bold.cyan('  🤖 Agent Init'))
  console.log(chalk.gray(`  Projeto: ${projectRoot}\n`))

  // ── 1. Verifica Ollama ────────────────────────────────────────────────────

  const connectSpinner = ora('Verificando Ollama...').start()
  const provider       = new OllamaProvider()
  const ollamaOk       = await provider.isAvailable()

  if (!ollamaOk) {
    connectSpinner.fail('Ollama não está rodando')
    console.log(chalk.yellow('\n  Inicie o Ollama antes de continuar:'))
    console.log(chalk.white('  ollama serve\n'))
    process.exit(1)
  }
  connectSpinner.succeed('Ollama conectado')

  // ── 2. Detecta stack ──────────────────────────────────────────────────────

  const detectSpinner = ora('Detectando stack do projeto...').start()
  const detection     = detectStack(projectRoot)

  if (!detection.success || !detection.profile) {
    detectSpinner.fail(`Erro ao detectar stack: ${detection.error}`)
    process.exit(1)
  }

  const profile = detection.profile
  detectSpinner.succeed('Stack detectada')

  console.log('')
  printDetectedStack(profile)

  // ── 3. Resolve ambiguidades ───────────────────────────────────────────────

  if (profile.ambiguities.length > 0) {
    console.log(chalk.yellow(`\n  ⚠️  ${profile.ambiguities.length} campo(s) não detectado(s) automaticamente.\n`))
    await resolveAmbiguities(profile)
  }

  // ── 4. Confirma indexação ─────────────────────────────────────────────────

  console.log('')
  const { confirmed } = await inquirer.prompt([{
    type:    'confirm',
    name:    'confirmed',
    message: 'Iniciar indexação do projeto?',
    default: true
  }])

  if (!confirmed) {
    console.log(chalk.gray('\n  Cancelado.\n'))
    process.exit(0)
  }

  // ── 5. Indexa ─────────────────────────────────────────────────────────────

  console.log('')
  const indexSpinner = ora('Indexando projeto...').start()

  const indexResult = await indexProject({
    projectRoot,
    forceReindex: isReindex,
    onProgress:   (msg) => { indexSpinner.text = msg }
  })

  if (!indexResult.success) {
    indexSpinner.fail(`Erro na indexação: ${indexResult.error}`)
    process.exit(1)
  }

  indexSpinner.succeed(
    `Indexação concluída — ${indexResult.filesIndexed} arquivos, ${indexResult.chunksCreated} chunks`
  )

  // ── 6. Salva config ───────────────────────────────────────────────────────

  const config: AgentConfig = {
    version:     '1.0.0',
    createdAt:   new Date().toISOString(),
    projectRoot,
    profile,
    ollama: {
      baseUrl:        'http://localhost:11434',
      defaultModel:   OLLAMA_MODELS.DEFAULT,
      fastModel:      OLLAMA_MODELS.FAST,
      embeddingModel: 'nomic-embed-text'
    }
  }

  saveConfig(config, projectRoot)
  ensureGitignore(projectRoot)

  // ── 7. Resultado final ────────────────────────────────────────────────────

  console.log('')
  console.log(chalk.bold.green('  ✅ Projeto inicializado com sucesso!\n'))
  console.log(chalk.gray('  Config salva em: .agent/config.json'))
  console.log(chalk.gray('  Índice salvo em: .agent/index/vectors.json'))
  console.log('')
  console.log(chalk.bold('  Próximos passos:'))
  console.log(chalk.white('  agent generate <tipo> <nome>') + chalk.gray('  — gera código'))
  console.log(chalk.white('  agent chat                 ') + chalk.gray('  — conversa sobre o projeto'))
  console.log(chalk.white('  agent run                  ') + chalk.gray('  — executa tarefas'))
  console.log('')
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

  console.log(chalk.bold('  Stack detectada:\n'))
  line('Linguagem',       profile.language)
  line('Package Manager', profile.packageManager)

  if (profile.monorepo !== 'none') {
    line('Monorepo', profile.monorepo)
    if (profile.apps.length > 0) line('Apps', profile.apps.join(', '))
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
      message: 'Qual banco de dados o projeto usa?',
      choices: [
        { name: 'PostgreSQL', value: 'postgresql' },
        { name: 'MySQL',      value: 'mysql' },
        { name: 'SQLite',     value: 'sqlite' },
        { name: 'MongoDB',    value: 'mongodb' },
        { name: 'Redis',      value: 'redis' },
        { name: 'Nenhum',     value: 'none' },
      ]
    })
  }

  if (profile.ambiguities.includes('architecture')) {
    questions.push({
      type:    'list',
      name:    'architecture',
      message: 'Qual padrão arquitetural o projeto usa?',
      choices: [
        { name: 'DDD (Domain-Driven Design)',    value: 'ddd'     },
        { name: 'MVC',                           value: 'mvc'     },
        { name: 'Modular (por feature)',          value: 'modular' },
        { name: 'Simples (sem padrão definido)', value: 'simple'  },
      ]
    })
  }

  if (profile.ambiguities.includes('language')) {
    questions.push({
      type:    'list',
      name:    'language',
      message: 'Qual a linguagem principal do projeto?',
      choices: [
        { name: 'TypeScript', value: 'typescript' },
        { name: 'JavaScript', value: 'javascript' },
        { name: 'Python',     value: 'python'     },
        { name: 'PHP',        value: 'php'        },
        { name: 'Ruby',       value: 'ruby'       },
        { name: 'Go',         value: 'go'         },
      ]
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
  const agentEntry    = '.agent/'

  try {
    let content = ''
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8')
      if (content.includes(agentEntry)) return
    }
    const sep = content.endsWith('\n') ? '' : '\n'
    fs.writeFileSync(gitignorePath, content + sep + '\n# Agent CLI\n' + agentEntry + '\n', 'utf-8')
    console.log(chalk.gray('  .agent/ adicionado ao .gitignore'))
  } catch {
    console.log(chalk.yellow('  ⚠️  Não foi possível atualizar o .gitignore automaticamente'))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMANDER WRAPPER
// Registra o comando no CLI
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander'

export function initCommand(): Command {
  const command = new Command('init')

  command
    .description('Inicializa o agente em um projeto existente')
    .option('--reindex', 'Reindexe mesmo arquivos já indexados', false)
    .action(async (options) => {
      await runInit({ reindex: options.reindex })
    })

  return command
}