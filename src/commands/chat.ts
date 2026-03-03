import chalk from 'chalk'
import ora   from 'ora'
const readline = require('readline')
const fs       = require('fs')
const path     = require('path')
import { Command } from 'commander'

import { loadConfig, hasConfig } from './init'
import { ProviderFactory }       from '../providers/provider.factory'
import { buildContext }          from '../core/context-builder/context-builder'
import { LLMMessage }            from '../providers/llm-provider.interface'
import { runAgent }              from '../core/agent/agent-core'

const MAX_HISTORY = 20

export async function runChat(options: { projectRoot?: string } = {}) {
  const projectRoot = options.projectRoot || process.cwd()

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('\n  ❌ Projeto não inicializado. Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const config   = loadConfig(projectRoot)!
  const provider = ProviderFactory.create(config.ai)

  console.log(chalk.bold.cyan('\n  💬 Agent Chat'))
  const spinner = ora('Conectando à IA...').start()

  if (!(await provider.isAvailable())) {
    spinner.fail('IA Offline. Verifique sua conexão ou API Key.')
    process.exit(1)
  }

  spinner.succeed(`Conectado — ${config.ai.provider} (${config.ai.defaultModel})`)

  console.log(chalk.gray('\n  Comandos disponíveis:'))
  console.log(chalk.gray('  /agir <instrução> ') + chalk.white('— O agente usa ferramentas para ler/criar/editar código'))
  console.log(chalk.gray('  /sair             ') + chalk.white('— Encerra a conversa\n'))

  const sessionMessages: LLMMessage[] = []

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('  você › ')
  })

  rl.prompt()

  rl.on('line', async (input: string) => {
    const userInput = input.trim()
    if (!userInput) { rl.prompt(); return }

    if (userInput === '/sair') {
      console.log(chalk.gray('  Tchau!\n'))
      process.exit(0)
    }

    // ── MODO AUTÔNOMO (/agir) ───────────────────────────────────────────────
    //
    // FIX: O /agir agora injeta o histórico da conversa na instrução.
    //
    // PROBLEMA ANTERIOR: O runAgent recebia só a instrução crua, sem contexto
    // da conversa. Se o usuário conversou 10 mensagens sobre um módulo específico
    // e mandava "/agir crie o service", o agente não sabia do que se tratava
    // e alucinava o objetivo.
    //
    // SOLUÇÃO: Pegamos as últimas N mensagens do sessionMessages e as injetamos
    // como prefixo da instrução, dando ao agente o contexto necessário.

    if (userInput.startsWith('/agir ')) {
      rl.pause()

      const rawInstruction = userInput.replace(/^\/agir\s+/, '').trim()

      // Constrói o contexto do histórico recente da conversa
      // Limita a 6 mensagens (3 turnos) para não estourar o contexto do agente
      const recentHistory = sessionMessages.slice(-6)

      const historyContext = recentHistory.length > 0
        ? recentHistory
            .map(m => {
              const role    = m.role === 'user' ? 'Usuário' : 'Agente'
              const preview = m.content.length > 300
                ? m.content.slice(0, 300) + '...'
                : m.content
              return `${role}: ${preview}`
            })
            .join('\n')
        : ''

      // Instrução enriquecida com o histórico da conversa
      const enrichedInstruction = historyContext
        ? `Contexto da conversa recente (use para entender o objetivo):\n${historyContext}\n\n---\n\nAção solicitada: ${rawInstruction}`
        : rawInstruction

      const actSpinner = ora('Pensando e agindo...').start()

      const result = await runAgent({
        instruction: enrichedInstruction,
        profile:     config.profile,
        projectRoot,
        aiConfig:    config.ai,
        mode:        'generate',
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

        // Adiciona ao histórico para que conversas futuras saibam o que foi feito
        sessionMessages.push({ role: 'user',      content: userInput })
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
      console.log(chalk.gray('  Comandos disponíveis: /agir <instrução> ou /sair\n'))
      rl.prompt()
      return
    }

    // ── MODO BATE-PAPO NORMAL ───────────────────────────────────────────────

    rl.pause()
    console.log('')

    try {
      const ctx = await buildContext({
        instruction: userInput,
        profile:     config.profile,
        projectRoot,
        mode:        'chat'
      })

      if (!ctx.success || !ctx.messages) {
        console.log(chalk.red(`  Erro ao montar contexto: ${ctx.error}\n`))
        rl.resume()
        rl.prompt()
        return
      }

      const systemMsg = ctx.messages[0]
      const userMsg   = ctx.messages[1]

      // Monta as mensagens com o histórico da sessão no meio
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