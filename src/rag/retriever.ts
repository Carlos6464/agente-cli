import { embed, EMBEDDING_MODEL } from './embeddings'
import { VectorStore, SearchResult } from './vector-store'

// ─────────────────────────────────────────────────────────────────────────────
// RETRIEVER
//
// Dado uma query em texto, encontra os trechos mais relevantes do projeto.
// É a peça que conecta o Context Builder com o Vector Store.
//
// Fluxo:
//   1. Recebe a query em texto ("gerar módulo de pagamentos")
//   2. Gera o embedding da query
//   3. Busca os vetores mais próximos no índice
//   4. Retorna os trechos de código correspondentes
//
// THRESHOLD: 0.55 (era 0.3)
// 0.3 aceita lixo semântico — o LLM recebia chunks não relacionados e
// misturava padrões de arquivos diferentes com o que estava gerando.
// 0.55 garante que só entra contexto genuinamente relevante.
// ─────────────────────────────────────────────────────────────────────────────

export interface RetrievedContext {
  content:    string
  filePath:   string
  startLine:  number
  similarity: number
  type:       'code' | 'config' | 'doc'
}

export interface RetrieveResult {
  success:   boolean
  contexts?: RetrievedContext[]
  error?:    string
}

// ─────────────────────────────────────────────────────────────────────────────
// BUSCA CONTEXTO RELEVANTE
// ─────────────────────────────────────────────────────────────────────────────

export async function retrieve(
  query:       string,
  projectRoot: string = process.cwd(),
  options: {
    topK?:       number
    baseUrl?:    string
    model?:      string
    onlyCode?:   boolean
    // Threshold mínimo de similaridade — abaixo disso o chunk é ignorado
    // 0.55 = relevância genuína, evita poluição do contexto do LLM
    minSimilarity?: number
  } = {}
): Promise<RetrieveResult> {
  const {
    topK          = 5,
    baseUrl       = 'http://localhost:11434',
    model         = EMBEDDING_MODEL,
    onlyCode      = false,
    minSimilarity = 0.55   // ERA 0.3 — aumentado para reduzir alucinação
  } = options

  try {
    const store = new VectorStore(projectRoot)
    const stats = store.stats()

    if (stats.totalEntries === 0) {
      return {
        success: false,
        error:   'Índice vazio — rode "agent init" para indexar o projeto'
      }
    }

    const queryEmbedding = await embed(query, baseUrl, model)

    if (!queryEmbedding.success || !queryEmbedding.vector) {
      return { success: false, error: queryEmbedding.error }
    }

    // Pega mais que o topK para ter margem após filtros
    const rawResults: SearchResult[] = store.search(queryEmbedding.vector, topK * 3)

    // Aplica filtros
    let filtered = rawResults

    if (onlyCode) {
      filtered = filtered.filter(r => r.entry.metadata.type === 'code')
    }

    // ── Threshold de qualidade ────────────────────────────────────────────
    // Remove chunks com baixa similaridade antes de qualquer outra coisa.
    // Isso é a primeira linha de defesa contra alucinação por contexto ruim.
    filtered = filtered.filter(r => r.similarity >= minSimilarity)

    // ── Deduplicação por arquivo e região ────────────────────────────────
    // Evita que o mesmo arquivo apareça várias vezes com chunks próximos,
    // o que confunde o LLM e desperdiça espaço no contexto.
    const seen   = new Set<string>()
    const unique = filtered.filter(r => {
      // Agrupa por arquivo + bloco de 50 linhas para evitar overlap
      const lineBlock = Math.floor(r.entry.metadata.startLine / 50)
      const key       = `${r.entry.metadata.filePath}:${lineBlock}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // ── Limita por arquivo: max 2 chunks do mesmo arquivo ────────────────
    // Evita que um único arquivo domine o contexto inteiro
    const fileCount = new Map<string, number>()
    const balanced  = unique.filter(r => {
      const fp    = r.entry.metadata.filePath
      const count = fileCount.get(fp) || 0
      if (count >= 2) return false
      fileCount.set(fp, count + 1)
      return true
    })

    const contexts: RetrievedContext[] = balanced
      .slice(0, topK)
      .map(r => ({
        content:    r.entry.content,
        filePath:   r.entry.metadata.filePath,
        startLine:  r.entry.metadata.startLine,
        similarity: Math.round(r.similarity * 100) / 100,
        type:       r.entry.metadata.type
      }))

    return { success: true, contexts }

  } catch (err) {
    return { success: false, error: `Erro na busca: ${(err as Error).message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATA O CONTEXTO PARA O PROMPT DO LLM
// ─────────────────────────────────────────────────────────────────────────────

export function formatContextForPrompt(contexts: RetrievedContext[]): string {
  if (contexts.length === 0) return ''

  const blocks = contexts.map((ctx, i) => {
    const relativePath = ctx.filePath.replace(process.cwd() + '/', '')
    return [
      `### Referência ${i + 1}: ${relativePath} (linha ${ctx.startLine}, similaridade: ${ctx.similarity})`,
      '```',
      ctx.content,
      '```'
    ].join('\n')
  })

  return [
    '## Exemplos reais do projeto (use como referência de estilo e estrutura):',
    '',
    ...blocks,
    '',
    '> IMPORTANTE: Esses exemplos são do projeto real. Siga os padrões de import,',
    '> nomenclatura e estrutura que você vê aqui — não use padrões genéricos de treinamento.'
  ].join('\n')
}