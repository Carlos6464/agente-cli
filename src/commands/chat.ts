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
  
  const config = loadConfig(projectRoot)!
  const provider = ProviderFactory.create(config.ai)

  console.log(chalk.bold.cyan('\n  💬 Agent Chat'))
  const spinner = ora('Conectando à IA...').start()
  
  if (!(await provider.isAvailable())) { 
    spinner.fail('IA Offline. Verifique sua conexão ou API Key.'); 
    process.exit(1) 
  }
  
  spinner.succeed(`Conectado — ${config.ai.provider} (${config.ai.defaultModel})`)

  // ── MENSAGEM DE AJUDA RESTAURADA ──────────────────────────────────────────
  console.log(chalk.gray('\n  Comandos disponíveis:'))
  console.log(chalk.gray('  /agir <instrução> ') + chalk.white('— O agente usa ferramentas para ler/criar/editar código'))
  console.log(chalk.gray('  /sair             ') + chalk.white('— Encerra a conversa\n'))
  // ──────────────────────────────────────────────────────────────────────────

  const sessionMessages: LLMMessage[] = []
  const rl = readline.createInterface({ 
    input: process.stdin, 
    output: process.stdout, 
    prompt: chalk.cyan('  você › ') 
  })
  
  rl.prompt()

  rl.on('line', async (input: string) => {
    const userInput = input.trim(); 
    if (!userInput) { rl.prompt(); return }
    
    if (userInput === '/sair') { 
      console.log(chalk.gray('  Tchau!\n'))
      process.exit(0) 
    }
    
    // ── MODO AUTÔNOMO (/agir) ───────────────────────────────────────────────
    if (userInput.startsWith('/agir ')) {
      rl.pause()
      const actSpinner = ora('Pensando e agindo...').start()
      
      const result = await runAgent({
        instruction: userInput.replace(/^\/agir /, ''), 
        profile: config.profile, 
        projectRoot, 
        aiConfig: config.ai, 
        mode: 'generate',
        onStep: (step) => { 
          if (step.type === 'tool_call') actSpinner.text = `Executando ferramenta: ${step.tool}...`
          else if (step.type === 'thinking') actSpinner.text = step.content
        }
      })
      
      actSpinner.stop()
      if (result.success) {
        console.log(chalk.green(`\n  agente › ${result.response}\n`))
      } else {
        console.log(chalk.red(`\n  agente › Erro ao agir: ${result.error}\n`))
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
    // ────────────────────────────────────────────────────────────────────────

    // ── MODO BATE-PAPO NORMAL ───────────────────────────────────────────────
    rl.pause()
    console.log('')
    
    const ctx = await buildContext({ instruction: userInput, profile: config.profile, projectRoot, mode: 'chat' })
    const msgs = ctx.messages ? [ctx.messages[0], ...sessionMessages.slice(-MAX_HISTORY), ctx.messages[1]] : []
    sessionMessages.push({ role: 'user', content: userInput })

    process.stdout.write(chalk.bold.green('  agente › '))
    let fullResponse = ''
    
    for await (const chunk of provider.stream(msgs, { temperature: 0.5 })) {
      process.stdout.write(chunk.content)
      fullResponse += chunk.content
      if (chunk.done) break
    }
    
    console.log('\n')
    sessionMessages.push({ role: 'assistant', content: fullResponse })
    
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