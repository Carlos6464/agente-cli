import chalk from 'chalk'
import ora   from 'ora'
const readline = require('readline')
const fs       = require('fs')
const path     = require('path')
import { Command } from 'commander'

import { loadConfig, hasConfig }         from './init'
import { OllamaProvider }                from '../providers/ollama.provider'
import { buildContext }                  from '../core/context-builder/context-builder'
import { LLMMessage }                    from '../providers/llm-provider.interface'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT CHAT
//
// Conversa livre com o agente no contexto do projeto.
// Mantém histórico da sessão em memória e persiste no disco.
//
// Funcionalidades:
//   - Streaming da resposta em tempo real (igual ao ChatGPT)
//   - Histórico da conversa em memória (o LLM "lembra" do que foi dito)
//   - Contexto do RAG injetado em cada mensagem
//   - Histórico persistido em .agent/history.json
//   - Comandos especiais: /sair, /limpar, /historico, /ajuda
// ─────────────────────────────────────────────────────────────────────────────

const MAX_HISTORY_MESSAGES = 20   // máximo de mensagens mantidas em memória
const HISTORY_FILE         = '.agent/history.json'

interface ChatMessage {
  role:      'user' | 'assistant'
  content:   string
  timestamp: string
}

// ─────────────────────────────────────────────────────────────────────────────
// COMANDO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export async function runChat(options: { projectRoot?: string } = {}) {
  const projectRoot = options.projectRoot || process.cwd()

  console.log('')
  console.log(chalk.bold.cyan('  💬 Agent Chat'))

  // ── 1. Carrega config ──────────────────────────────────────────────────────

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('\n  ❌ Projeto não inicializado.'))
    console.log(chalk.yellow('  Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const config  = loadConfig(projectRoot)!
  const profile = config.profile
  const provider = new OllamaProvider(config.ollama.defaultModel, config.ollama.baseUrl)

  // ── 2. Verifica Ollama ─────────────────────────────────────────────────────

  const spinner = ora('Conectando ao Ollama...').start()
  const available = await provider.isAvailable()

  if (!available) {
    spinner.fail('Ollama não está rodando. Inicie com: ollama serve')
    process.exit(1)
  }
  spinner.succeed(`Conectado — ${config.ollama.defaultModel}`)

  // ── 3. Carrega histórico ───────────────────────────────────────────────────

  const history = loadHistory(projectRoot)
  const sessionMessages: LLMMessage[] = []  // histórico da sessão em memória

  // Exibe informações do projeto
  console.log(chalk.gray(`\n  Projeto: ${chalk.white(profile.projectName)}`))
  console.log(chalk.gray(`  Stack:   ${chalk.white([profile.language, profile.backend !== 'none' ? profile.backend : '', profile.frontend !== 'none' ? profile.frontend : ''].filter(Boolean).join(' + '))}`))

  if (history.length > 0) {
    console.log(chalk.gray(`  Histórico: ${history.length} mensagem(ns) anterior(es) carregada(s)`))
  }

  console.log('')
  console.log(chalk.gray('  Comandos: /sair  /limpar  /historico  /ajuda'))
  console.log(chalk.gray('  ' + '─'.repeat(50)))
  console.log('')

  // ── 4. Loop de conversa ───────────────────────────────────────────────────

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('  você › ')
  })

  rl.prompt()

  rl.on('line', async (input: string) => {
    const userInput = input.trim()

    if (!userInput) {
      rl.prompt()
      return
    }

    // ── Comandos especiais ───────────────────────────────────────────────────

    if (userInput === '/sair' || userInput === '/exit' || userInput === 'sair') {
      saveHistory(projectRoot, history, sessionMessages)
      console.log(chalk.gray('\n  Histórico salvo. Até logo!\n'))
      rl.close()
      process.exit(0)
    }

    if (userInput === '/limpar') {
      sessionMessages.length = 0
      clearHistory(projectRoot)
      console.log(chalk.yellow('\n  Histórico limpo.\n'))
      rl.prompt()
      return
    }

    if (userInput === '/historico') {
      printHistory(history, sessionMessages)
      rl.prompt()
      return
    }

    if (userInput === '/ajuda') {
      printHelp()
      rl.prompt()
      return
    }

    // ── Processa mensagem do usuário ─────────────────────────────────────────

    rl.pause()
    console.log('')

    try {
      // Monta o contexto com RAG para essa mensagem
      const contextResult = await buildContext({
        instruction: userInput,
        profile,
        projectRoot,
        baseUrl:     config.ollama.baseUrl,
        mode:        'chat',
        topK:        4
      })

      if (!contextResult.success || !contextResult.messages) {
        console.log(chalk.red(`  Erro ao montar contexto: ${contextResult.error}\n`))
        rl.resume()
        rl.prompt()
        return
      }

      // Monta as mensagens para o LLM:
      // system prompt do context builder + histórico da sessão + mensagem atual
      const systemMsg  = contextResult.messages.find(m => m.role === 'system')!
      const userMsg    = contextResult.messages.find(m => m.role === 'user')!

      const messagesForLLM: LLMMessage[] = [
        systemMsg,
        // Injeta histórico da sessão (sem o system prompt — só user/assistant)
        ...sessionMessages.slice(-MAX_HISTORY_MESSAGES),
        userMsg
      ]

      // Adiciona mensagem do usuário ao histórico da sessão
      sessionMessages.push({ role: 'user', content: userInput })

      // ── Streaming da resposta ──────────────────────────────────────────────

      process.stdout.write(chalk.bold.green('  agente › '))

      let fullResponse = ''

      for await (const chunk of provider.stream(messagesForLLM, { temperature: 0.5 })) {
        process.stdout.write(chunk.content)
        fullResponse += chunk.content
        if (chunk.done) break
      }

      console.log('\n')

      // Adiciona resposta do agente ao histórico da sessão
      sessionMessages.push({ role: 'assistant', content: fullResponse })

    } catch (err) {
      console.log(chalk.red(`\n  Erro: ${(err as Error).message}\n`))
    }

    rl.resume()
    rl.prompt()
  })

  rl.on('close', () => {
    saveHistory(projectRoot, history, sessionMessages)
    console.log('')
    process.exit(0)
  })

  // Ctrl+C limpo
  process.on('SIGINT', () => {
    saveHistory(projectRoot, history, sessionMessages)
    console.log(chalk.gray('\n\n  Histórico salvo. Até logo!\n'))
    process.exit(0)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTÓRICO
// ─────────────────────────────────────────────────────────────────────────────

function loadHistory(projectRoot: string): ChatMessage[] {
  const historyPath = path.join(projectRoot, HISTORY_FILE)
  try {
    if (!fs.existsSync(historyPath)) return []
    return JSON.parse(fs.readFileSync(historyPath, 'utf-8')) as ChatMessage[]
  } catch {
    return []
  }
}

function saveHistory(
  projectRoot:     string,
  existing:        ChatMessage[],
  sessionMessages: LLMMessage[]
): void {
  const historyPath = path.join(projectRoot, HISTORY_FILE)
  const dir         = path.dirname(historyPath)

  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    // Converte mensagens da sessão para o formato de histórico
    const newMessages: ChatMessage[] = sessionMessages.map(m => ({
      role:      m.role as 'user' | 'assistant',
      content:   m.content,
      timestamp: new Date().toISOString()
    }))

    // Mantém apenas as últimas 100 mensagens no histórico persistido
    const allMessages = [...existing, ...newMessages].slice(-100)
    fs.writeFileSync(historyPath, JSON.stringify(allMessages, null, 2), 'utf-8')
  } catch {
    // Silencia erro de escrita
  }
}

function clearHistory(projectRoot: string): void {
  const historyPath = path.join(projectRoot, HISTORY_FILE)
  try {
    if (fs.existsSync(historyPath)) {
      fs.writeFileSync(historyPath, '[]', 'utf-8')
    }
  } catch {}
}

function printHistory(existing: ChatMessage[], session: LLMMessage[]): void {
  console.log('')
  console.log(chalk.bold('  Histórico da sessão atual:\n'))

  if (session.length === 0) {
    console.log(chalk.gray('  (nenhuma mensagem ainda)\n'))
    return
  }

  session.forEach(msg => {
    const label = msg.role === 'user'
      ? chalk.cyan('  você › ')
      : chalk.green('  agente › ')
    const preview = msg.content.slice(0, 120) + (msg.content.length > 120 ? '...' : '')
    console.log(label + chalk.gray(preview))
  })

  console.log('')

  if (existing.length > 0) {
    console.log(chalk.gray(`  + ${existing.length} mensagem(ns) de sessões anteriores em .agent/history.json\n`))
  }
}

function printHelp(): void {
  console.log('')
  console.log(chalk.bold('  Comandos disponíveis:\n'))
  console.log(chalk.white('  /sair      ') + chalk.gray('Encerra o chat e salva histórico'))
  console.log(chalk.white('  /limpar    ') + chalk.gray('Limpa o histórico da sessão e do disco'))
  console.log(chalk.white('  /historico ') + chalk.gray('Exibe mensagens da sessão atual'))
  console.log(chalk.white('  /ajuda     ') + chalk.gray('Exibe esta mensagem'))
  console.log('')
  console.log(chalk.gray('  Dicas:'))
  console.log(chalk.gray('  • Pergunte sobre qualquer parte do código do projeto'))
  console.log(chalk.gray('  • Peça para explicar, refatorar ou revisar código'))
  console.log(chalk.gray('  • O agente usa o RAG para buscar contexto relevante automaticamente'))
  console.log('')
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMANDER WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

export function chatCommand(): Command {
  const command = new Command('chat')

  command
    .description('Inicia uma conversa com o agente no contexto do projeto atual')
    .action(async () => {
      await runChat()
    })

  return command
}