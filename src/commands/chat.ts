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
import { loadPattern, listPatterns, formatPatternForInstruction } from './pattern'

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
    if (Array.isArray(parsed)) return parsed
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
    const toSave = messages.slice(-100)
    fs.writeFileSync(historyPath, JSON.stringify(toSave, null, 2), 'utf-8')
  } catch (err) {
    console.log(chalk.red(`\n  ❌ Erro ao salvar histórico: ${(err as Error).message}\n`))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSE DE FLAGS DO /agir
//
// Extrai flags especiais antes de enviar a instrução ao agente.
// Flags suportadas:
//   --pattern <nome>  → injeta um padrão salvo como referência obrigatória
//
// Exemplo:
//   /agir --pattern filtro-paginacao adicionar filtro por razao_social no service de oficina
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedAgirFlags {
  patternName:      string | null
  cleanInstruction: string
}

function parseAgirFlags(rawInstruction: string): ParsedAgirFlags {
  const patternMatch = rawInstruction.match(/--pattern\s+(\S+)/)

  if (!patternMatch) {
    return { patternName: null, cleanInstruction: rawInstruction }
  }

  return {
    patternName:      patternMatch[1],
    cleanInstruction: rawInstruction.replace(patternMatch[0], '').trim()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT PRINCIPAL
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

  const sessionMessages: LLMMessage[] = loadHistory(projectRoot)
  if (sessionMessages.length > 0) {
    console.log(chalk.green(`  📚 Histórico carregado (${sessionMessages.length} mensagens).`))
  }

  console.log(chalk.gray('\n  Comandos disponíveis:'))
  console.log(chalk.gray('  /agir <instrução>                    ') + chalk.white('— Agente lê/cria/edita código'))
  console.log(chalk.gray('  /agir --pattern <nome> <instrução>   ') + chalk.white('— Usa padrão salvo como referência'))
  console.log(chalk.gray('  /limpar                              ') + chalk.white('— Limpa o histórico'))
  console.log(chalk.gray('  /padroes                             ') + chalk.white('— Lista padrões disponíveis'))
  console.log(chalk.gray('  /sair                                ') + chalk.white('— Encerra e salva histórico\n'))

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('  você › ')
  })

  rl.on('SIGINT', () => {
    saveHistory(projectRoot, sessionMessages)
    console.log(chalk.gray('\n  Tchau!\n'))
    process.exit(0)
  })

  rl.prompt()

  rl.on('line', async (input: string) => {
    const userInput = input.trim()
    if (!userInput) { rl.prompt(); return }

    // ── /sair ────────────────────────────────────────────────────────────────
    if (userInput === '/sair') {
      saveHistory(projectRoot, sessionMessages)
      console.log(chalk.gray('  Tchau!\n'))
      process.exit(0)
    }

    // ── /limpar ───────────────────────────────────────────────────────────────
    if (userInput === '/limpar') {
      sessionMessages.length = 0
      saveHistory(projectRoot, sessionMessages)
      console.log(chalk.green('  ✨ Memória apagada!\n'))
      rl.prompt()
      return
    }

    // ── /padroes ──────────────────────────────────────────────────────────────
    // Lista os padrões salvos sem sair do chat
    if (userInput === '/padroes') {
      const patterns = listPatterns(projectRoot)
      if (patterns.length === 0) {
        console.log(chalk.gray('\n  Nenhum padrão salvo. Use: agent pattern save <nome> --file <arquivo>\n'))
      } else {
        console.log(chalk.bold.cyan('\n  📚 Padrões disponíveis:\n'))
        patterns.forEach(p => {
          const isMulti = p.files && p.files.length > 1
          const tag = isMulti ? chalk.cyan(' [multi-arquivo]') : ''
          const desc = p.description ? chalk.gray(` — ${p.description}`) : ''
          console.log(chalk.white(`    • ${p.name}`) + tag + desc)
          if (isMulti && p.files) {
            p.files.forEach(f => console.log(chalk.gray(`        [${f.role}] ${f.sourcePath}`)))
          }
        })
        console.log(chalk.gray('\n  Uso no chat: /agir --pattern <nome> <instrução>\n'))
      }
      rl.prompt()
      return
    }

    // ── MODO AUTÔNOMO (/agir) ─────────────────────────────────────────────────
    if (userInput.startsWith('/agir ')) {
      rl.pause()

      const rawInstruction = userInput.replace(/^\/agir\s+/, '').trim()

      // ── Extrai --pattern se presente ───────────────────────────────────────
      const { patternName, cleanInstruction } = parseAgirFlags(rawInstruction)

      let patternBlock = ''

      if (patternName) {
        const pattern = loadPattern(patternName, projectRoot)

        if (pattern) {
          patternBlock = formatPatternForInstruction(pattern)

          const isMulti = pattern.files && pattern.files.length > 1
          console.log(chalk.green(`\n  📌 Padrão: ${chalk.white(pattern.name)}`) +
            (isMulti ? chalk.cyan(' [multi-arquivo]') : ''))

          if (isMulti && pattern.files) {
            pattern.files.forEach(f =>
              console.log(chalk.gray(`     • [${f.role}] ${f.sourcePath}`))
            )
          }
          console.log('')

        } else {
          // Padrão não encontrado — avisa mas continua sem ele
          console.log(chalk.yellow(`\n  ⚠️  Padrão "${patternName}" não encontrado.`))
          const available = listPatterns(projectRoot)
          if (available.length > 0) {
            console.log(chalk.gray(`  Disponíveis: ${available.map(p => p.name).join(', ')}`))
          }
          console.log(chalk.gray('  Continuando sem padrão...\n'))
        }
      }

      // ── Monta histórico recente para contexto ───────────────────────────────
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

      // ── Monta a instrução final ─────────────────────────────────────────────
      // Ordem: padrão → aviso de adaptação → histórico → instrução do usuário
      const parts: string[] = []

      if (patternBlock) {
        parts.push(patternBlock)
        parts.push(`
⚠️  ADAPTAÇÃO OBRIGATÓRIA:
O padrão acima define a ESTRUTURA e a LÓGICA a seguir.
Adapte apenas os campos, nomes de variáveis e caminhos conforme a instrução abaixo.
NÃO reescreva do zero — leia o arquivo existente primeiro, depois edite cirurgicamente.`)
        parts.push('---')
      }

      if (historyContext) {
        parts.push(`Contexto da conversa recente (use para entender o objetivo):\n${historyContext}\n\n---`)
      }

      parts.push(`Ação solicitada: ${cleanInstruction}`)

      const enrichedInstruction = parts.join('\n\n')

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

    // ── VALIDAÇÃO DE COMANDOS INVÁLIDOS ───────────────────────────────────────
    if (userInput.startsWith('/')) {
      console.log(chalk.yellow(`\n  ⚠️  Comando inválido: ${userInput.split(' ')[0]}`))
      console.log(chalk.gray('  Comandos: /agir, /agir --pattern <nome>, /padroes, /limpar, /sair\n'))
      rl.prompt()
      return
    }

    // ── MODO BATE-PAPO NORMAL ─────────────────────────────────────────────────
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