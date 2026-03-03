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

export interface AgentStep {
  type:    'thinking' | 'tool_call' | 'tool_result' | 'response'
  content: string
  tool?:   string
}

export interface AgentResult {
  success:   boolean
  response:  string
  steps:     AgentStep[]
  files?:    string[]
  error?:    string
}

export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const {
    instruction,
    profile,
    projectRoot = process.cwd(),
    aiConfig,
    mode       = 'generate',
    maxSteps   = 15,
    onStep
  } = options

  const steps:        AgentStep[] = []
  const filesCreated: string[]    = []

  // ── Rastreia se o LLM leu alguma referência antes de escrever ─────────────
  // Isso previne que o LLM escreva código do zero sem ancorar no projeto real
  let hasReadAnyFile = false

  const provider = ProviderFactory.create(aiConfig)
  const log = (step: AgentStep) => { steps.push(step); onStep?.(step) }

  try {
    const ctx = await buildContext({ instruction, profile, projectRoot, mode })

    if (!ctx.success || !ctx.messages) {
      return { success: false, response: '', steps, error: ctx.error }
    }

    const messages = ctx.messages.map(m =>
      m.role === 'system'
        ? { ...m, content: m.content + '\n\n' + formatToolsForPrompt() }
        : m
    )

    let stepCount = 0

    while (stepCount++ < maxSteps) {
      log({ type: 'thinking', content: `Processando (Passo ${stepCount}/${maxSteps})...` })

      const llmResult = await provider.complete(messages, { temperature: 0.1 })

      if (!llmResult.success || !llmResult.content) {
        return { success: false, response: '', steps, error: llmResult.error }
      }

      const llmResponse = llmResult.content.trim()

      // ── Extração do JSON de tool call ────────────────────────────────────

      let toolCall:       ToolCall | null = null
      let jsonParseError: string | null   = null

      // Tenta extrair JSON dentro de bloco de código
      const jsonBlockMatch = llmResponse.match(/```(?:json)?\s*(\{[\s\S]*?"tool"[\s\S]*?\})\s*```/i)
      const rawJson = jsonBlockMatch
        ? jsonBlockMatch[1]
        : llmResponse.match(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[\s\S]*?\}\s*\}/)?.[0]

      if (rawJson) {
        try {
          const parsed = JSON.parse(rawJson)
          if (parsed.tool && TOOL_DEFINITIONS.some(t => t.name === parsed.tool)) {
            toolCall = { tool: parsed.tool, params: parsed.params || {} }
          }
        } catch (e) {
          jsonParseError = (e as Error).message
        }
      }

      // ── VALIDAÇÃO: write_file exige leitura prévia em modo generate ───────
      //
      // Se o LLM tentou escrever sem ler nenhuma referência, bloqueamos e
      // exigimos que ele leia um arquivo existente primeiro.
      // Isso ancora o código gerado no projeto real e previne alucinação.
      //
      // NOTA: O bypass de "JSON vazio + markdown" foi REMOVIDO intencionalmente.
      // O LLM deve colocar o conteúdo diretamente no campo "content" do JSON.
      // Isso forçou o LLM a ser mais cuidadoso ao estruturar a resposta.

      if (toolCall?.tool === 'write_file' && mode === 'generate' && !hasReadAnyFile) {
        log({ type: 'thinking', content: 'LLM tentou criar arquivo sem ler referências. Bloqueando...' })

        messages.push(
          { role: 'assistant', content: llmResponse },
          {
            role: 'user',
            content:
              `BLOQUEADO: Você tentou criar um arquivo sem antes ler nenhuma referência do projeto. ` +
              `Isso causa código inconsistente com os padrões do projeto real. ` +
              `\n\nOBRIGATÓRIO antes de criar qualquer arquivo: ` +
              `\n1. Use list_dir para localizar um arquivo do mesmo tipo que já existe no projeto.` +
              `\n2. Use read_file nesse arquivo para aprender os imports, decorators e estrutura exatos.` +
              `\nSó depois use write_file.`
          }
        )
        continue
      }

      // ── Verifica se o write_file tem conteúdo real ────────────────────────
      // Se content veio vazio, o LLM está tentando o "padrão duplo" removido.
      // Corrigimos pedindo que ele reenvie com o conteúdo completo no JSON.

      if (toolCall?.tool === 'write_file') {
        const content = toolCall.params.content || ''

        if (content.trim().length < 10) {
          log({ type: 'thinking', content: 'Content do write_file veio vazio. Solicitando reenvio...' })

          messages.push(
            { role: 'assistant', content: llmResponse },
            {
              role: 'user',
              content:
                `ERRO: O campo "content" do write_file veio vazio ou muito curto. ` +
                `Você deve incluir o código completo DENTRO do campo "content" do JSON. ` +
                `Use \\n para quebras de linha e \\" para aspas internas. ` +
                `Reenvie o JSON completo com o código real no content.`
            }
          )
          continue
        }
      }

      // ── Executa a tool ────────────────────────────────────────────────────

      if (toolCall) {
        log({ type: 'tool_call', content: `Executando ${toolCall.tool}...`, tool: toolCall.tool })

        if (toolCall.tool === 'finish') {
          return {
            success:  true,
            response: toolCall.params.summary || 'Finalizado.',
            steps,
            files:    filesCreated
          }
        }

        const res = await executeTool(toolCall, projectRoot)

        // Marca que o LLM leu um arquivo de referência
        if (toolCall.tool === 'read_file' && res.success) {
          hasReadAnyFile = true
        }

        if (toolCall.tool === 'write_file' && res.success) {
          filesCreated.push(toolCall.params.path)
        }

        log({
          type:    'tool_result',
          content: res.success ? res.output.slice(0, 150) : res.error!,
          tool:    toolCall.tool
        })

        messages.push(
          { role: 'assistant', content: llmResponse },
          {
            role: 'user',
            content: res.success
              ? `Tool executada com sucesso. Output:\n${res.output}\nSiga para o próximo passo ou chame finish.`
              : `Erro na tool: ${res.error}`
          }
        )

      } else if (jsonParseError) {
        // JSON mal formado — pede correção
        log({ type: 'thinking', content: `Erro de formato JSON. Solicitando correção...` })

        messages.push(
          { role: 'assistant', content: llmResponse },
          {
            role: 'user',
            content:
              `ERRO DE SINTAXE JSON: ${jsonParseError}. ` +
              `Verifique se o JSON está bem formado. ` +
              `Certifique-se que o campo "content" contém o código com \\n para quebras de linha ` +
              `e \\" para aspas. Reenvie o JSON corrigido.`
          }
        )

      } else {
        // Resposta em texto puro — verifica se o LLM "vazou" código
        const isLeakingCode =
          llmResponse.includes('```typescript') ||
          llmResponse.includes('```ts') ||
          llmResponse.includes('```javascript') ||
          llmResponse.includes('```js')

        if (mode === 'generate' && isLeakingCode && filesCreated.length === 0) {
          log({ type: 'thinking', content: `LLM enviou código como texto. Forçando uso do write_file...` })

          messages.push(
            { role: 'assistant', content: llmResponse },
            {
              role: 'user',
              content:
                `ERRO: Você enviou o código como texto puro em vez de usar a ferramenta write_file. ` +
                `O código NÃO foi salvo em disco. ` +
                `OBRIGATÓRIO: Use write_file com o código completo no campo "content" do JSON para salvar o arquivo.`
            }
          )
          continue
        }

        // Resposta final legítima
        log({ type: 'response', content: llmResponse })
        return { success: true, response: llmResponse, steps, files: filesCreated }
      }
    }

    return {
      success: false,
      response: '',
      steps,
      error: `Limite de ${maxSteps} passos atingido sem conclusão.`
    }

  } catch (err) {
    return { success: false, response: '', steps, error: (err as Error).message }
  }
}