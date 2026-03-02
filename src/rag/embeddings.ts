import fs from 'fs'
import path from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// EMBEDDINGS INTELIGENTE (SUPORTA OLLAMA, GEMINI E OPENAI)
// ─────────────────────────────────────────────────────────────────────────────

export const EMBEDDING_MODEL = 'nomic-embed-text' // Usado apenas se for local
export const EMBEDDING_DIMENSIONS = 3072 // Atualizado para suportar gemini-embedding-001

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

// Lê as configurações de IA salvas no projeto
export function getAgentConfig(projectRoot: string = process.cwd()) {
  try {
     const configPath = path.join(projectRoot, '.agent', 'config.json')
     if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
     }
  } catch(e) {}
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICAÇÃO DE SAÚDE (HEALTH CHECK) ANTES DE EXECUTAR
// ─────────────────────────────────────────────────────────────────────────────
export async function isEmbeddingModelAvailable(
  baseUrl: string = 'http://localhost:11434',
  model:   string = EMBEDDING_MODEL,
  projectRoot: string = process.cwd()
): Promise<{ available: boolean; message?: string }> {
  
  const config = getAgentConfig(projectRoot)
  const provider = config?.ai?.provider

  const isGemini = provider === 'gemini' || model.includes('gemini-embedding-001') || model.includes('gemini');
  const isOpenAI = provider === 'openai' || model.includes('text-embedding-3') || model.includes('ada');

  if (isGemini) {
    if (!config?.ai?.apiKey && !process.env.GEMINI_API_KEY) {
       return { available: false, message: 'Chave de API do Gemini não encontrada no arquivo .agent/config.json.' }
    }
    return { available: true }
  }

  if (isOpenAI) {
    if (!config?.ai?.apiKey && !process.env.OPENAI_API_KEY) {
       return { available: false, message: 'Chave de API da OpenAI não encontrada no arquivo .agent/config.json.' }
    }
    return { available: true }
  }

  try {
    const response = await fetch(`${baseUrl}/api/tags`)
    if (!response.ok) return { available: false, message: 'Ollama está a correr, mas falhou ao listar os modelos.' }

    const data = await response.json() as { models: Array<{ name: string }> }
    const hasModel = data.models.some(m => m.name.includes(model.split(':')[0]))
    
    if (!hasModel) {
        return { available: false, message: `O modelo '${model}' não está instalado. Por favor, rode no terminal: ollama run ${model}` }
    }
    return { available: true }
  } catch (err) {
    return { 
      available: false, 
      message: 'O servidor local de IA (Ollama) não está instalado ou não está a correr.\n💡 Instale em https://ollama.com e inicie o serviço, ou use a Cloud.' 
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GERA EMBEDDING DE UM TEXTO
// ─────────────────────────────────────────────────────────────────────────────

export async function embed(
  text:     string,
  baseUrl:  string = 'http://localhost:11434',
  model:    string = EMBEDDING_MODEL,
  projectRoot: string = process.cwd()
): Promise<EmbeddingResult> {
  try {
    const cleanText = text.trim().slice(0, 8000)

    if (!cleanText) {
      return { success: false, error: 'Texto vazio — não é possível gerar embedding' }
    }

    const config = getAgentConfig(projectRoot)
    const provider = config?.ai?.provider || 'local'
    const apiKey = config?.ai?.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY

    const isGemini = provider === 'gemini' || model.includes('gemini-embedding-001') || model.includes('gemini');
    const isOpenAI = provider === 'openai' || model.includes('text-embedding-3') || model.includes('ada');

    if (isGemini) {
       if (!apiKey) throw new Error("API Key do Gemini ausente no .agent/config.json.")
       // ATUALIZADO AQUI TAMBÉM:
       const geminiModel = config?.ai?.embeddingModel || 'gemini-embedding-001'
       
       const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:embedContent?key=${apiKey}`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
               model: `models/${geminiModel}`,
               content: { parts: [{ text: cleanText }] }
           })
       })
       if (!response.ok) throw new Error(`Erro na API do Gemini: ${await response.text()}`)
       
       const data = await response.json()
       return { success: true, vector: data.embedding.values, model: geminiModel }
    }

    if (isOpenAI) {
       if (!apiKey) throw new Error("API Key da OpenAI ausente no .agent/config.json.")
       const oaModel = config?.ai?.embeddingModel || 'text-embedding-3-small'
       
       const response = await fetch('https://api.openai.com/v1/embeddings', {
           method: 'POST',
           headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
           },
           body: JSON.stringify({ input: cleanText, model: oaModel })
       })
       if (!response.ok) throw new Error(`Erro na API da OpenAI: ${await response.text()}`)
       
       const data = await response.json()
       return { success: true, vector: data.data[0].embedding, model: oaModel }
    }

    const response = await fetch(`${baseUrl}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model, prompt: cleanText })
    })

    if (!response.ok) throw new Error(`Ollama Error: ${await response.text()}`)
    const data = await response.json() as { embedding: number[] }
    
    if (!data.embedding || data.embedding.length === 0) {
      throw new Error('Ollama retornou um embedding vazio.')
    }

    return { success: true, vector: data.embedding, model }

  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GERA EMBEDDINGS DE MÚLTIPLOS TEXTOS (em lote)
// ─────────────────────────────────────────────────────────────────────────────

export async function embedBatch(
  texts:    string[],
  baseUrl:  string = 'http://localhost:11434',
  model:    string = EMBEDDING_MODEL,
  projectRoot: string = process.cwd(),
  onProgress?: (current: number, total: number) => void
): Promise<BatchEmbeddingResult> {
  try {
    const vectors: number[][] = []

    for (let i = 0; i < texts.length; i++) {
      const result = await embed(texts[i], baseUrl, model, projectRoot)

      if (!result.success || !result.vector) {
        return { success: false, error: `Falha na IA no chunk ${i + 1}: ${result.error}` }
      }

      vectors.push(result.vector)

      if (onProgress) onProgress(i + 1, texts.length)
    }

    return { success: true, vectors, model }

  } catch (err) {
    return { success: false, error: `Erro no lote de embeddings: ${(err as Error).message}` }
  }
}