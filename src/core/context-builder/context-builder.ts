import { StackProfile } from '../detector/stack-detector'
import { retrieve, formatContextForPrompt } from '../../rag/retriever'
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
  const { instruction, profile, projectRoot = process.cwd(), baseUrl = 'http://localhost:11434', topK = 5, mode = 'generate' } = options

  try {
    const systemPrompt = buildSystemPrompt(profile, mode)
    const retrieved = await retrieve(instruction, projectRoot, { topK, baseUrl, onlyCode: mode === 'generate' })

    let ragContext = ''
    if (retrieved.success && retrieved.contexts && retrieved.contexts.length > 0) {
      ragContext = formatContextForPrompt(retrieved.contexts)
    }

    const userMessage = buildUserMessage(instruction, ragContext)
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  }
    ]

    return { success: true, messages }
  } catch (err) {
    return { success: false, error: `Erro ao montar contexto: ${(err as Error).message}` }
  }
}

function buildSystemPrompt(profile: ExtendedProfile, mode: ContextMode): string {
  const sections: string[] = []

  sections.push(`# Agente de Desenvolvimento
Você é um Arquiteto de Software e Desenvolvedor Sênior.
Você está trabalhando no projeto "${profile.projectName}".
Responda sempre em português brasileiro.`)

  sections.push(buildStackSection(profile))

  if (mode === 'generate') sections.push(buildGenerateRules(profile))
  if (mode === 'chat')     sections.push(buildChatRules())
  if (mode === 'run')      sections.push(buildRunRules(profile))

  return sections.join('\n\n')
}

function buildStackSection(profile: ExtendedProfile): string {
  const lines: string[] = ['## Stack do Projeto\n']
  lines.push(`- **Linguagem**: ${profile.language}`)
  lines.push(`- **Package Manager**: ${profile.packageManager}`)

  if (profile.monorepo !== 'none') {
    lines.push(`- **Monorepo**: ${profile.monorepo}`)
    if (profile.apps.length > 0) lines.push(`- **Workspaces (Apps / Libs)**: ${profile.apps.join(', ')}`)
  }

  if (profile.backend !== 'none') lines.push(`- **Backend**: ${profile.backend}`)
  if (profile.frontend !== 'none') lines.push(`- **Frontend**: ${profile.frontend}`)
  if (profile.mobile !== 'none') lines.push(`- **Mobile**: ${profile.mobile}`)
  if (profile.orm !== 'none') lines.push(`- **ORM**: ${profile.orm}`)
  
  if (profile.database !== 'none' && profile.database !== 'unknown') lines.push(`- **Banco de dados**: ${profile.database}`)
  if (profile.architecture !== 'unknown' && profile.architecture !== 'simple') lines.push(`- **Arquitetura Base Detectada**: ${profile.architecture.toUpperCase()}`)
  if (profile.testing !== 'none') lines.push(`- **Testes**: ${profile.testing}`)
  if (profile.architecturalSummary) lines.push(`\n## Arquitetura Real do Projeto (Guia)\n${profile.architecturalSummary}`)

  return lines.join('\n')
}

function buildGenerateRules(profile: ExtendedProfile): string {
  const rules: string[] = ['## Regras de Geração de Código\n']

  rules.push(`- Siga estritamente os padrões e convenções já existentes no projeto`)
  rules.push(`- Respeite a divisão do monorepo. Entidades em domain, infra no seu respectivo pacote, etc.`)
  rules.push(`- Use os exemplos fornecidos como referência absoluta de estilo e estrutura`)
  rules.push(`- Gere código completo e funcional — não use comentários como "implementar aqui"`)
  rules.push(`- Inclua os imports necessários no topo do arquivo. Verifique caminhos relativos ou alias de monorepo.`)

  if (profile.backend === 'nestjs') {
    rules.push(`- Use os decorators do NestJS (@Injectable, @Controller, @Module, etc) e injete dependências no construtor.`)
  }

  if (profile.orm === 'drizzle') {
    rules.push(`- Defina schemas com a sintaxe do Drizzle ORM e use o db client para queries.`)
  }

  if (profile.architecture === 'ddd') {
    rules.push(`- Separe as camadas: domain, application e infraestrutura.`)
    rules.push(`- Value Objects (VO) e Entidades não podem depender de frameworks externos ou bibliotecas de banco de dados.`)
    rules.push(`- Repositórios são definidos como Interfaces no Domain/Application e implementados na Infra.`)
  }

  // O SEGREDO QUE ACABA COM O LOOP DO JSON ESCAPING:
  rules.push(`\n## Formato de Resposta OBRIGATÓRIO para CRIAR/EDITAR ARQUIVOS\n`)
  rules.push(`Modelos de IA falham ao colocar códigos complexos dentro de JSON. Portanto, NUNCA coloque o código gerado na propriedade "content".`)
  rules.push(`Para salvar arquivos, você DEVE responder EXATAMENTE neste formato duplo:`)
  rules.push(`
1. O comando JSON (deixe content vazio):
{"tool": "write_file", "params": {"path": "caminho/do/arquivo.ts", "content": ""}}

2. O código imediatamente abaixo em markdown:
\`\`\`typescript
// TODO O SEU CÓDIGO AQUI
\`\`\`
`.trim())

  return rules.join('\n')
}

function buildChatRules(): string {
  return `## Modo de Conversa\n- Responda clara e diretamente.\n- Baseie suas respostas na arquitetura detectada.`
}

function buildRunRules(profile: ExtendedProfile): string {
  return `## Modo de Execução de Tarefas\n- Monorepo: ${profile.monorepo}\n- Package Manager: ${profile.packageManager}\n- Retorne apenas o comando a executar.`
}

function buildUserMessage(instruction: string, ragContext: string): string {
  if (!ragContext) return instruction
  return `${ragContext}\n\n---\n\n## Instrução\n\n${instruction}`
}