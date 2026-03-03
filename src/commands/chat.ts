import chalk from 'chalk'
import ora from 'ora'
const readline = require('readline')
const fs = require('fs')
const path = require('path')
import { Command } from 'commander'

import { loadConfig, hasConfig } from './init'
import { ProviderFactory } from '../providers/provider.factory'
import { buildContext } from '../core/context-builder/context-builder'
import { LLMMessage } from '../providers/llm-provider.interface'
import { runAgent } from '../core/agent/agent-core'

const MAX_HISTORY = 20

// ── FUNÇÕES DE HISTÓRICO ─────────────────────────────────────────────────────

function getHistoryPath(projectRoot: string): string {
  return path.join(projectRoot, '.agent', 'history.json')
}

function loadHistory(projectRoot: string): LLMMessage[] {
  const historyPath = getHistoryPath(projectRoot)
  if (!fs.existsSync(historyPath)) return []

  try {
    const data = fs.readFileSync(historyPath, 'utf-8')
    const parsed = JSON.parse(data)
    if (Array.isArray(parsed)) {
      return parsed
    }
    return []
  } catch (err) {
    console.log(chalk.yellow(`\n  ⚠️  Aviso: Não foi possível ler o histórico anterior. Iniciando nova sessão.\n`))
    return []
  }
}

function saveHistory(projectRoot: string, messages: LLMMessage[]): void {
  const historyPath = getHistoryPath(projectRoot)
  const dir = path.dirname(historyPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  try {
    // Salva as últimas 100 mensagens para não inchar o arquivo no disco infinitamente
    const toSave = messages.slice(-100)
    fs.writeFileSync(historyPath, JSON.stringify(toSave, null, 2), 'utf-8')
  } catch (err) {
    console.log(chalk.red(`\n  ❌ Erro ao salvar histórico: ${(err as Error).message}\n`))
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function runChat(options: { projectRoot?: string } = {}) {
  const projectRoot = options.projectRoot || process.cwd()

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('\n  ❌ Projeto não inicializado. Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const config = loadConfig(projectRoot)!
  const provider = ProviderFactory.create(config.ai)

  console.log(chalk.bold.cyan('\n  💬 Agent Chat'))
  const spinner = ora('Conectando à IA...').start()

  if (!(await provider.isAvailable())) {
    spinner.fail('IA Offline. Verifique sua conexão ou API Key.')
    process.exit(1)
  }

  spinner.succeed(`Conectado — ${config.ai.provider} (${config.ai.defaultModel})`)

  // CARREGA O HISTÓRICO SALVO
  const sessionMessages: LLMMessage[] = loadHistory(projectRoot)
  if (sessionMessages.length > 0) {
    console.log(chalk.green(`  📚 Histórico carregado (${sessionMessages.length} mensagens). O agente lembrará do contexto passado.`))
  }

  console.log(chalk.gray('\n  Comandos disponíveis:'))
  console.log(chalk.gray('  /agir <instrução> ') + chalk.white('— O agente usa ferramentas para ler/criar/editar código'))
  console.log(chalk.gray('  /limpar           ') + chalk.white('— Esquece a conversa atual e limpa o histórico'))
  console.log(chalk.gray('  /sair             ') + chalk.white('— Encerra a conversa e salva o histórico\n'))

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('  você › ')
  })

  // INTERCEPTA O CTRL+C PARA SALVAR O HISTÓRICO
  rl.on('SIGINT', () => {
    saveHistory(projectRoot, sessionMessages)
    console.log(chalk.gray('\n  Tchau!\n'))
    process.exit(0)
  })

  rl.prompt()

  rl.on('line', async (input: string) => {
    const userInput = input.trim()
    if (!userInput) { rl.prompt(); return }

    if (userInput === '/sair') {
      saveHistory(projectRoot, sessionMessages)
      console.log(chalk.gray('  Tchau!\n'))
      process.exit(0)
    }

    if (userInput === '/limpar') {
      sessionMessages.length = 0 // Limpa a array
      saveHistory(projectRoot, sessionMessages) // Salva vazio
      console.log(chalk.green('  ✨ Memória apagada! Começando uma conversa do zero.\n'))
      rl.prompt()
      return
    }

    // ── MODO AUTÔNOMO (/agir) ───────────────────────────────────────────────

    if (userInput.startsWith('/agir ')) {
      rl.pause()

      const rawInstruction = userInput.replace(/^\/agir\s+/, '').trim()

      const recentHistory = sessionMessages.slice(-6)

      const historyContext = recentHistory.length > 0
        ? recentHistory
          .map(m => {
            const role = m.role === 'user' ? 'Usuário' : 'Agente'
            const preview = m.content.length > 300
              ? m.content.slice(0, 300) + '...'
              : m.content
            return `${role}: ${preview}`
          })
          .join('\n')
        : ''

      const enrichedInstruction = historyContext
        ? `Contexto da conversa recente (use para entender o objetivo):\n${historyContext}\n\n---\n\nAção solicitada: ${rawInstruction}`
        : rawInstruction

      const actSpinner = ora('Pensando e agindo...').start()

      const result = await runAgent({
        instruction: enrichedInstruction,
        profile: config.profile,
        projectRoot,
        aiConfig: config.ai,
        mode: 'generate',
        onStep: (step) => {
          if (step.type === 'tool_call') {
            actSpinner.text = `Executando: ${step.tool}...`
          } else if (step.type === 'thinking') {
            actSpinner.text = step.content
          }
        }
      })

      actSpinner.stop()

      if (result.success) {
        console.log(chalk.green(`\n  agente › ${result.response}\n`))

        if (result.files && result.files.length > 0) {
          console.log(chalk.bold('  Arquivos criados/modificados:'))
          result.files.forEach(f =>
            console.log(chalk.white(`    + ${f.replace(projectRoot + '/', '')}`))
          )
          console.log('')
        }

        sessionMessages.push({ role: 'user', content: userInput })
        sessionMessages.push({ role: 'assistant', content: result.response })

      } else {
        console.log(chalk.red(`\n  agente › Erro: ${result.error}\n`))
      }

      rl.resume()
      rl.prompt()
      return
    }

    // ── VALIDAÇÃO DE COMANDOS INVÁLIDOS ─────────────────────────────────────

    if (userInput.startsWith('/')) {
      console.log(chalk.yellow(`\n  ⚠️  Comando inválido: ${userInput.split(' ')[0]}`))
      console.log(chalk.gray('  Comandos disponíveis: /agir <instrução>, /limpar ou /sair\n'))
      rl.prompt()
      return
    }

    // ── MODO BATE-PAPO NORMAL ───────────────────────────────────────────────

    rl.pause()
    console.log('')

    try {
      const ctx = await buildContext({
        instruction: userInput,
        profile: config.profile,
        projectRoot,
        mode: 'chat'
      })

      if (!ctx.success || !ctx.messages) {
        console.log(chalk.red(`  Erro ao montar contexto: ${ctx.error}\n`))
        rl.resume()
        rl.prompt()
        return
      }

      const systemMsg = ctx.messages[0]
      const userMsg = ctx.messages[1]

      const messagesForLLM: LLMMessage[] = [
        systemMsg,
        ...sessionMessages.slice(-MAX_HISTORY),
        userMsg
      ]

      sessionMessages.push({ role: 'user', content: userInput })

      process.stdout.write(chalk.bold.green('  agente › '))

      let fullResponse = ''

      for await (const chunk of provider.stream(messagesForLLM, { temperature: 0.5 })) {
        process.stdout.write(chunk.content)
        fullResponse += chunk.content
        if (chunk.done) break
      }

      console.log('\n')
      sessionMessages.push({ role: 'assistant', content: fullResponse })

    } catch (err) {
      console.log(chalk.red(`\n  Erro: ${(err as Error).message}\n`))
    }

    rl.resume()
    rl.prompt()
  })
}

export function chatCommand(): Command {
  const cmd = new Command('chat')
  cmd.description('Inicia uma conversa interativa com o agente')
    .action(async () => { await runChat() })
  return cmd
}