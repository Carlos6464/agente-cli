import { ILLMProvider, LLMMessage, LLMOptions, LLMResult, LLMStreamChunk } from './llm-provider.interface'

export class GeminiProvider implements ILLMProvider {
  readonly name = 'gemini'
  readonly model: string
  private readonly apiKey: string

  // NOVO PADRÃO: gemini-2.5-flash
  constructor(apiKey: string, model: string = 'gemini-2.5-flash') {
    this.apiKey = apiKey.trim()
    this.model = model
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey
  }

  async listModels(): Promise<string[]> {
    // Modelos atuais documentados na API
    return ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']
  }

  private formatMessages(messages: LLMMessage[]) {
    const contents: any[] = []
    let accumulatedSystem = ''

    for (const msg of messages) {
      if (msg.role === 'system') {
        accumulatedSystem += msg.content + '\n\n'
      } else {
        let text = msg.content
        if (accumulatedSystem && msg.role === 'user') {
           text = `[INSTRUÇÕES DO SISTEMA]\n${accumulatedSystem}\n[MENSAGEM DO USUÁRIO]\n${text}`
           accumulatedSystem = '' 
        }

        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text }]
        })
      }
    }
    
    if (accumulatedSystem) {
        contents.push({ role: 'user', parts: [{ text: accumulatedSystem }] })
    }

    return { contents }
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResult> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${options?.model || this.model}:generateContent?key=${this.apiKey}`
      const body = this.formatMessages(messages)

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, generationConfig: { temperature: options?.temperature ?? 0.2 } })
      })

      const data = await response.json()

      if (!response.ok) {
         throw new Error(data.error?.message || response.statusText || 'Erro desconhecido na API do Gemini')
      }
      
      if (!data.candidates || data.candidates.length === 0) {
         throw new Error('A resposta do Gemini veio vazia (possível bloqueio de segurança).')
      }

      return {
        success: true,
        content: data.candidates[0].content.parts[0].text,
        model: this.model
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<LLMStreamChunk> {
    const result = await this.complete(messages, options)
    if (result.success) {
      yield { content: result.content || '', done: true }
    } else {
      yield { content: `Erro: ${result.error}`, done: true }
    }
  }
}