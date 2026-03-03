import chalk  from 'chalk'
import ora    from 'ora'
import os     from 'os'
const inquirer = require('inquirer')
const path     = require('path')
import { Command } from 'commander'

import { loadConfig, saveConfig, hasConfig } from './init'
import { ProviderFactory }                   from '../providers/provider.factory'
import { AIConfig }                          from '../providers/llm-provider.interface'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT MODEL — Troca provedor/modelo sem tocar no índice RAG
//
// Atualiza APENAS o campo `ai` no .agent/config.json.
// Vetores, histórico e configurações do projeto permanecem intactos.
//
// Uso:
//   agent model          → wizard interativo completo
//   agent model --show   → exibe o modelo atualmente configurado
// ─────────────────────────────────────────────────────────────────────────────

export async function runModel(options: { show?: boolean; projectRoot?: string } = {}) {
  const projectRoot = options.projectRoot || process.cwd()

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('\n  ❌ Projeto não inicializado. Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const config = loadConfig(projectRoot)!

  // ── Modo --show: só exibe e sai ───────────────────────────────────────────
  if (options.show) {
    console.log(chalk.bold.cyan('\n  🤖 Modelo atual\n'))
    printCurrentModel(config.ai)
    console.log('')
    return
  }

  console.log(chalk.bold.cyan('\n  🔄 Agent Model — Trocar IA\n'))
  console.log(chalk.gray('  Os vetores e o índice RAG não serão alterados.\n'))
  console.log(chalk.bold('  Configuração atual:'))
  printCurrentModel(config.ai)
  console.log('')

  // ── Tipo: cloud ou local ──────────────────────────────────────────────────
  const { aiType } = await inquirer.prompt([{
    type:    'list',
    name:    'aiType',
    message: 'Tipo de IA:',
    choices: [
      { name: '☁️  Cloud (OpenAI, Gemini, Claude)', value: 'cloud' },
      { name: '💻 Local (Ollama)',                   value: 'local' },
    ]
  }])

  let newAiConfig: AIConfig

  // ── LOCAL (Ollama) ────────────────────────────────────────────────────────
  if (aiType === 'local') {
    const totalRAM = os.totalmem() / (1024 * 1024 * 1024)
    if (totalRAM < 8) {
      console.log(chalk.yellow('\n  ⚠️  Aviso: menos de 8GB de RAM. Pode ficar lento.\n'))
    }

    const spinner = ora('Conectando ao Ollama...').start()
    const testConf: AIConfig = {
      provider:       'ollama',
      baseUrl:        'http://localhost:11434',
      defaultModel:   'deepseek-coder-v2:latest',
      embeddingModel: 'nomic-embed-text',
    }
    const provider = ProviderFactory.create(testConf)

    if (!(await provider.isAvailable())) {
      spinner.fail('Ollama não está rodando. Inicie com: ollama serve')
      process.exit(1)
    }

    const installedModels = await provider.listModels()
    spinner.succeed(`Ollama conectado — ${installedModels.length} modelo(s) instalado(s)`)

    let chosenModel = 'deepseek-coder-v2:latest'

    if (installedModels.length > 0) {
      const choices = [
        ...installedModels.map(m => ({ name: m, value: m })),
        { name: '✏️  Digitar manualmente', value: '__manual__' }
      ]

      const { modelChoice } = await inquirer.prompt([{
        type: 'list', name: 'modelChoice', message: 'Modelo local:', choices
      }])

      if (modelChoice === '__manual__') {
        const { manualModel } = await inquirer.prompt([{
          type:     'input',
          name:     'manualModel',
          message:  'Nome do modelo (ex: llama3:latest):',
          validate: (v: string) => v.trim().length > 0 || 'Nome não pode ser vazio'
        }])
        chosenModel = manualModel.trim()
      } else {
        chosenModel = modelChoice
      }
    } else {
      const { manualModel } = await inquirer.prompt([{
        type:     'input',
        name:     'manualModel',
        message:  'Nome do modelo (ex: deepseek-coder-v2:latest):',
        validate: (v: string) => v.trim().length > 0 || 'Nome não pode ser vazio'
      }])
      chosenModel = manualModel.trim()
    }

    newAiConfig = {
      provider:       'ollama',
      baseUrl:        'http://localhost:11434',
      defaultModel:   chosenModel,
      embeddingModel: 'nomic-embed-text',
    }

  // ── CLOUD ─────────────────────────────────────────────────────────────────
  } else {
    const { providerChoice } = await inquirer.prompt([{
      type:    'list',
      name:    'providerChoice',
      message: 'Provedor:',
      choices: [
        { name: '✨ OpenAI / ChatGPT', value: 'openai' },
        { name: '🟦 Google Gemini',    value: 'gemini' },
        { name: '🟣 Anthropic Claude', value: 'claude' },
      ]
    }])

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

    // ── Reutiliza chave salva se for o mesmo provedor ─────────────────────
    const hasSavedKey = config.ai.provider === providerChoice && !!config.ai.apiKey
    let apiKey = ''

    if (hasSavedKey) {
      const { reuseKey } = await inquirer.prompt([{
        type:    'confirm',
        name:    'reuseKey',
        message: `Reutilizar a API Key salva (${maskApiKey(config.ai.apiKey!)})?`,
        default: true
      }])
      if (reuseKey) apiKey = config.ai.apiKey!
    }

    if (!apiKey) {
      const providerLabels: Record<string, string> = {
        openai: 'OpenAI',
        gemini: 'Google (Gemini)',
        claude: 'Anthropic (Claude)'
      }
      const { newKey } = await inquirer.prompt([{
        type:     'password',
        name:     'newKey',
        message:  `API Key do ${providerLabels[providerChoice]}:`,
        validate: (v: string) => v.trim().length > 10 || 'Chave inválida — muito curta'
      }])
      apiKey = newKey.trim()
    }

    // ── Embeddings ────────────────────────────────────────────────────────
    let embeddingModel:    string                                       = ''
    let embeddingProvider: 'openai' | 'gemini' | 'ollama' | undefined  = undefined
    let embeddingApiKey:   string | undefined                           = undefined

    if (providerChoice === 'openai') {
      embeddingModel    = 'text-embedding-3-small'
      embeddingProvider = 'openai'
      // mesma apiKey do LLM, não precisa de chave separada

    } else if (providerChoice === 'gemini') {
      embeddingModel    = 'gemini-embedding-001'
      embeddingProvider = 'gemini'

    } else if (providerChoice === 'claude') {
      // Claude não tem embeddings nativos
      const hadEmbProvider = config.ai.embeddingProvider
      const hadEmbKey      = config.ai.embeddingApiKey

      // Se já tinha embedding configurado, oferece reutilizar
      if (hadEmbProvider && hadEmbKey) {
        console.log(chalk.gray(`\n  ℹ️  RAG configurado com ${hadEmbProvider} (${maskApiKey(hadEmbKey)})`))

        const { reuseEmb } = await inquirer.prompt([{
          type:    'confirm',
          name:    'reuseEmb',
          message: 'Manter o provedor de embeddings atual para o RAG?',
          default: true
        }])

        if (reuseEmb) {
          embeddingProvider = hadEmbProvider
          embeddingModel    = config.ai.embeddingModel
          embeddingApiKey   = hadEmbKey
        }
      }

      // Se não tinha ou decidiu não reutilizar, configura novo
      if (!embeddingProvider) {
        console.log(chalk.yellow('\n  ℹ️  Claude não possui embeddings nativos. O RAG precisa de um provedor externo.\n'))

        const { embChoice } = await inquirer.prompt([{
          type:    'list',
          name:    'embChoice',
          message: 'Provedor de embeddings para o RAG:',
          choices: [
            { name: '🟦 Google Gemini Embeddings (recomendado)', value: 'gemini' },
            { name: '✨ OpenAI Embeddings',                       value: 'openai' },
            { name: '⏭️  Pular — manter índice atual sem reindexar', value: 'skip' },
          ]
        }])

        if (embChoice !== 'skip') {
          embeddingProvider = embChoice
          embeddingModel    = embChoice === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small'

          const embLabel   = embChoice === 'gemini' ? 'Google (Gemini)' : 'OpenAI'
          const { embKey } = await inquirer.prompt([{
            type:     'password',
            name:     'embKey',
            message:  `API Key do ${embLabel} (embeddings):`,
            validate: (v: string) => v.trim().length > 10 || 'Chave inválida'
          }])
          embeddingApiKey = embKey.trim()
        } else {
          // Mantém embedding antigo para não quebrar o RAG existente
          embeddingModel    = config.ai.embeddingModel
          embeddingProvider = config.ai.embeddingProvider
          embeddingApiKey   = config.ai.embeddingApiKey
        }
      }
    }

    newAiConfig = {
      provider:          providerChoice,
      apiKey,
      defaultModel:      modelChoice,
      embeddingModel:    embeddingModel || config.ai.embeddingModel,
      embeddingProvider,
      embeddingApiKey,
    }
  }

  // ── Confirmação antes de salvar ───────────────────────────────────────────
  console.log(chalk.bold('\n  Nova configuração:\n'))
  printCurrentModel(newAiConfig)

  const { confirmed } = await inquirer.prompt([{
    type:    'confirm',
    name:    'confirmed',
    message: 'Salvar e aplicar essa configuração?',
    default: true
  }])

  if (!confirmed) {
    console.log(chalk.gray('\n  Cancelado. Nada foi alterado.\n'))
    process.exit(0)
  }

  // ── Salva APENAS o campo ai — todo o resto permanece intacto ─────────────
  config.ai = newAiConfig
  saveConfig(config, projectRoot)

  console.log(chalk.bold.green('\n  ✅ Modelo atualizado com sucesso!\n'))
  console.log(chalk.gray('  Os vetores e o índice RAG foram mantidos intactos.'))
  console.log(chalk.gray('  Use "agent index --force" se quiser reindexar com o novo provedor de embeddings.\n'))
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function printCurrentModel(ai: AIConfig) {
  const line = (label: string, value: string) =>
    console.log(`  ${chalk.gray(label.padEnd(22))} ${chalk.white(value)}`)

  line('Provedor:',        ai.provider)
  line('Modelo:',          ai.defaultModel)
  line('Embedding model:', ai.embeddingModel)

  if (ai.embeddingProvider && ai.embeddingProvider !== ai.provider) {
    line('Embedding provedor:', ai.embeddingProvider)
  }
  if (ai.apiKey)          line('API Key:',           maskApiKey(ai.apiKey))
  if (ai.embeddingApiKey) line('Embedding API Key:', maskApiKey(ai.embeddingApiKey))
  if (ai.baseUrl)         line('Base URL:',          ai.baseUrl)
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

// ─────────────────────────────────────────────────────────────────────────────
// COMANDO
// ─────────────────────────────────────────────────────────────────────────────

export function modelCommand(): Command {
  const cmd = new Command('model')
  cmd
    .description('Troca o provedor ou modelo de IA sem apagar o índice RAG')
    .option('--show', 'Exibe o modelo atualmente configurado')
    .action(async (options) => { await runModel({ show: options.show }) })
  return cmd
}