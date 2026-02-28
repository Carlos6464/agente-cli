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
    topK?:       number    // quantos resultados retornar (padrão: 5)
    baseUrl?:    string
    model?:      string
    onlyCode?:   boolean   // filtra só arquivos de código (ignora config e docs)
  } = {}
): Promise<RetrieveResult> {
  const {
    topK     = 5,
    baseUrl  = 'http://localhost:11434',
    model    = EMBEDDING_MODEL,
    onlyCode = false
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

    // Gera o embedding da query
    const queryEmbedding = await embed(query, baseUrl, model)

    if (!queryEmbedding.success || !queryEmbedding.vector) {
      return { success: false, error: queryEmbedding.error }
    }

    // Busca no vector store — pega mais resultados do que o topK
    // para poder filtrar e ainda ter resultados suficientes
    const rawResults: SearchResult[] = store.search(queryEmbedding.vector, topK * 2)

    // Aplica filtros
    let filtered = rawResults
    if (onlyCode) {
      filtered = filtered.filter(r => r.entry.metadata.type === 'code')
    }

    // Remove duplicatas do mesmo arquivo nas mesmas linhas
    const seen    = new Set<string>()
    const unique  = filtered.filter(r => {
      const key = `${r.entry.metadata.filePath}:${r.entry.metadata.startLine}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Formata o resultado final
    const contexts: RetrievedContext[] = unique
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
//
// Transforma os resultados do retriever em um bloco de texto
// que vai ser inserido no system prompt do LLM
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
    '## Exemplos do projeto atual para referência:',
    '',
    ...blocks
  ].join('\n')
}