import { ILLMProvider, AIConfig } from './llm-provider.interface'
import { OllamaProvider } from './ollama.provider'
import { GeminiProvider } from './gemini.provider'

export class ProviderFactory {
  static create(config: AIConfig): ILLMProvider {
    switch (config.provider) {
      case 'ollama':
        return new OllamaProvider(config.defaultModel, config.baseUrl)
      case 'gemini':
        if (!config.apiKey) throw new Error('API Key do Gemini não configurada.')
        return new GeminiProvider(config.apiKey, config.defaultModel)
      case 'openai':
      case 'claude':
        throw new Error(`Provedor ${config.provider} mapeado, mas ainda não implementado.`)
      default:
        throw new Error(`Provedor não suportado: ${config.provider}`)
    }
  }
}