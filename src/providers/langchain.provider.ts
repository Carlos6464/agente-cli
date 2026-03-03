import { ILLMProvider, LLMMessage, LLMOptions, LLMResult, LLMStreamChunk } from './llm-provider.interface'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages'

// ─────────────────────────────────────────────────────────────────────────────
// LANGCHAIN PROVIDER — Adapter unificado para qualquer modelo cloud
//
// Usa Factory para temperatura dinâmica: cada chamada recebe a temperatura
// correta sem precisar criar um novo cliente HTTP a cada request.
//
// Para adicionar um novo provedor no futuro:
//   1. npm install @langchain/<provedor>
//   2. Adicionar 1 case em provider.factory.ts
//   Sem tocar aqui.
// ─────────────────────────────────────────────────────────────────────────────

// Factory: dado temperatura → retorna instância configurada do modelo LangChain
type ModelFactory = (temperature: number) => BaseChatModel

export class LangChainProvider implements ILLMProvider {
  readonly name:  string
  readonly model: string
  private readonly factory: ModelFactory

  constructor(name: string, model: string, factory: ModelFactory) {
    this.name    = name
    this.model   = model
    this.factory = factory
  }

  // Para cloud, retorna true — chave validada no ProviderFactory.
  // Erros de auth surgirão na primeira chamada real.
  async isAvailable(): Promise<boolean> {
    return true
  }

  async listModels(): Promise<string[]> {
    return [this.model]
  }

  // Converte formato interno { role, content } → objetos LangChain.
  // Isso é o que permite trocar openai ↔ gemini ↔ claude sem mudar nada.
  private toBaseMessages(messages: LLMMessage[]): BaseMessage[] {
    return messages.map(msg => {
      switch (msg.role) {
        case 'system':    return new SystemMessage(msg.content)
        case 'assistant': return new AIMessage(msg.content)
        case 'user':
        default:          return new HumanMessage(msg.content)
      }
    })
  }

  // Geração completa — usado em: agent generate, agent run
  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResult> {
    try {
      const llm        = this.factory(options?.temperature ?? 0.2)
      const lcMessages = this.toBaseMessages(messages)
      const response   = await llm.invoke(lcMessages)

      // Normaliza content — alguns modelos retornam array de blocos
      const content = typeof response.content === 'string'
        ? response.content
        : (response.content as any[]).map((c: any) => c.text ?? c.content ?? '').join('')

      return { success: true, content, model: this.model }

    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  // Streaming em tempo real — usado em: agent chat
  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<LLMStreamChunk> {
    try {
      const llm        = this.factory(options?.temperature ?? 0.7)
      const lcMessages = this.toBaseMessages(messages)
      const stream     = await llm.stream(lcMessages)

      for await (const chunk of stream) {
        const content = typeof chunk.content === 'string'
          ? chunk.content
          : (chunk.content as any[]).map((c: any) => c.text ?? '').join('')

        if (content) yield { content, done: false }
      }

      yield { content: '', done: true }

    } catch (err) {
      yield { content: `Erro: ${(err as Error).message}`, done: true }
    }
  }
}