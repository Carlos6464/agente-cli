import chalk from 'chalk'
import { OllamaProvider, OLLAMA_MODELS } from './providers/ollama.provider'

function separator(title: string) {
  console.log('\n' + chalk.bgMagenta.white(` ${title} `) + '\n')
}
function ok(msg: string)   { console.log(chalk.green('  ✅ ' + msg)) }
function fail(msg: string) { console.log(chalk.red('  ❌ ' + msg)) }
function info(msg: string) { console.log(chalk.gray('  → ' + msg)) }

async function main() {

  // ── TESTE 1: Ollama está rodando? ──────────────────────────────────────────

  separator('TESTE 1 — Verifica se o Ollama está rodando')

  const provider = new OllamaProvider()
  const available = await provider.isAvailable()

  if (!available) {
    fail('Ollama não está rodando')
    info('Inicie com: ollama serve')
    info('Ou rode o Ollama App se estiver no desktop')
    process.exit(1)
  }

  ok('Ollama está rodando em http://localhost:11434')
  info(`Provider: ${provider.name}`)
  info(`Modelo padrão: ${provider.model}`)

  // ── TESTE 2: Lista modelos disponíveis ────────────────────────────────────

  separator('TESTE 2 — Lista modelos instalados')

  const models = await provider.listModels()

  if (models.length === 0) {
    fail('Nenhum modelo instalado')
    info('Instale com: ollama pull deepseek-coder-v2')
    process.exit(1)
  }

  ok(`${models.length} modelo(s) encontrado(s):`)
  models.forEach(m => info(m))

  // Verifica se os modelos que precisamos estão disponíveis
  const hasDefault = models.some(m => m.includes('deepseek-coder-v2'))
  const hasFast    = models.some(m => m.includes('deepseek-coder:1.3b'))

  if (hasDefault) ok(`Modelo principal disponível: ${OLLAMA_MODELS.DEFAULT}`)
  else            fail(`Modelo principal não encontrado: ${OLLAMA_MODELS.DEFAULT}`)

  if (hasFast) ok(`Modelo leve disponível: ${OLLAMA_MODELS.FAST}`)
  else         info(`Modelo leve não encontrado: ${OLLAMA_MODELS.FAST} (opcional)`)

  // ── TESTE 3: Geração completa com modelo principal ────────────────────────

  separator('TESTE 3 — Geração completa (complete) com modelo principal')

  info(`Enviando pergunta para ${OLLAMA_MODELS.DEFAULT}...`)
  info('Aguarde — pode demorar alguns segundos na primeira vez\n')

  const result = await provider.complete([
    {
      role: 'system',
      content: 'Você é um assistente de programação. Responda de forma curta e direta em português.'
    },
    {
      role: 'user',
      content: 'Em uma linha: qual é a diferença entre interface e type no TypeScript?'
    }
  ], { temperature: 0.1 })

  if (result.success) {
    ok(`Resposta recebida do modelo: ${result.model}`)
    console.log('\n' + chalk.white('  ' + result.content) + '\n')
  } else {
    fail(`Erro: ${result.error}`)
  }

  // ── TESTE 4: Streaming com modelo principal ───────────────────────────────

  separator('TESTE 4 — Streaming com modelo principal')

  info('A resposta vai aparecer sendo gerada em tempo real:\n')
  process.stdout.write('  ')

  let streamedContent = ''
  let chunkCount = 0

  for await (const chunk of provider.stream([
    {
      role: 'system',
      content: 'Você é um assistente de programação. Responda em português, de forma breve.'
    },
    {
      role: 'user',
      content: 'Dê um exemplo de uma função TypeScript que soma dois números.'
    }
  ], { temperature: 0.3 })) {
    process.stdout.write(chunk.content)
    streamedContent += chunk.content
    chunkCount++
    if (chunk.done) break
  }

  console.log('\n')
  ok(`Streaming concluído — ${chunkCount} chunks recebidos`)

  // ── TESTE 5: Modelo leve (se disponível) ─────────────────────────────────

  if (hasFast) {
    separator('TESTE 5 — Geração com modelo leve (fast)')

    const fastProvider = new OllamaProvider(OLLAMA_MODELS.FAST)
    info(`Usando: ${OLLAMA_MODELS.FAST}`)

    const fastResult = await fastProvider.complete([
      {
        role: 'user',
        content: 'Responda só com "ok" se você está funcionando.'
      }
    ], { temperature: 0, maxTokens: 10 })

    if (fastResult.success) {
      ok(`Modelo leve respondeu: "${fastResult.content?.trim()}"`)
    } else {
      fail(`Erro: ${fastResult.error}`)
    }
  }

  // ── TESTE 6: Erro de conexão ──────────────────────────────────────────────

  separator('TESTE 6 — Testa erro de conexão com porta errada')

  const wrongProvider = new OllamaProvider(OLLAMA_MODELS.DEFAULT, 'http://localhost:99999')
  const wrongResult   = await wrongProvider.complete([
    { role: 'user', content: 'teste' }
  ])

  if (!wrongResult.success) {
    ok(`Erro tratado corretamente: ${wrongResult.error}`)
  } else {
    fail('Deveria ter retornado erro')
  }

  separator('TODOS OS TESTES CONCLUÍDOS')
}

main().catch(err => {
  console.error(chalk.red('\n❌ Erro inesperado:'), err)
  process.exit(1)
})