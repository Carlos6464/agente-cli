// ─────────────────────────────────────────────────────────────────────────────
// EMBEDDINGS
//
// Transforma texto em vetores numéricos usando o Ollama.
// Vetores representam o "significado" do texto de forma matemática.
// Textos com significados parecidos ficam próximos no espaço vetorial.
//
// Exemplo:
//   "create payment module"  → [0.12, -0.45, 0.89, ...]
//   "generate payments repo" → [0.11, -0.43, 0.91, ...]  ← próximo!
//   "configure database"     → [-0.67, 0.23, -0.12, ...] ← distante
//
// Modelo usado: nomic-embed-text (274MB, especializado em embeddings)
// Endpoint: POST /api/embeddings
// ─────────────────────────────────────────────────────────────────────────────

export const EMBEDDING_MODEL = 'nomic-embed-text'
export const EMBEDDING_DIMENSIONS = 768 // dimensões do nomic-embed-text

export interface EmbeddingResult {
  success:    boolean
  vector?:    number[]
  model?:     string
  error?:     string
}

export interface BatchEmbeddingResult {
  success:    boolean
  vectors?:   number[][]
  model?:     string
  error?:     string
}

// ─────────────────────────────────────────────────────────────────────────────
// GERA EMBEDDING DE UM TEXTO
// ─────────────────────────────────────────────────────────────────────────────

export async function embed(
  text:     string,
  baseUrl:  string = 'http://localhost:11434',
  model:    string = EMBEDDING_MODEL
): Promise<EmbeddingResult> {
  try {
    // Limpa e normaliza o texto antes de gerar o embedding
    // Textos muito longos são truncados para não exceder o limite do modelo
    const cleanText = text.trim().slice(0, 8000)

    if (!cleanText) {
      return { success: false, error: 'Texto vazio — não é possível gerar embedding' }
    }

    const response = await fetch(`${baseUrl}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model, prompt: cleanText })
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Ollama retornou erro ${response.status}: ${errorText}`
      }
    }

    const data = await response.json() as { embedding: number[] }

    if (!data.embedding || data.embedding.length === 0) {
      return { success: false, error: 'Ollama retornou embedding vazio' }
    }

    return {
      success: true,
      vector:  data.embedding,
      model
    }

  } catch (err) {
    if ((err as any).cause?.code === 'ECONNREFUSED') {
      return { success: false, error: 'Ollama não está rodando. Inicie com: ollama serve' }
    }
    return { success: false, error: `Erro ao gerar embedding: ${(err as Error).message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GERA EMBEDDINGS DE MÚLTIPLOS TEXTOS (em lote)
// Processa um por um para não sobrecarregar o Ollama
// ─────────────────────────────────────────────────────────────────────────────

export async function embedBatch(
  texts:    string[],
  baseUrl:  string = 'http://localhost:11434',
  model:    string = EMBEDDING_MODEL,
  onProgress?: (current: number, total: number) => void
): Promise<BatchEmbeddingResult> {
  try {
    const vectors: number[][] = []

    for (let i = 0; i < texts.length; i++) {
      const result = await embed(texts[i], baseUrl, model)

      if (!result.success || !result.vector) {
        return {
          success: false,
          error: `Falha ao gerar embedding ${i + 1}/${texts.length}: ${result.error}`
        }
      }

      vectors.push(result.vector)

      // Callback de progresso para mostrar ao usuário durante a indexação
      if (onProgress) onProgress(i + 1, texts.length)
    }

    return { success: true, vectors, model }

  } catch (err) {
    return { success: false, error: `Erro no batch de embeddings: ${(err as Error).message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICA SE O MODELO DE EMBEDDINGS ESTÁ DISPONÍVEL
// ─────────────────────────────────────────────────────────────────────────────

export async function isEmbeddingModelAvailable(
  baseUrl: string = 'http://localhost:11434',
  model:   string = EMBEDDING_MODEL
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`)
    if (!response.ok) return false

    const data = await response.json() as { models: Array<{ name: string }> }
    return data.models.some(m => m.name.includes(model.split(':')[0]))
  } catch {
    return false
  }
}