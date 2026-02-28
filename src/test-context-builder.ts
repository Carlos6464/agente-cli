import chalk from 'chalk'
import { detectStack } from './core/detector/stack-detector'
import { buildContext } from './core/context-builder/context-builder'

function separator(title: string) {
  console.log('\n' + chalk.bgCyan.black(` ${title} `) + '\n')
}
function ok(msg: string)   { console.log(chalk.green('  ✅ ' + msg)) }
function fail(msg: string) { console.log(chalk.red('  ❌ ' + msg)) }
function info(msg: string) { console.log(chalk.gray('  → ' + msg)) }

async function main() {

  // ── Detecta a stack do projeto atual ─────────────────────────────────────

  separator('SETUP — Detecta stack do projeto')

  const detection = detectStack(process.cwd())
  if (!detection.success || !detection.profile) {
    fail(`Erro ao detectar stack: ${detection.error}`)
    process.exit(1)
  }

  const profile = detection.profile
  ok(`Stack detectada: ${profile.language}, ${profile.packageManager}, backend: ${profile.backend}`)

  // ── TESTE 1: Contexto para geração de código ──────────────────────────────

  separator('TESTE 1 — Contexto modo generate')

  const result1 = await buildContext({
    instruction: 'gere um módulo de pagamentos com service e controller',
    profile,
    mode: 'generate',
    topK: 3
  })

  if (!result1.success || !result1.messages) {
    fail(`Erro: ${result1.error}`)
  } else {
    ok(`${result1.messages.length} mensagens montadas`)

    const system = result1.messages.find(m => m.role === 'system')
    const user   = result1.messages.find(m => m.role === 'user')

    info(`System prompt: ${system!.content.length} caracteres`)
    info(`User message:  ${user!.content.length} caracteres`)

    console.log('\n' + chalk.bold('  System Prompt (primeiros 600 chars):'))
    console.log(chalk.gray(system!.content.slice(0, 600) + '...\n'))

    // Verifica se a stack está no system prompt
    const hasLanguage = system!.content.includes(profile.language)
    const hasPkgMgr   = system!.content.includes(profile.packageManager)

    if (hasLanguage) ok(`Linguagem "${profile.language}" presente no system prompt`)
    else             fail(`Linguagem não encontrada no system prompt`)

    if (hasPkgMgr) ok(`Package manager "${profile.packageManager}" presente`)
    else           fail(`Package manager não encontrado`)
  }

  // ── TESTE 2: Contexto modo chat ───────────────────────────────────────────

  separator('TESTE 2 — Contexto modo chat')

  const result2 = await buildContext({
    instruction: 'como o provider do ollama está implementado nesse projeto?',
    profile,
    mode: 'chat',
    topK: 3
  })

  if (!result2.success || !result2.messages) {
    fail(`Erro: ${result2.error}`)
  } else {
    ok(`${result2.messages.length} mensagens montadas para chat`)

    const user = result2.messages.find(m => m.role === 'user')
    const hasRagContext = user!.content.includes('Exemplos do projeto')

    if (hasRagContext) ok('Contexto do RAG incluído na mensagem do usuário')
    else               info('Nenhum contexto do RAG encontrado (índice pode estar vazio)')

    info(`User message: ${user!.content.length} caracteres`)
    console.log('\n' + chalk.bold('  User Message (primeiros 400 chars):'))
    console.log(chalk.gray(user!.content.slice(0, 400) + '...\n'))
  }

  // ── TESTE 3: Contexto modo run ────────────────────────────────────────────

  separator('TESTE 3 — Contexto modo run')

  const result3 = await buildContext({
    instruction: 'rodar os testes do projeto',
    profile,
    mode: 'run',
    topK: 2
  })

  if (!result3.success || !result3.messages) {
    fail(`Erro: ${result3.error}`)
  } else {
    ok(`${result3.messages.length} mensagens montadas para run`)

    const system = result3.messages.find(m => m.role === 'system')
    const hasPkgMgr = system!.content.includes(profile.packageManager)

    if (hasPkgMgr) ok(`Package manager "${profile.packageManager}" nas regras de run`)
    else           fail(`Package manager não encontrado nas regras de run`)
  }

  // ── TESTE 4: Manda o contexto de verdade pro LLM ─────────────────────────

  separator('TESTE 4 — Envia contexto para o LLM e recebe resposta')

  info('Montando contexto e enviando para o deepseek-coder-v2...\n')

  const result4 = await buildContext({
    instruction: 'explique em 3 linhas como as filesystem tools desse projeto estão organizadas',
    profile,
    mode: 'chat',
    topK: 3
  })

  if (!result4.success || !result4.messages) {
    fail(`Erro ao montar contexto: ${result4.error}`)
  } else {
    // Importa o provider e manda de verdade
    const { OllamaProvider } = require('./providers/ollama.provider')
    const provider = new OllamaProvider()

    const llmResult = await provider.complete(result4.messages, { temperature: 0.2 })

    if (llmResult.success) {
      ok('LLM respondeu com base no contexto do projeto:')
      console.log('\n' + chalk.white('  ' + llmResult.content) + '\n')
    } else {
      fail(`Erro do LLM: ${llmResult.error}`)
    }
  }

  separator('TODOS OS TESTES CONCLUÍDOS')
}

main().catch(err => {
  console.error(chalk.red('\n❌ Erro inesperado:'), err)
  process.exit(1)
})