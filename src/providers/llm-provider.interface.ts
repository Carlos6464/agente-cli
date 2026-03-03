// ─────────────────────────────────────────────────────────────────────────────
// LLM PROVIDER — Interface abstrata
//
// O agente nunca fala diretamente com o Ollama ou qualquer outro modelo.
// Ele sempre fala com essa interface.
// Isso garante que trocar de modelo ou provedor no futuro
// não exige mudar nada no resto do agente — só o provider.
// ─────────────────────────────────────────────────────────────────────────────

// Uma mensagem na conversa com o LLM
// role 'system'    = instruções base do agente (contexto, regras, stack do projeto)
// role 'user'      = o que o usuário digitou
// role 'assistant' = o que o LLM respondeu (usado no histórico do chat)
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Opções opcionais para a geração
export interface LLMOptions {
  temperature?: number   // 0 = determinístico, 1 = criativo. Padrão: 0.2 para código
  maxTokens?:  number    // Limite de tokens na resposta
  model?:      string    // Sobrescreve o modelo padrão do provider
}

// Resultado de uma geração completa (não streaming)
export interface LLMResult {
  success:  boolean
  content?: string
  model?:   string    // Qual modelo foi usado
  error?:   string
}

// Resultado de um chunk no streaming
export interface LLMStreamChunk {
  content:  string
  done:     boolean
}

// A interface que todo provider precisa implementar
// Qualquer classe que implementar isso pode ser usada pelo agente
export interface ILLMProvider {
  // Nome do provider para logs e debug
  readonly name: string

  // Modelo atual configurado
  readonly model: string

  // Verifica se o provider está disponível (ex: Ollama está rodando?)
  isAvailable(): Promise<boolean>

  // Gera uma resposta completa — espera terminar para retornar
  // Ideal para: gerar código, responder perguntas, analisar erros
  complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResult>

  // Gera uma resposta em streaming — retorna chunks conforme o modelo gera
  // Ideal para: agent chat, onde o usuário quer ver a resposta sendo digitada
  stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<LLMStreamChunk>

  // Lista os modelos disponíveis no provider
  listModels(): Promise<string[]>
}

export type AIProviderName = 'ollama' | 'openai' | 'gemini' | 'claude'

export interface AIConfig {
  provider:           AIProviderName
  apiKey?:            string
  baseUrl?:           string
  defaultModel:       string
  embeddingModel:     string
  // Campos adicionais para quando embedding != LLM (ex: Claude + Gemini Embeddings)
  embeddingProvider?: 'openai' | 'gemini' | 'ollama'
  embeddingApiKey?:   string
}