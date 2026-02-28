import {
  ILLMProvider,
  LLMMessage,
  LLMOptions,
  LLMResult,
  LLMStreamChunk
} from './llm-provider.interface'

// ─────────────────────────────────────────────────────────────────────────────
// OLLAMA PROVIDER
//
// Conecta o agente ao Ollama rodando localmente.
// O Ollama expõe uma API REST no padrão OpenAI — simples de usar.
//
// Endpoints usados:
//   POST /api/chat        → geração completa e streaming
//   GET  /api/tags        → lista modelos disponíveis
//   GET  /                → verifica se o Ollama está rodando
//
// Documentação: https://github.com/ollama/ollama/blob/main/docs/api.md
// ─────────────────────────────────────────────────────────────────────────────

// Modelos disponíveis na máquina do usuário
// Adicione aqui conforme instalar novos modelos com `ollama pull`
export const OLLAMA_MODELS = {
  // Modelo principal — alta qualidade, use para geração de código complexo
  // agent generate, agent chat com raciocínio profundo
  DEFAULT: 'deepseek-coder-v2:latest',

  // Modelo leve — rápido, use para tarefas simples
  // buscas rápidas, classificações, respostas curtas
  FAST: 'deepseek-coder:1.3b',
} as const

export type OllamaModel = typeof OLLAMA_MODELS[keyof typeof OLLAMA_MODELS]

export class OllamaProvider implements ILLMProvider {
  readonly name = 'ollama'
  readonly model: string
  private readonly baseUrl: string

  constructor(
    model: string = OLLAMA_MODELS.DEFAULT,
    baseUrl: string = 'http://localhost:11434'
  ) {
    this.model = model
    this.baseUrl = baseUrl
  }

  // ── isAvailable ─────────────────────────────────────────────────────────────
  // Faz uma requisição simples para a raiz do Ollama.
  // Se responder, está rodando. Se der erro de conexão, não está.

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}`)
      return response.ok
    } catch {
      // fetch lança erro quando não consegue conectar
      return false
    }
  }

  // ── listModels ───────────────────────────────────────────────────────────────
  // Retorna os modelos que o Ollama tem instalados localmente.

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`)
      if (!response.ok) return []

      const data = await response.json() as { models: Array<{ name: string }> }
      return data.models.map(m => m.name)
    } catch {
      return []
    }
  }

  // ── complete ─────────────────────────────────────────────────────────────────
  // Envia as mensagens e aguarda a resposta completa do modelo.
  // Usa o endpoint /api/chat com stream: false.

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResult> {
    try {
      const modelToUse = options?.model || this.model

      const body = {
        model:    modelToUse,
        messages: messages,
        stream:   false,
        options: {
          // temperature baixo para código — respostas mais determinísticas
          // 0.1 para geração de código, 0.7 para conversas
          temperature: options?.temperature ?? 0.1,
          ...(options?.maxTokens && { num_predict: options.maxTokens })
        }
      }

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
      })

      if (!response.ok) {
        const errorText = await response.text()
        return {
          success: false,
          error: `Ollama retornou erro ${response.status}: ${errorText}`
        }
      }

      const data = await response.json() as {
        message: { content: string }
        model:   string
      }

      return {
        success: true,
        content: data.message.content,
        model:   data.model
      }

    } catch (err) {
      // Erro de conexão — Ollama provavelmente não está rodando
      if ((err as any).cause?.code === 'ECONNREFUSED') {
        return {
          success: false,
          error: 'Ollama não está rodando. Inicie com: ollama serve'
        }
      }
      return {
        success: false,
        error: `Erro na requisição: ${(err as Error).message}`
      }
    }
  }

  // ── stream ───────────────────────────────────────────────────────────────────
  // Envia as mensagens e retorna chunks da resposta conforme o modelo gera.
  // Usa o endpoint /api/chat com stream: true.
  // É um AsyncGenerator — permite usar com `for await (const chunk of stream(...))`

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<LLMStreamChunk> {
    try {
      const modelToUse = options?.model || this.model

      const body = {
        model:    modelToUse,
        messages: messages,
        stream:   true,
        options: {
          temperature: options?.temperature ?? 0.7, // mais alto para chat
          ...(options?.maxTokens && { num_predict: options.maxTokens })
        }
      }

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
      })

      if (!response.ok) {
        yield { content: `Erro ${response.status}: ${await response.text()}`, done: true }
        return
      }

      if (!response.body) {
        yield { content: 'Erro: response body vazio', done: true }
        return
      }

      // O Ollama retorna uma linha JSON por chunk no streaming
      // Cada linha tem o formato: {"message":{"content":"..."},"done":false}
      const reader  = response.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      while (true) {
        const { value, done: streamDone } = await reader.read()

        if (streamDone) break

        // Decodifica o chunk e acumula no buffer
        // (um chunk pode conter partes de múltiplas linhas JSON)
        buffer += decoder.decode(value, { stream: true })

        // Processa cada linha completa do buffer
        const lines = buffer.split('\n')

        // A última linha pode estar incompleta — mantém no buffer
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const parsed = JSON.parse(line) as {
              message: { content: string }
              done:    boolean
            }

            yield {
              content: parsed.message?.content || '',
              done:    parsed.done
            }

            if (parsed.done) return

          } catch {
            // Linha não é JSON válido — ignora
          }
        }
      }

    } catch (err) {
      if ((err as any).cause?.code === 'ECONNREFUSED') {
        yield { content: 'Ollama não está rodando. Inicie com: ollama serve', done: true }
      } else {
        yield { content: `Erro: ${(err as Error).message}`, done: true }
      }
    }
  }
}