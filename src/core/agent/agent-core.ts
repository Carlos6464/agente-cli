import { ProviderFactory } from '../../providers/provider.factory'
import { LLMMessage, AIConfig } from '../../providers/llm-provider.interface'
import { buildContext } from '../context-builder/context-builder'
import { StackProfile } from '../detector/stack-detector'
import { formatToolsForPrompt, ToolCall, ToolResult, TOOL_DEFINITIONS } from './tool-definitions'
import { executeTool } from './tool-executor'

export interface AgentOptions {
  instruction:  string
  profile:      StackProfile
  projectRoot?: string
  aiConfig:     AIConfig
  mode?:        'generate' | 'chat' | 'run'
  maxSteps?:    number
  onStep?:      (step: AgentStep) => void
}

export interface AgentStep { type: 'thinking'|'tool_call'|'tool_result'|'response', content: string, tool?: string }
export interface AgentResult { success: boolean, response: string, steps: AgentStep[], files?: string[], error?: string }

export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const { instruction, profile, projectRoot = process.cwd(), aiConfig, mode = 'generate', maxSteps = 15, onStep } = options
  const steps: AgentStep[] = []; const filesCreated: string[] = []
  const provider = ProviderFactory.create(aiConfig)
  const log = (step: AgentStep) => { steps.push(step); onStep?.(step) }

  try {
    const ctx = await buildContext({ instruction, profile, projectRoot, mode })
    if (!ctx.success || !ctx.messages) return { success: false, response: '', steps, error: ctx.error }
    const messages = ctx.messages.map(m => m.role === 'system' ? { ...m, content: m.content + '\n\n' + formatToolsForPrompt() } : m)

    let stepCount = 0
    while (stepCount++ < maxSteps) {
      log({ type: 'thinking', content: `Processando (Passo ${stepCount}/${maxSteps})...` })
      const llmResult = await provider.complete(messages, { temperature: 0.1 })
      if (!llmResult.success || !llmResult.content) return { success: false, response: '', steps, error: llmResult.error }
      
      const llmResponse = llmResult.content.trim()
      
      let toolCall: ToolCall | null = null
      let jsonParseError: string | null = null

      // 1. Extração do JSON
      const jsonBlockMatch = llmResponse.match(/```(?:json)?\s*(\{[\s\S]*?"tool"[\s\S]*?\})\s*```/i)
      const rawJson = jsonBlockMatch ? jsonBlockMatch[1] : llmResponse.match(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[\s\S]*?\}\s*\}/)?.[0]

      if (rawJson) {
        try { 
          const p = JSON.parse(rawJson)
          if (p.tool && TOOL_DEFINITIONS.some(t => t.name === p.tool)) {
            toolCall = { tool: p.tool, params: p.params || {} }
          }
        } catch (e) {
          jsonParseError = (e as Error).message
        }
      }

      // 2. MAGIA DE BYPASS DO JSON (Para o write_file)
      // Se a ferramenta é write_file e o content veio vazio, pega o código do bloco Markdown!
      if (toolCall && toolCall.tool === 'write_file') {
        if (!toolCall.params.content || toolCall.params.content.trim() === '') {
          const codeBlock = llmResponse.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]+?)\n```/i)
          if (codeBlock) {
            toolCall.params.content = codeBlock[1].trim()
            jsonParseError = null // Resolve qualquer erro falso
          } else {
             jsonParseError = "Faltou enviar o bloco de código Markdown logo abaixo do JSON."
             toolCall = null
          }
        }
      }

      // 3. FALLBACK: A IA ignorou o JSON e mandou texto puro
      if (!toolCall && llmResponse.includes('"write_file"')) {
        const pathMatch = llmResponse.match(/"path"\s*:\s*"([^"]+)"/)
        const codeMatch = llmResponse.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]+?)\n```/i)
        if (pathMatch && codeMatch) {
          toolCall = { tool: 'write_file', params: { path: pathMatch[1], content: codeMatch[1].trim() } }
          jsonParseError = null;
        }
      }

      if (toolCall) {
        log({ type: 'tool_call', content: `Executando ${toolCall.tool}...`, tool: toolCall.tool })
        if (toolCall.tool === 'finish') return { success: true, response: toolCall.params.summary || 'Finalizado.', steps, files: filesCreated }
        
        const res = await executeTool(toolCall, projectRoot)
        if (toolCall.tool === 'write_file' && res.success) filesCreated.push(toolCall.params.path)
        
        log({ type: 'tool_result', content: res.success ? res.output.slice(0, 150) : res.error!, tool: toolCall.tool })
        messages.push({ role: 'assistant', content: llmResponse }, { role: 'user', content: res.success ? `Tool executada com sucesso. Output:\n${res.output}\nSiga para o próximo passo ou chame finish.` : `Erro na tool: ${res.error}` })
      
      } else if (jsonParseError) {
         log({ type: 'thinking', content: `Erro de formato. Acordando a IA...` })
         messages.push({ role: 'assistant', content: llmResponse })
         messages.push({ role: 'user', content: `ERRO DE SINTAXE: O formato falhou (${jsonParseError}). Lembre-se: mande o JSON com content vazio, e o código logo abaixo em Markdown.` })
      } else {
        const isLeakingCode = llmResponse.includes('```typescript') || llmResponse.includes('```ts')
        if (mode === 'generate' && isLeakingCode && filesCreated.length === 0) {
           log({ type: 'thinking', content: `A IA vazou código texto. Forçando correção...` })
           messages.push({ role: 'assistant', content: llmResponse })
           messages.push({ role: 'user', content: `ERRO: Você me enviou o código como texto puro em vez de usar a ferramenta! OBRIGATÓRIO: Use a sintaxe correta do write_file para SALVAR o código que você acabou de gerar.` })
           continue
        }

        log({ type: 'response', content: llmResponse })
        return { success: true, response: llmResponse, steps, files: filesCreated }
      }
    }
    return { success: false, response: '', steps, error: `Limite de ${maxSteps} passos atingido.` }
  } catch (err) { return { success: false, response: '', steps, error: (err as Error).message } }
}