import chalk from 'chalk'
import ora   from 'ora'
const inquirer  = require('inquirer')
const { spawn } = require('child_process')
import { Command } from 'commander'

import { loadConfig, hasConfig } from './init'
import { OllamaProvider }        from '../providers/ollama.provider'
import { buildContext }          from '../core/context-builder/context-builder'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT RUN
//
// Executa tarefas do projeto com seleção interativa.
// Quando ocorre um erro, analisa com o LLM e sugere correção.
//
// Fluxo:
//   1. Carrega .agent/config.json
//   2. Pergunta qual tarefa executar (build, test, lint, db, deploy, custom)
//   3. Se monorepo, pergunta qual app
//   4. Mostra o comando que será executado e pede confirmação
//   5. Executa com output em tempo real
//   6. Se erro → analisa com LLM e exibe sugestão de correção
// ─────────────────────────────────────────────────────────────────────────────

// Tarefas pré-definidas por categoria
const TASK_CATEGORIES = [
  { name: '🏗️  Build',                    value: 'build'  },
  { name: '🧪 Test',                      value: 'test'   },
  { name: '🔍 Lint / Format',             value: 'lint'   },
  { name: '🗄️  Database (migrate/seed)',  value: 'db'     },
  { name: '🚀 Deploy',                    value: 'deploy' },
  { name: '✏️  Custom (digitar comando)', value: 'custom' },
]

// Comandos padrão por categoria e package manager
const DEFAULT_COMMANDS: Record<string, Record<string, string>> = {
  build: {
    npm:  'npm run build',
    yarn: 'yarn build',
    pnpm: 'pnpm build',
  },
  test: {
    npm:  'npm test',
    yarn: 'yarn test',
    pnpm: 'pnpm test',
  },
  lint: {
    npm:  'npm run lint',
    yarn: 'yarn lint',
    pnpm: 'pnpm lint',
  },
  db: {
    npm:  'npm run db:migrate',
    yarn: 'yarn db:migrate',
    pnpm: 'pnpm db:migrate',
  },
  deploy: {
    npm:  'npm run deploy',
    yarn: 'yarn deploy',
    pnpm: 'pnpm deploy',
  },
}

// Ajusta comando para monorepo (turborepo/nx/lerna)
function adjustForMonorepo(
  command:  string,
  monorepo: string,
  pkgMgr:   string,
  app?:     string
): string {
  if (!app) return command

  // Extrai só a tarefa (build, test, lint...)
  const taskMatch = command.match(/(?:run\s+)?(\w+)$/)
  const task = taskMatch ? taskMatch[1] : command

  if (monorepo === 'turborepo') {
    return `${pkgMgr} turbo run ${task} --filter=${app}`
  }
  if (monorepo === 'nx') {
    return `npx nx run ${app}:${task}`
  }
  if (monorepo === 'lerna') {
    return `npx lerna run ${task} --scope=${app}`
  }

  // Workspaces simples
  if (pkgMgr === 'pnpm') return `pnpm --filter ${app} run ${task}`
  if (pkgMgr === 'yarn') return `yarn workspace ${app} run ${task}`
  return `npm run ${task} --workspace=${app}`
}

export async function runRun(options: { app?: string; projectRoot?: string } = {}) {
  const projectRoot = options.projectRoot || process.cwd()

  console.log('')
  console.log(chalk.bold.cyan('  🔧 Agent Run\n'))

  // ── 1. Carrega config ──────────────────────────────────────────────────────

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('  ❌ Projeto não inicializado.'))
    console.log(chalk.yellow('  Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const config  = loadConfig(projectRoot)!
  const profile = config.profile
  const pkgMgr  = profile.packageManager === 'unknown' ? 'npm' : profile.packageManager

  // ── 2. Seleciona categoria da tarefa ───────────────────────────────────────

  const { category } = await inquirer.prompt([{
    type:    'list',
    name:    'category',
    message: 'O que você quer executar?',
    choices: TASK_CATEGORIES,
  }])

  // ── 3. Seleciona app (se monorepo e não passado via flag) ─────────────────

  let targetApp = options.app

  if (profile.monorepo !== 'none' && profile.apps.length > 0 && !targetApp) {
    const { selectedApp } = await inquirer.prompt([{
      type:    'list',
      name:    'selectedApp',
      message: 'Qual app?',
      choices: [
        { name: '(todos os apps)', value: '' },
        ...profile.apps.map(a => ({ name: a, value: a }))
      ]
    }])
    targetApp = selectedApp || undefined
  }

  // ── 4. Monta o comando ────────────────────────────────────────────────────

  let finalCommand = ''

  if (category === 'custom') {
    const { customCmd } = await inquirer.prompt([{
      type:    'input',
      name:    'customCmd',
      message: 'Digite o comando:',
      validate: (v: string) => v.trim().length > 0 || 'Comando não pode ser vazio'
    }])
    finalCommand = customCmd.trim()
  } else if (category === 'db') {
    // Submenu de database
    const { dbTask } = await inquirer.prompt([{
      type:    'list',
      name:    'dbTask',
      message: 'Qual operação de banco?',
      choices: [
        { name: 'Migrate (aplicar migrations)',     value: 'migrate'  },
        { name: 'Migrate Dev (criar migration)',    value: 'migrate:dev' },
        { name: 'Seed (popular banco)',             value: 'seed'     },
        { name: 'Reset (apagar e recriar)',         value: 'reset'    },
        { name: 'Studio (abrir GUI)',               value: 'studio'   },
      ]
    }])

    // Comandos específicos por ORM
    if (profile.orm === 'prisma') {
      const prismaCommands: Record<string, string> = {
        migrate:     'npx prisma migrate deploy',
        'migrate:dev': 'npx prisma migrate dev',
        seed:        `${pkgMgr} run db:seed`,
        reset:       'npx prisma migrate reset',
        studio:      'npx prisma studio',
      }
      finalCommand = prismaCommands[dbTask] || `${pkgMgr} run db:${dbTask}`
    } else {
      finalCommand = `${pkgMgr} run db:${dbTask}`
    }

    if (targetApp && profile.monorepo !== 'none') {
      finalCommand = adjustForMonorepo(finalCommand, profile.monorepo, pkgMgr, targetApp)
    }
  } else {
    const baseCommand = DEFAULT_COMMANDS[category]?.[pkgMgr] || `${pkgMgr} run ${category}`
    finalCommand = targetApp
      ? adjustForMonorepo(baseCommand, profile.monorepo, pkgMgr, targetApp)
      : baseCommand
  }

  // ── 5. Confirma o comando ─────────────────────────────────────────────────

  console.log('')
  console.log(chalk.bold('  Comando a executar:'))
  console.log(chalk.cyan(`  $ ${finalCommand}\n`))

  const { confirmed } = await inquirer.prompt([{
    type:    'confirm',
    name:    'confirmed',
    message: 'Executar?',
    default: true
  }])

  if (!confirmed) {
    console.log(chalk.gray('\n  Cancelado.\n'))
    process.exit(0)
  }

  // ── 6. Executa o comando ──────────────────────────────────────────────────

  console.log('')
  console.log(chalk.bold.gray(`  Executando: ${finalCommand}\n`))
  console.log(chalk.gray('  ' + '─'.repeat(50)))

  const exitCode = await runCommandLive(finalCommand, projectRoot)

  console.log(chalk.gray('  ' + '─'.repeat(50) + '\n'))

  // ── 7. Analisa erro se houver ─────────────────────────────────────────────

  if (exitCode !== 0) {
    console.log(chalk.red(`  ❌ Comando falhou com código ${exitCode}\n`))

    const { analyze } = await inquirer.prompt([{
      type:    'confirm',
      name:    'analyze',
      message: 'Analisar o erro com o LLM?',
      default: true
    }])

    if (analyze) {
      await analyzeError(finalCommand, exitCode, config)
    }
  } else {
    console.log(chalk.green('  ✅ Concluído com sucesso!\n'))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTA O COMANDO COM OUTPUT EM TEMPO REAL
// ─────────────────────────────────────────────────────────────────────────────

function runCommandLive(command: string, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command.split(' ')

    const proc = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',  // herda stdin/stdout/stderr do processo pai
      shell: true        // permite pipes e comandos compostos
    })

    proc.on('close', (code: number) => {
      resolve(code || 0)
    })

    proc.on('error', (err: Error) => {
      console.log(chalk.red(`\n  Erro ao executar: ${err.message}`))
      resolve(1)
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALISA O ERRO COM O LLM
// ─────────────────────────────────────────────────────────────────────────────

async function analyzeError(
  command:  string,
  exitCode: number,
  config:   any
): Promise<void> {
  const spinner = ora('Analisando erro com o LLM...').start()

  try {
    const provider = new OllamaProvider(config.ollama.defaultModel, config.ollama.baseUrl)

    const contextResult = await buildContext({
      instruction: `O comando "${command}" falhou com código ${exitCode}. Analise o provável erro e sugira como corrigir. Seja específico e direto.`,
      profile:     config.profile,
      mode:        'run',
      topK:        3
    })

    if (!contextResult.success || !contextResult.messages) {
      spinner.fail('Não foi possível montar o contexto')
      return
    }

    const result = await provider.complete(contextResult.messages, { temperature: 0.2 })

    spinner.stop()

    if (result.success && result.content) {
      console.log(chalk.bold('\n  💡 Análise do LLM:\n'))
      console.log(chalk.white('  ' + result.content.replace(/\n/g, '\n  ')))
      console.log('')
    } else {
      spinner.fail(`Erro na análise: ${result.error}`)
    }
  } catch (err) {
    spinner.fail(`Erro: ${(err as Error).message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMANDER WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

export function runCommand(): Command {
  const command = new Command('run')

  command
    .description('Executa tarefas do projeto com seleção interativa')
    .option('--app <app>', 'App alvo dentro do monorepo (ex: api, web, mobile)')
    .action(async (options: { app?: string }) => {
      await runRun({ app: options.app })
    })

  return command
}