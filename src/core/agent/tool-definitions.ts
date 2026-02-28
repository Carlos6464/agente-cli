// ─────────────────────────────────────────────────────────────────────────────
// TOOL DEFINITIONS
//
// Define as ferramentas que o LLM pode usar durante o loop do agente.
// Cada ferramenta tem:
//   - name:        identificador único
//   - description: o que a ferramenta faz (o LLM lê isso para decidir quando usar)
//   - parameters:  quais argumentos ela recebe
//
// O LLM não executa as ferramentas diretamente — ele declara que quer usar
// uma ferramenta em formato JSON, e o Agent Core executa por ele.
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolParameter {
  name:        string
  type:        'string' | 'boolean' | 'number'
  description: string
  required:    boolean
}

export interface ToolDefinition {
  name:        string
  description: string
  parameters:  ToolParameter[]
}

export interface ToolCall {
  tool:   string
  params: Record<string, any>
}

export interface ToolResult {
  tool:    string
  success: boolean
  output:  string   // sempre string para o LLM processar facilmente
  error?:  string
}

// ─────────────────────────────────────────────────────────────────────────────
// FERRAMENTAS DISPONÍVEIS
// O LLM recebe essa lista no system prompt e decide quando usar cada uma
// ─────────────────────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Lê o conteúdo de um arquivo do projeto. Use para entender como o código existente está organizado antes de gerar novos arquivos.',
    parameters: [
      {
        name:        'path',
        type:        'string',
        description: 'Caminho relativo do arquivo a partir da raiz do projeto',
        required:    true
      }
    ]
  },
  {
    name: 'write_file',
    description: 'Cria ou sobrescreve um arquivo com o conteúdo fornecido. Use para criar os arquivos gerados. Cria pastas intermediárias automaticamente.',
    parameters: [
      {
        name:        'path',
        type:        'string',
        description: 'Caminho relativo do arquivo a criar ou sobrescrever',
        required:    true
      },
      {
        name:        'content',
        type:        'string',
        description: 'Conteúdo completo do arquivo',
        required:    true
      }
    ]
  },
  {
    name: 'list_dir',
    description: 'Lista o conteúdo de uma pasta. Use para entender a estrutura do projeto antes de criar novos arquivos.',
    parameters: [
      {
        name:        'path',
        type:        'string',
        description: 'Caminho relativo da pasta a listar',
        required:    true
      },
      {
        name:        'recursive',
        type:        'boolean',
        description: 'Se true, lista subpastas também. Padrão: false',
        required:    false
      }
    ]
  },
  {
    name: 'search_code',
    description: 'Busca um termo em todos os arquivos do projeto. Use para encontrar exemplos de padrões existentes, como um módulo similar ao que vai ser criado.',
    parameters: [
      {
        name:        'term',
        type:        'string',
        description: 'Termo a buscar no código',
        required:    true
      },
      {
        name:        'path',
        type:        'string',
        description: 'Pasta onde buscar. Padrão: pasta raiz do projeto',
        required:    false
      }
    ]
  },
  {
    name: 'run_command',
    description: 'Executa um comando no terminal. Use para rodar build, testes, migrations e outros scripts do projeto.',
    parameters: [
      {
        name:        'command',
        type:        'string',
        description: 'Comando a executar',
        required:    true
      }
    ]
  },
  {
    name: 'finish',
    description: 'Indica que a tarefa foi concluída. Use quando todos os arquivos foram criados ou a resposta está pronta. Inclua um resumo do que foi feito.',
    parameters: [
      {
        name:        'summary',
        type:        'string',
        description: 'Resumo do que foi feito',
        required:    true
      }
    ]
  }
]

// ─────────────────────────────────────────────────────────────────────────────
// FORMATA AS DEFINIÇÕES DE FERRAMENTAS PARA O PROMPT
// O LLM recebe isso no system prompt para saber quais tools existem
// ─────────────────────────────────────────────────────────────────────────────

export function formatToolsForPrompt(tools: ToolDefinition[] = TOOL_DEFINITIONS): string {
  const lines: string[] = [
    '## Ferramentas Disponíveis\n',
    'Para executar uma ação, responda APENAS com um JSON no seguinte formato:',
    '```json',
    '{"tool": "nome_da_ferramenta", "params": {"param1": "valor1"}}',
    '```\n',
    'Ferramentas disponíveis:\n'
  ]

  for (const tool of tools) {
    lines.push(`### ${tool.name}`)
    lines.push(tool.description)

    if (tool.parameters.length > 0) {
      lines.push('Parâmetros:')
      for (const param of tool.parameters) {
        const required = param.required ? '(obrigatório)' : '(opcional)'
        lines.push(`  - ${param.name} [${param.type}] ${required}: ${param.description}`)
      }
    }

    lines.push('')
  }

  lines.push('Quando a tarefa estiver concluída, use a ferramenta "finish".')

  return lines.join('\n')
}