import { StackProfile } from '../detector/stack-detector'
import { retrieve, formatContextForPrompt, RetrievedContext } from '../../rag/retriever'
import { LLMMessage } from '../../providers/llm-provider.interface'

export type ExtendedProfile = StackProfile & { architecturalSummary?: string }

export interface BuildContextOptions {
  instruction:  string
  profile:      ExtendedProfile
  projectRoot?: string
  baseUrl?:     string
  topK?:        number
  mode?:        ContextMode
}

export type ContextMode = 'generate' | 'chat' | 'run'

export interface BuildContextResult {
  success:   boolean
  messages?: LLMMessage[]
  error?:    string
}

export async function buildContext(options: BuildContextOptions): Promise<BuildContextResult> {
  const {
    instruction,
    profile,
    projectRoot = process.cwd(),
    baseUrl     = 'http://localhost:11434',
    topK        = 5,
    mode        = 'generate'
  } = options

  try {
    const systemPrompt = buildSystemPrompt(profile, mode)

    // ── Para generate, faz duas queries para cobrir mais contexto ─────────
    // Query 1: pela instrução completa (ex: "gerar service de pagamentos")
    // Query 2: só pelo tipo de artefato (ex: "service") para pegar exemplos
    // Isso aumenta a chance de achar um arquivo de referência relevante

    const topKEffective = mode === 'generate' ? 8 : topK

    const primaryRetrieve = await retrieve(instruction, projectRoot, {
      topK:          topKEffective,
      baseUrl,
      onlyCode:      mode === 'generate',
      minSimilarity: 0.55
    })

    let allContexts: RetrievedContext[] = primaryRetrieve.contexts || []

    // Segunda query para generate — busca pelo tipo do artefato isoladamente
    if (mode === 'generate') {
      // Extrai o tipo do artefato da instrução (primeira palavra relevante)
      const tipoMatch = instruction.match(/\b(service|module|controller|entity|repository|component|page|hook|dto|use.?case|vo|value.?object|schema|store|route|middleware)\b/i)

      if (tipoMatch) {
        const secondaryRetrieve = await retrieve(tipoMatch[0], projectRoot, {
          topK:          4,
          baseUrl,
          onlyCode:      true,
          minSimilarity: 0.55
        })

        if (secondaryRetrieve.success && secondaryRetrieve.contexts) {
          // Merge sem duplicatas por filePath+startLine
          const existingKeys = new Set(allContexts.map(c => `${c.filePath}:${c.startLine}`))

          for (const ctx of secondaryRetrieve.contexts) {
            const key = `${ctx.filePath}:${ctx.startLine}`
            if (!existingKeys.has(key)) {
              allContexts.push(ctx)
              existingKeys.add(key)
            }
          }
        }
      }
    }

    // Limita o total para não explodir o contexto
    allContexts = allContexts.slice(0, 6)

    const ragContext = allContexts.length > 0
      ? formatContextForPrompt(allContexts)
      : ''

    const userMessage = buildUserMessage(instruction, ragContext, allContexts.length, mode)

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  }
    ]

    return { success: true, messages }

  } catch (err) {
    return { success: false, error: `Erro ao montar contexto: ${(err as Error).message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(profile: ExtendedProfile, mode: ContextMode): string {
  const sections: string[] = []

  sections.push(`# Agente de Desenvolvimento
Você é um Arquiteto de Software e Desenvolvedor Sênior.
Você está trabalhando no projeto "${profile.projectName}".
Responda sempre em português brasileiro.`)

  sections.push(buildStackSection(profile))

  if (mode === 'generate') sections.push(buildGenerateRules())
  if (mode === 'chat')     sections.push(buildChatRules())
  if (mode === 'run')      sections.push(buildRunRules())

  return sections.join('\n\n')
}

function buildStackSection(profile: ExtendedProfile): string {
  const lines: string[] = ['## Stack do Projeto\n']

  lines.push(`- **Linguagem**: ${profile.language}`)
  lines.push(`- **Package Manager**: ${profile.packageManager}`)

  if (profile.monorepo !== 'none') {
    lines.push(`- **Monorepo**: ${profile.monorepo}`)
    if (profile.apps.length > 0) {
      lines.push(`- **Workspaces**: ${profile.apps.join(', ')}`)
    }
  }

  if (profile.backend  !== 'none') lines.push(`- **Backend**: ${profile.backend}`)
  if (profile.frontend !== 'none') lines.push(`- **Frontend**: ${profile.frontend}`)
  if (profile.mobile   !== 'none') lines.push(`- **Mobile**: ${profile.mobile}`)
  if (profile.orm      !== 'none') lines.push(`- **ORM**: ${profile.orm}`)

  if (profile.database !== 'none' && profile.database !== 'unknown') {
    lines.push(`- **Banco de dados**: ${profile.database}`)
  }

  if (profile.architecture !== 'unknown' && profile.architecture !== 'simple') {
    lines.push(`- **Arquitetura**: ${profile.architecture.toUpperCase()}`)
  }

  if (profile.testing !== 'none') {
    lines.push(`- **Testes**: ${profile.testing}`)
  }

  if (profile.architecturalSummary) {
    lines.push(`\n## Arquitetura Real do Projeto\n${profile.architecturalSummary}`)
  }

  return lines.join('\n')
}

function buildGenerateRules(): string {
  // ── DECISÃO ARQUITETURAL ────────────────────────────────────────────────
  // As regras por framework foram REMOVIDAS intencionalmente.
  //
  // O problema com regras como "Use @Injectable do NestJS" ou
  // "Use schemas do Drizzle ORM" é que elas ativam quando o RAG não
  // retorna exemplos suficientes — fazendo o LLM gerar código genérico
  // baseado no treinamento, não no código real do projeto.
  //
  // A única âncora que importa: SE há exemplos do projeto no contexto,
  // COPIE esses exemplos. Se não há, LEIA antes de escrever.
  // ──────────────────────────────────────────────────────────────────────

  return `## Regras de Geração de Código

- **Regra 1 — Exemplos do projeto são lei**: Se há exemplos de referência acima,
  copie exatamente: imports, decorators, nomenclatura, estrutura interna.
  Não substitua por alternativas do seu conhecimento de treinamento.

- **Regra 2 — Sem exemplos, leia antes de escrever**: Se não há exemplos suficientes
  no contexto, use read_file em um arquivo existente do mesmo tipo antes de criar
  qualquer arquivo novo. Nunca invente padrões que não viu no projeto.

- **Regra 3 — Verifique o local correto**: Use list_dir para confirmar onde o arquivo
  deve ser criado. Siga a estrutura de pastas existente — não crie hierarquias novas.

- **Regra 4 — Código completo**: Gere código completo e funcional.
  Não use placeholders como "// implementar aqui" ou "TODO".

- **Regra 5 — Imports reais**: Use os mesmos caminhos de import que viu nos exemplos.
  Em monorepos, respeite os aliases de workspace (ex: @aura/domain).

## Formato OBRIGATÓRIO para criar arquivos

Use write_file com o código completo no campo "content".
Use \\n para quebras de linha e \\" para aspas dentro do código.

Exemplo correto:
{"tool": "write_file", "params": {"path": "src/modules/payments/payments.service.ts", "content": "import { Injectable } from '@nestjs/common'\\n\\n@Injectable()\\nexport class PaymentsService {\\n  // ...\\n}\\n"}}

NUNCA envie content vazio. O código deve estar completo dentro do JSON.`
}

function buildChatRules(): string {
  return `## Modo de Conversa

- Responda clara e diretamente em português.
- Baseie suas respostas na arquitetura e nos exemplos detectados do projeto.
- Quando referenciar código, cite os arquivos reais do projeto.
- Não invente padrões ou estruturas que não existem no projeto.`
}

function buildRunRules(): string {
  return `## Modo de Execução

- Retorne apenas o comando exato para executar no terminal.
- Baseie-se nos arquivos de configuração fornecidos — não invente comandos.
- Sem explicações, sem markdown, sem aspas extras.`
}

// ─────────────────────────────────────────────────────────────────────────────
// USER MESSAGE
// ─────────────────────────────────────────────────────────────────────────────

function buildUserMessage(
  instruction:  string,
  ragContext:   string,
  contextCount: number,
  mode:         ContextMode
): string {
  if (!ragContext) {
    // Sem contexto RAG — avisa o LLM para não alucinar
    if (mode === 'generate') {
      return `${instruction}

⚠️  Nenhum exemplo similar foi encontrado no índice do projeto.
Antes de criar qualquer arquivo, use list_dir e read_file para entender
os padrões reais do projeto. Não use padrões genéricos de treinamento.`
    }
    return instruction
  }

  return `${ragContext}

---

## Instrução

${instruction}

> Foram encontrados ${contextCount} arquivo(s) de referência acima.
> Use os padrões exatos que você vê neles.`
}