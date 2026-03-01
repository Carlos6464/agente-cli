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
import { runAgent }                      from '../core/agent/agent-core' // <-- NOVO IMPORT

// ─────────────────────────────────────────────────────────────────────────────
// AGENT CHAT
// ─────────────────────────────────────────────────────────────────────────────

const MAX_HISTORY_MESSAGES = 20
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
  const sessionMessages: LLMMessage[] = []

  console.log(chalk.gray(`\n  Projeto: ${chalk.white(profile.projectName)}`))
  console.log(chalk.gray(`  Stack:   ${chalk.white([profile.language, profile.backend !== 'none' ? profile.backend : '', profile.frontend !== 'none' ? profile.frontend : ''].filter(Boolean).join(' + '))}`))

  if (history.length > 0) {
    console.log(chalk.gray(`  Histórico: ${history.length} mensagem(ns) anterior(es) carregada(s)`))
  }

  console.log('')
  console.log(chalk.gray('  Comandos: /sair  /limpar  /historico  /ajuda  /agir'))
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

    // ── NOVO COMANDO: MODO AÇÃO (/agir) ──────────────────────────────────────
    if (userInput.startsWith('/agir ') || userInput.startsWith('/gerar ')) {
      const instruction = userInput.replace(/^\/(agir|gerar)\s+/, '').trim()
      
      rl.pause()
      console.log(chalk.blue('\n  🚀 Iniciando modo de ação autônoma...\n'))
      const actSpinner = ora('Pensando e agindo...').start()

      try {
        // Envia a instrução somada ao contexto do histórico da sessão
        const contextualInstruction = `Considerando a conversa até aqui, faça o seguinte: ${instruction}`

        const result = await runAgent({
          instruction: contextualInstruction,
          profile,
          projectRoot,
          baseUrl: config.ollama.baseUrl,
          mode: 'generate', // Usa o modo generate para liberar as tools (write_file, etc)
          maxSteps: 20,
          onStep: (step) => {
            if (step.type === 'thinking') {
              actSpinner.text = `Pensando... (${step.content})`
            }
            if (step.type === 'tool_call') {
              const tool = step.tool || ''
              if (tool === 'write_file') {
                const match = step.content.match(/write_file\(.*?"path":"([^"]+)"/)
                const filePath = match ? match[1] : 'arquivo'
                actSpinner.text = `Criando ${filePath}...`
              } else if (tool === 'read_file') {
                actSpinner.text = `Lendo referências...`
              }
            }
          }
        })

        actSpinner.stop()

        if (result.success) {
          console.log(chalk.green(`\n  agente › ${result.response}\n`))

          if (result.files && result.files.length > 0) {
            console.log(chalk.bold.green('  ✅ Arquivos criados/modificados:'))
            result.files.forEach(f => console.log(chalk.white(`    + ${f}`)))
            console.log('')
          }

          // Salva no histórico para que o chat normal lembre do que foi feito
          sessionMessages.push({ role: 'user', content: userInput })
          sessionMessages.push({ role: 'assistant', content: `Arquivos gerados/modificados. Resumo: ${result.response}` })
        } else {
          console.log(chalk.red(`\n  ❌ Erro: ${result.error}\n`))
        }

      } catch (err) {
        actSpinner.stop()
        console.log(chalk.red(`\n  Erro: ${(err as Error).message}\n`))
      }

      rl.resume()
      rl.prompt()
      return
    }

    // ── Processa mensagem do usuário (Modo Padrão / Stream) ──────────────────

    rl.pause()
    console.log('')

    try {
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

      const systemMsg  = contextResult.messages.find(m => m.role === 'system')!
      const userMsg    = contextResult.messages.find(m => m.role === 'user')!

      const messagesForLLM: LLMMessage[] = [
        systemMsg,
        ...sessionMessages.slice(-MAX_HISTORY_MESSAGES),
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

  rl.on('close', () => {
    saveHistory(projectRoot, history, sessionMessages)
    console.log('')
    process.exit(0)
  })

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

    const newMessages: ChatMessage[] = sessionMessages.map(m => ({
      role:      m.role as 'user' | 'assistant',
      content:   m.content,
      timestamp: new Date().toISOString()
    }))

    const allMessages = [...existing, ...newMessages].slice(-100)
    fs.writeFileSync(historyPath, JSON.stringify(allMessages, null, 2), 'utf-8')
  } catch {}
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
  console.log(chalk.white('  /agir      ') + chalk.gray('Usa o LLM de forma autônoma para criar e modificar arquivos (Ex: /agir Crie o model X)'))
  console.log(chalk.white('  /ajuda     ') + chalk.gray('Exibe esta mensagem'))
  console.log('')
}

export function chatCommand(): Command {
  const command = new Command('chat')
  command
    .description('Inicia uma conversa com o agente no contexto do projeto atual')
    .action(async () => {
      await runChat()
    })
  return command
}