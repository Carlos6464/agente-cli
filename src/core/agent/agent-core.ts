import { OllamaProvider, OLLAMA_MODELS } from '../../providers/ollama.provider'
import { LLMMessage }                    from '../../providers/llm-provider.interface'
import { buildContext }                  from '../context-builder/context-builder'
import { StackProfile }                  from '../detector/stack-detector'
import { formatToolsForPrompt, ToolCall, ToolResult, TOOL_DEFINITIONS } from './tool-definitions'
import { executeTool }                   from './tool-executor'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT CORE
//
// O loop principal do agente.
// Recebe uma instrução, monta o contexto e entra no loop:
//   1. Envia mensagens para o LLM
//   2. LLM responde com texto ou com uma tool call em JSON
//   3. Se for tool call → executa a ferramenta → resultado volta pro LLM
//   4. Se for texto → retorna ao usuário
//   5. Repete até o LLM usar "finish" ou atingir o limite de iterações
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentOptions {
  instruction:  string
  profile:      StackProfile
  projectRoot?: string
  baseUrl?:     string
  mode?:        'generate' | 'chat' | 'run'
  maxSteps?:    number             // proteção contra loops infinitos
  onStep?:      (step: AgentStep) => void  // callback para mostrar progresso
}

export interface AgentStep {
  type:    'thinking' | 'tool_call' | 'tool_result' | 'response'
  content: string
  tool?:   string
}

export interface AgentResult {
  success:  boolean
  response: string         // resposta final para o usuário
  steps:    AgentStep[]    // histórico de todos os passos
  files?:   string[]       // arquivos criados/modificados
  error?:   string
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const {
    instruction,
    profile,
    projectRoot = process.cwd(),
    baseUrl     = 'http://localhost:11434',
    mode        = 'generate',
    maxSteps    = 15,
    onStep
  } = options

  const steps:        AgentStep[] = []
  const filesCreated: string[]    = []
  const provider = new OllamaProvider(OLLAMA_MODELS.DEFAULT, baseUrl)

  const log = (step: AgentStep) => {
    steps.push(step)
    onStep?.(step)
  }

  try {
    // ── 1. Monta o contexto inicial ──────────────────────────────────────────
    const contextResult = await buildContext({
      instruction,
      profile,
      projectRoot,
      baseUrl,
      mode
    })

    if (!contextResult.success || !contextResult.messages) {
      return { success: false, response: '', steps, error: contextResult.error }
    }

    // Injeta as definições de ferramentas no system prompt
    const messages: LLMMessage[] = injectToolsIntoMessages(contextResult.messages)

    // ── 2. Loop principal ────────────────────────────────────────────────────
    let stepCount = 0

    while (stepCount < maxSteps) {
      stepCount++

      log({ type: 'thinking', content: `Passo ${stepCount}/${maxSteps}` })

      // Envia as mensagens para o LLM
      const llmResult = await provider.complete(messages, { temperature: 0.1 })

      if (!llmResult.success || !llmResult.content) {
        return {
          success:  false,
          response: '',
          steps,
          error: llmResult.error
        }
      }

      const llmResponse = llmResult.content.trim()

      // ── 3. Tenta interpretar como tool call ──────────────────────────────
      const toolCall = parseToolCall(llmResponse)

      if (toolCall) {
        // LLM quer usar uma ferramenta
        log({
          type:    'tool_call',
          content: `Chamando ${toolCall.tool}(${JSON.stringify(toolCall.params)})`,
          tool:    toolCall.tool
        })

        // Verifica se é a ferramenta de finalização
        if (toolCall.tool === 'finish') {
          const summary = toolCall.params.summary || 'Tarefa concluída.'
          log({ type: 'response', content: summary })
          return {
            success:  true,
            response: summary,
            steps,
            files: filesCreated
          }
        }

        // Executa a ferramenta
        const toolResult: ToolResult = await executeTool(toolCall, projectRoot)

        // Registra arquivos criados
        if (toolCall.tool === 'write_file' && toolResult.success) {
          filesCreated.push(toolCall.params.path)
        }

        log({
          type:    'tool_result',
          content: toolResult.success
            ? toolResult.output.slice(0, 200) + (toolResult.output.length > 200 ? '...' : '')
            : `Erro: ${toolResult.error}`,
          tool: toolCall.tool
        })

        // Adiciona a resposta do LLM e o resultado da ferramenta no histórico
        // para o próximo passo ter contexto do que aconteceu
        messages.push({ role: 'assistant', content: llmResponse })
        messages.push({
          role:    'user',
          content: formatToolResult(toolResult)
        })

      } else {
        // LLM respondeu com texto puro — é a resposta final
        log({ type: 'response', content: llmResponse })

        return {
          success:  true,
          response: llmResponse,
          steps,
          files: filesCreated
        }
      }
    }

    // Atingiu o limite de passos sem concluir
    return {
      success:  false,
      response: '',
      steps,
      error: `Limite de ${maxSteps} passos atingido sem conclusão`
    }

  } catch (err) {
    return {
      success:  false,
      response: '',
      steps,
      error: `Erro no agente: ${(err as Error).message}`
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSE DE TOOL CALL
//
// O LLM responde com JSON quando quer usar uma ferramenta:
// {"tool": "read_file", "params": {"path": "src/index.ts"}}
//
// Precisamos extrair esse JSON da resposta, que pode conter:
// - JSON puro
// - JSON dentro de bloco ```json ... ```
// - Texto antes ou depois do JSON
// ─────────────────────────────────────────────────────────────────────────────

function parseToolCall(response: string): ToolCall | null {
  // Tenta extrair JSON de dentro de bloco de código
  const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (codeBlockMatch) {
    return tryParseJson(codeBlockMatch[1])
  }

  // Tenta extrair JSON diretamente
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    return tryParseJson(jsonMatch[0])
  }

  return null
}

function tryParseJson(str: string): ToolCall | null {
  try {
    const parsed = JSON.parse(str)

    // Valida que tem os campos necessários
    if (
      typeof parsed.tool === 'string' &&
      parsed.tool.length > 0 &&
      TOOL_DEFINITIONS.some(t => t.name === parsed.tool)
    ) {
      return {
        tool:   parsed.tool,
        params: parsed.params || {}
      }
    }

    return null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATA O RESULTADO DE UMA FERRAMENTA PARA O LLM
// ─────────────────────────────────────────────────────────────────────────────

function formatToolResult(result: ToolResult): string {
  if (result.success) {
    return `Resultado de "${result.tool}":\n${result.output}`
  } else {
    return `Erro em "${result.tool}": ${result.error}\n\nTente uma abordagem diferente.`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INJETA AS FERRAMENTAS NO SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

function injectToolsIntoMessages(messages: LLMMessage[]): LLMMessage[] {
  const toolsSection = formatToolsForPrompt()

  return messages.map(msg => {
    if (msg.role === 'system') {
      return {
        ...msg,
        content: msg.content + '\n\n' + toolsSection
      }
    }
    return msg
  })
}