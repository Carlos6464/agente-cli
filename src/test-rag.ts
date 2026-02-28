import chalk from 'chalk'
import { embed, embedBatch, isEmbeddingModelAvailable, EMBEDDING_MODEL } from './rag/embeddings'
import { VectorStore } from './rag/vector-store'
import { indexProject } from './rag/indexer'
import { retrieve, formatContextForPrompt } from './rag/retriever'

function separator(title: string) {
  console.log('\n' + chalk.bgYellow.black(` ${title} `) + '\n')
}
function ok(msg: string)   { console.log(chalk.green('  ✅ ' + msg)) }
function fail(msg: string) { console.log(chalk.red('  ❌ ' + msg)) }
function info(msg: string) { console.log(chalk.gray('  → ' + msg)) }
function warn(msg: string) { console.log(chalk.yellow('  ⚠️  ' + msg)) }

async function main() {

  // ── TESTE 1: Modelo de embeddings disponível? ─────────────────────────────

  separator('TESTE 1 — Verifica modelo de embeddings')

  const available = await isEmbeddingModelAvailable()

  if (!available) {
    fail(`Modelo "${EMBEDDING_MODEL}" não encontrado`)
    warn('Instale com: ollama pull nomic-embed-text')
    process.exit(1)
  }

  ok(`Modelo "${EMBEDDING_MODEL}" disponível`)

  // ── TESTE 2: Gera embedding de um texto ──────────────────────────────────

  separator('TESTE 2 — Gera embedding de um texto')

  const result = await embed('função de autenticação com JWT')

  if (result.success && result.vector) {
    ok(`Embedding gerado com ${result.vector.length} dimensões`)
    info(`Primeiros 5 valores: [${result.vector.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`)
    info(`Modelo: ${result.model}`)
  } else {
    fail(`Erro: ${result.error}`)
    process.exit(1)
  }

  // ── TESTE 3: Embeddings similares têm vetores próximos ───────────────────

  separator('TESTE 3 — Textos similares têm vetores próximos')

  const [emb1, emb2, emb3] = await Promise.all([
    embed('criar módulo de pagamentos NestJS'),
    embed('gerar módulo payments para NestJS'),
    embed('configurar banco de dados PostgreSQL'),
  ])

  if (emb1.success && emb2.success && emb3.success) {
    // Calcula similaridade manualmente para mostrar
    const sim12 = cosineSim(emb1.vector!, emb2.vector!)
    const sim13 = cosineSim(emb1.vector!, emb3.vector!)

    ok(`"criar módulo payments" vs "gerar módulo payments": ${(sim12 * 100).toFixed(1)}% similares`)
    ok(`"criar módulo payments" vs "configurar PostgreSQL": ${(sim13 * 100).toFixed(1)}% similares`)

    if (sim12 > sim13) {
      ok('Correto — frases sobre o mesmo assunto são mais similares entre si')
    } else {
      warn('Resultado inesperado — verifique o modelo de embeddings')
    }
  } else {
    fail('Erro ao gerar embeddings para comparação')
  }

  // ── TESTE 4: Vector Store — add e search ─────────────────────────────────

  separator('TESTE 4 — Vector Store: adiciona e busca entradas')

  const store = new VectorStore(process.cwd())
  store.clear() // começa do zero para o teste

  // Adiciona algumas entradas de exemplo
  const entries = [
    {
      id:      'test:payments:1',
      vector:  emb1.vector!,
      content: 'export class PaymentsModule {}',
      metadata: { filePath: 'src/modules/payments/payments.module.ts', startLine: 1, endLine: 5, type: 'code' as const }
    },
    {
      id:      'test:database:1',
      vector:  emb3.vector!,
      content: 'DATABASE_URL=postgresql://localhost:5432/mydb',
      metadata: { filePath: '.env', startLine: 1, endLine: 1, type: 'config' as const }
    }
  ]

  store.addBatch(entries)
  const stats = store.stats()
  ok(`${stats.totalEntries} entradas no índice (${stats.sizeInKb}kb)`)

  // Busca por algo relacionado a payments
  const queryEmb = await embed('módulo de pagamentos')
  if (queryEmb.success && queryEmb.vector) {
    const results = store.search(queryEmb.vector, 2)
    ok(`${results.length} resultado(s) encontrado(s) para "módulo de pagamentos"`)
    results.forEach(r => {
      info(`  ${r.entry.metadata.filePath} — similaridade: ${(r.similarity * 100).toFixed(1)}%`)
    })
  }

  // ── TESTE 5: Indexa o próprio projeto ────────────────────────────────────

  separator('TESTE 5 — Indexa o projeto agente-cli')

  store.clear() // limpa as entradas de teste antes de indexar de verdade
  info('Isso pode demorar alguns segundos...\n')

  const indexResult = await indexProject({
    projectRoot: process.cwd(),
    forceReindex: true,
    onProgress: (msg) => info(msg)
  })

  console.log('')

  if (indexResult.success) {
    ok(`Indexação concluída!`)
    info(`Arquivos indexados: ${indexResult.filesIndexed}`)
    info(`Chunks criados:     ${indexResult.chunksCreated}`)
    info(`Pulados:            ${indexResult.skipped}`)
    info(`Tamanho do índice:  ${store.stats().sizeInKb}kb`)
  } else {
    fail(`Erro: ${indexResult.error}`)
  }

  // ── TESTE 6: Retrieve — busca contexto relevante ─────────────────────────

  separator('TESTE 6 — Retrieve: busca contexto relevante')

  const queries = [
    'como o provider do ollama está implementado',
    'filesystem tools para ler arquivos',
    'detector de stack do projeto',
  ]

  for (const query of queries) {
    info(`\nBuscando: "${query}"`)
    const retrieved = await retrieve(query, process.cwd(), { topK: 2 })

    if (retrieved.success && retrieved.contexts?.length) {
      retrieved.contexts.forEach(ctx => {
        const rel = ctx.filePath.replace(process.cwd() + '/', '')
        ok(`  ${rel}:${ctx.startLine} (${(ctx.similarity * 100).toFixed(1)}% similar)`)
      })
    } else {
      warn(`  Nenhum resultado — ${retrieved.error || 'índice pode estar vazio'}`)
    }
  }

  // ── TESTE 7: Formata contexto para o prompt ───────────────────────────────

  separator('TESTE 7 — Formata contexto para o LLM')

  const retrieved = await retrieve('ollama provider implementação', process.cwd(), { topK: 2 })

  if (retrieved.success && retrieved.contexts?.length) {
    const formatted = formatContextForPrompt(retrieved.contexts)
    ok('Contexto formatado para o prompt:')
    console.log('\n' + chalk.gray(formatted.slice(0, 400) + '...') + '\n')
  } else {
    warn('Nenhum contexto recuperado para formatar')
  }

  separator('TODOS OS TESTES CONCLUÍDOS')
}

// Função auxiliar de cosine similarity para o teste 3
function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

main().catch(err => {
  console.error(chalk.red('\n❌ Erro inesperado:'), err)
  process.exit(1)
})