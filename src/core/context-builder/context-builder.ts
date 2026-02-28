import { StackProfile } from '../detector/stack-detector'
import { retrieve, formatContextForPrompt } from '../../rag/retriever'
import { LLMMessage } from '../../providers/llm-provider.interface'

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT BUILDER
//
// Monta o contexto completo que vai ser enviado ao LLM.
// É a peça que transforma uma instrução simples do usuário
// em um prompt rico, específico e alinhado com o projeto.
//
// Responsabilidades:
//   1. Montar o system prompt com as regras e contexto da stack
//   2. Buscar exemplos relevantes no RAG
//   3. Formatar tudo em mensagens para o LLM
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildContextOptions {
  instruction:  string          // o que o usuário quer fazer
  profile:      StackProfile    // stack detectada pelo detector
  projectRoot?: string          // raiz do projeto
  baseUrl?:     string          // URL do Ollama
  topK?:        number          // quantos exemplos buscar no RAG
  mode?:        ContextMode     // qual tipo de contexto montar
}

// Modo define quais partes do contexto são incluídas
// generate → contexto completo para geração de código
// chat     → contexto mais leve para conversa
// run      → contexto focado em scripts e comandos
export type ContextMode = 'generate' | 'chat' | 'run'

export interface BuildContextResult {
  success:   boolean
  messages?: LLMMessage[]
  error?:    string
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export async function buildContext(
  options: BuildContextOptions
): Promise<BuildContextResult> {
  const {
    instruction,
    profile,
    projectRoot = process.cwd(),
    baseUrl     = 'http://localhost:11434',
    topK        = 5,
    mode        = 'generate'
  } = options

  try {
    // ── 1. Monta o system prompt base com a stack do projeto ─────────────────
    const systemPrompt = buildSystemPrompt(profile, mode)

    // ── 2. Busca exemplos relevantes no RAG ──────────────────────────────────
    const retrieved = await retrieve(instruction, projectRoot, {
      topK,
      baseUrl,
      onlyCode: mode === 'generate' // em geração, foca em código
    })

    // ── 3. Monta o bloco de contexto do RAG ──────────────────────────────────
    let ragContext = ''
    if (retrieved.success && retrieved.contexts && retrieved.contexts.length > 0) {
      ragContext = formatContextForPrompt(retrieved.contexts)
    }

    // ── 4. Monta a mensagem do usuário com contexto adicional ────────────────
    const userMessage = buildUserMessage(instruction, ragContext)

    // ── 5. Retorna as mensagens formatadas para o LLM ────────────────────────
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  }
    ]

    return { success: true, messages }

  } catch (err) {
    return {
      success: false,
      error: `Erro ao montar contexto: ${(err as Error).message}`
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// Instrui o LLM sobre quem ele é, qual stack usar e como gerar código
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(profile: StackProfile, mode: ContextMode): string {
  const sections: string[] = []

  // ── Identidade do agente ──────────────────────────────────────────────────
  sections.push(`# Agente de Desenvolvimento

Você é um assistente especializado em desenvolvimento de software.
Você está trabalhando no projeto "${profile.projectName}".
Responda sempre em português brasileiro.`)

  // ── Stack detectada ───────────────────────────────────────────────────────
  sections.push(buildStackSection(profile))

  // ── Regras específicas por modo ───────────────────────────────────────────
  if (mode === 'generate') sections.push(buildGenerateRules(profile))
  if (mode === 'chat')     sections.push(buildChatRules())
  if (mode === 'run')      sections.push(buildRunRules(profile))

  return sections.join('\n\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO DE STACK
// Descreve para o LLM o que está sendo usado no projeto
// ─────────────────────────────────────────────────────────────────────────────

function buildStackSection(profile: StackProfile): string {
  const lines: string[] = ['## Stack do Projeto\n']

  // Linguagem e ferramentas base
  lines.push(`- **Linguagem**: ${profile.language}`)
  lines.push(`- **Package Manager**: ${profile.packageManager}`)

  if (profile.monorepo !== 'none') {
    lines.push(`- **Monorepo**: ${profile.monorepo}`)
    if (profile.apps.length > 0) {
      lines.push(`- **Apps**: ${profile.apps.join(', ')}`)
    }
  }

  // Backend
  if (profile.backend !== 'none') {
    lines.push(`- **Backend**: ${profile.backend}`)
  }

  // Frontend
  if (profile.frontend !== 'none') {
    lines.push(`- **Frontend**: ${profile.frontend}`)
  }

  // Mobile
  if (profile.mobile !== 'none') {
    lines.push(`- **Mobile**: ${profile.mobile}`)
  }

  // Banco e ORM
  if (profile.orm !== 'none') {
    lines.push(`- **ORM**: ${profile.orm}`)
  }
  if (profile.database !== 'none' && profile.database !== 'unknown') {
    lines.push(`- **Banco de dados**: ${profile.database}`)
  }

  // Arquitetura
  if (profile.architecture !== 'unknown' && profile.architecture !== 'simple') {
    lines.push(`- **Arquitetura**: ${profile.architecture.toUpperCase()}`)
  }

  // Testes
  if (profile.testing !== 'none') {
    lines.push(`- **Testes**: ${profile.testing}`)
  }

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// REGRAS DE GERAÇÃO
// Instrui o LLM como gerar código para este projeto específico
// ─────────────────────────────────────────────────────────────────────────────

function buildGenerateRules(profile: StackProfile): string {
  const rules: string[] = ['## Regras de Geração de Código\n']

  // Regras gerais sempre aplicadas
  rules.push(`- Siga estritamente os padrões e convenções já existentes no projeto`)
  rules.push(`- Use os exemplos fornecidos como referência de estilo e estrutura`)
  rules.push(`- Gere código completo e funcional — não use comentários como "implementar aqui"`)
  rules.push(`- Inclua os imports necessários no topo do arquivo`)
  rules.push(`- Use ${profile.language === 'typescript' ? 'TypeScript com tipagem completa' : profile.language}`)

  // Regras específicas por backend
  if (profile.backend === 'nestjs') {
    rules.push(`- Use os decorators do NestJS (@Injectable, @Controller, @Module, etc)`)
    rules.push(`- Injete dependências pelo construtor com tipagem explícita`)
    rules.push(`- Siga o padrão de módulos do NestJS (module, controller, service)`)
  }

  if (profile.backend === 'express' || profile.backend === 'fastify') {
    rules.push(`- Organize rotas em arquivos separados por recurso`)
    rules.push(`- Use middlewares para validação e autenticação`)
  }

  if (profile.backend === 'laravel') {
    rules.push(`- Siga as convenções do Laravel (controllers, models, migrations)`)
    rules.push(`- Use Eloquent para queries ao banco de dados`)
  }

  // Regras específicas por ORM
  if (profile.orm === 'prisma') {
    rules.push(`- Use o PrismaClient para acesso ao banco`)
    rules.push(`- Defina novos models no schema.prisma quando necessário`)
  }

  if (profile.orm === 'typeorm') {
    rules.push(`- Use decorators do TypeORM (@Entity, @Column, @Repository)`)
    rules.push(`- Injete os repositories pelo módulo do NestJS`)
  }

  if (profile.orm === 'drizzle') {
    rules.push(`- Defina schemas com a sintaxe do Drizzle`)
    rules.push(`- Use o db client para queries`)
  }

  // Regras específicas por arquitetura
  if (profile.architecture === 'ddd') {
    rules.push(`- Separe claramente as camadas: domain, application e infra`)
    rules.push(`- Entidades ficam em domain/entities`)
    rules.push(`- Use Cases ficam em application/use-cases`)
    rules.push(`- Repositórios são interfaces em domain e implementações em infra`)
    rules.push(`- Nunca importe infra a partir do domain`)
  }

  if (profile.architecture === 'mvc') {
    rules.push(`- Separe claramente controllers, models e views/services`)
    rules.push(`- Controllers só lidam com HTTP — lógica fica nos services`)
  }

  if (profile.architecture === 'modular') {
    rules.push(`- Cada módulo deve ser autocontido com seus próprios tipos e serviços`)
    rules.push(`- Evite dependências cruzadas entre módulos`)
  }

  // Formato de resposta esperado
  rules.push(`\n## Formato de Resposta\n`)
  rules.push(`Retorne APENAS o código solicitado, sem explicações adicionais.`)
  rules.push(`Se precisar criar múltiplos arquivos, separe com:`)
  rules.push(`\`\`\`typescript\n// ARQUIVO: caminho/do/arquivo.ts\n// código aqui\n\`\`\``)

  return rules.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// REGRAS DE CHAT
// ─────────────────────────────────────────────────────────────────────────────

function buildChatRules(): string {
  return `## Modo de Conversa

- Responda de forma clara e direta em português
- Quando mostrar código, use blocos de código com a linguagem correta
- Se sugerir criar ou editar arquivos, pergunte se o usuário quer que você execute
- Baseie suas respostas nos exemplos do projeto fornecidos como contexto`
}

// ─────────────────────────────────────────────────────────────────────────────
// REGRAS DE RUN
// ─────────────────────────────────────────────────────────────────────────────

function buildRunRules(profile: StackProfile): string {
  const lines = ['## Modo de Execução de Tarefas\n']

  lines.push(`- Package manager do projeto: **${profile.packageManager}**`)

  if (profile.monorepo !== 'none') {
    lines.push(`- Monorepo: **${profile.monorepo}** — use os filtros corretos para o app alvo`)
  }

  if (profile.apps.length > 0) {
    lines.push(`- Apps disponíveis: ${profile.apps.join(', ')}`)
  }

  lines.push(`- Retorne apenas o comando a executar, sem explicações`)

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// MENSAGEM DO USUÁRIO
// Combina a instrução com o contexto do RAG
// ─────────────────────────────────────────────────────────────────────────────

function buildUserMessage(instruction: string, ragContext: string): string {
  if (!ragContext) {
    return instruction
  }

  return `${ragContext}

---

## Instrução

${instruction}`
}