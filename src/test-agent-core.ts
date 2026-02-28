import chalk from 'chalk'
import { detectStack }  from './core/detector/stack-detector'
import { runAgent }     from './core/agent/agent-core'
import { AgentStep }    from './core/agent/agent-core'

function separator(title: string) {
  console.log('\n' + chalk.bgRed.white(` ${title} `) + '\n')
}
function ok(msg: string)   { console.log(chalk.green('  ✅ ' + msg)) }
function fail(msg: string) { console.log(chalk.red('  ❌ ' + msg)) }
function info(msg: string) { console.log(chalk.gray('  → ' + msg)) }

// Exibe cada passo do agente em tempo real
function onStep(step: AgentStep) {
  const icons: Record<string, string> = {
    thinking:    '🤔',
    tool_call:   '🔧',
    tool_result: '📋',
    response:    '💬'
  }
  const icon  = icons[step.type] || '•'
  const label = step.type.padEnd(12)
  const text  = step.content.slice(0, 120) + (step.content.length > 120 ? '...' : '')
  console.log(chalk.gray(`  ${icon} [${label}] ${text}`))
}

async function main() {

  // ── Setup ─────────────────────────────────────────────────────────────────

  const detection = detectStack(process.cwd())
  if (!detection.success || !detection.profile) {
    fail('Erro ao detectar stack')
    process.exit(1)
  }
  const profile = detection.profile

  // ── TESTE 1: Agente responde uma pergunta simples ─────────────────────────

  separator('TESTE 1 — Pergunta simples (modo chat)')

  info('Instrução: "quais ferramentas esse projeto tem para acessar o filesystem?"')
  console.log('')

  const result1 = await runAgent({
    instruction: 'quais ferramentas esse projeto tem para acessar o filesystem?',
    profile,
    mode:     'chat',
    maxSteps: 5,
    onStep
  })

  console.log('')

  if (result1.success) {
    ok('Agente respondeu:')
    console.log('\n' + chalk.white(result1.response) + '\n')
    info(`Passos executados: ${result1.steps.length}`)
  } else {
    fail(`Erro: ${result1.error}`)
  }

  // ── TESTE 2: Agente usa ferramentas para explorar o projeto ───────────────

  separator('TESTE 2 — Agente usa list_dir e read_file')

  info('Instrução: "liste a estrutura da pasta src e me diga quantos arquivos de teste existem"')
  console.log('')

  const result2 = await runAgent({
    instruction: 'liste a estrutura da pasta src e me diga quantos arquivos de teste existem',
    profile,
    mode:     'chat',
    maxSteps: 8,
    onStep
  })

  console.log('')

  if (result2.success) {
    ok('Agente respondeu:')
    console.log('\n' + chalk.white(result2.response) + '\n')

    const toolCalls = result2.steps.filter(s => s.type === 'tool_call')
    info(`Ferramentas usadas: ${toolCalls.length}`)
    toolCalls.forEach(s => info(`  • ${s.tool}: ${s.content.slice(0, 80)}`))
  } else {
    fail(`Erro: ${result2.error}`)
  }

  // ── TESTE 3: Agente gera um arquivo simples ───────────────────────────────

  separator('TESTE 3 — Agente cria um arquivo')

  info('Instrução: "crie o arquivo src/utils/date.utils.ts com uma função formatDate que recebe uma Date e retorna string no formato DD/MM/YYYY"')
  console.log('')

  const result3 = await runAgent({
    instruction: 'crie o arquivo src/utils/date.utils.ts com uma função formatDate que recebe uma Date e retorna string no formato DD/MM/YYYY',
    profile,
    mode:     'generate',
    maxSteps: 10,
    onStep
  })

  console.log('')

  if (result3.success) {
    ok('Agente concluiu:')
    console.log('\n' + chalk.white(result3.response) + '\n')

    if (result3.files && result3.files.length > 0) {
      ok(`Arquivos criados: ${result3.files.join(', ')}`)
    }
  } else {
    fail(`Erro: ${result3.error}`)
  }

  // ── Limpeza ───────────────────────────────────────────────────────────────

  separator('LIMPEZA')

  const fs = require('fs')
  try {
    if (fs.existsSync('./src/utils')) {
      fs.rmSync('./src/utils', { recursive: true, force: true })
      ok('Pasta src/utils removida')
    }
  } catch (e) {
    info('Nada para limpar')
  }

  separator('TODOS OS TESTES CONCLUÍDOS')
}

main().catch(err => {
  console.error(chalk.red('\n❌ Erro inesperado:'), err)
  process.exit(1)
})