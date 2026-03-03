import { ILLMProvider, AIConfig } from './llm-provider.interface'
import { OllamaProvider } from './ollama.provider'
import { LangChainProvider } from './langchain.provider'
import { ChatOpenAI } from '@langchain/openai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatAnthropic } from '@langchain/anthropic'

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER FACTORY
//
// Único ponto de entrada para criação de providers.
// Para adicionar um novo provedor cloud:
//   1. npm install @langchain/<provedor>
//   2. Adicionar um case aqui.
// ─────────────────────────────────────────────────────────────────────────────

export class ProviderFactory {
  static create(config: AIConfig): ILLMProvider {

    switch (config.provider) {

      // ── Local (Ollama) — continua igual, sem LangChain ──────────────────
      case 'ollama':
        return new OllamaProvider(config.defaultModel, config.baseUrl)

      // ── OpenAI / ChatGPT ─────────────────────────────────────────────────
      case 'openai': {
        if (!config.apiKey) throw new Error('API Key da OpenAI não configurada.')
        return new LangChainProvider(
          'openai',
          config.defaultModel,
          (temperature) => new ChatOpenAI({
            model:       config.defaultModel || 'gpt-4o-mini',
            apiKey:      config.apiKey,
            temperature,
          })
        )
      }

      // ── Google Gemini ────────────────────────────────────────────────────
      case 'gemini': {
        if (!config.apiKey) throw new Error('API Key do Google Gemini não configurada.')
        return new LangChainProvider(
          'gemini',
          config.defaultModel,
          (temperature) => new ChatGoogleGenerativeAI({
            model:       config.defaultModel || 'gemini-2.5-flash',
            apiKey:      config.apiKey,
            temperature,
          })
        )
      }

      // ── Anthropic Claude ─────────────────────────────────────────────────
      case 'claude': {
        if (!config.apiKey) throw new Error('API Key do Anthropic Claude não configurada.')
        return new LangChainProvider(
          'claude',
          config.defaultModel,
          (temperature) => new ChatAnthropic({
            model:       config.defaultModel || 'claude-sonnet-4-5',
            apiKey:      config.apiKey,
            temperature,
          })
        )
      }

      default:
        throw new Error(`Provedor não suportado: ${(config as any).provider}`)
    }
  }
}