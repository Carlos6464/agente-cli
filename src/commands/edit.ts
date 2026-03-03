import chalk from 'chalk'
import ora from 'ora'
import inquirer from 'inquirer'
import path from 'path'
import { Command } from 'commander'
import { loadConfig, hasConfig } from './init'
import { runAgent, AgentStep } from '../core/agent/agent-core'
import { indexFile } from '../rag/indexer'
import { loadPattern, listPatterns, PatternEntry, formatPatternForInstruction } from './pattern'

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUÇÃO DE ALVOS
//
// O comando edit aceita três formatos:
//
//   1. Por tipo + nome (igual ao generate):
//      agent edit service oficina --what "adicionar filtro"
//      → localiza automaticamente via list_dir / search_code
//
//   2. Por caminho direto (--file):
//      agent edit --file apps/backend/app/services/oficina_service.py --what "..."
//      → vai direto ao arquivo sem precisar procurar
//
//   3. Por múltiplos caminhos (--files):
//      agent edit --files "schema.py, repository.py, service.py, router.py" --what "..."
//      → lê todos na ordem e edita em cascata
//
// Todos aceitam --use-pattern como referência de implementação.
// ─────────────────────────────────────────────────────────────────────────────

// Parse de --files "a.py, b.py, c.py" → string[]
function parseFilesFlag(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

export async function runEdit(options: {
  tipo?:        string
  nome?:        string
  file?:        string
  files?:       string   // "schema.py, repo.py, service.py, router.py"
  what:         string
  usePattern?:  string
  app?:         string
  yes?:         boolean
  projectRoot?: string
}) {
  const { tipo, nome, what, yes = false } = options
  const projectRoot = options.projectRoot || process.cwd()

  // Normaliza: --files tem prioridade sobre --file
  const fileList: string[] = options.files
    ? parseFilesFlag(options.files)
    : options.file
      ? [options.file]
      : []

  // Validação: precisa de pelo menos tipo+nome OU --file OU --files
  if (!tipo && !nome && fileList.length === 0) {
    console.log(chalk.red('\n  ❌ Informe o alvo: tipo+nome, --file ou --files\n'))
    console.log(chalk.gray('  Exemplos:'))
    console.log(chalk.gray('    agent edit service oficina --what "adicionar filtro"'))
    console.log(chalk.gray('    agent edit --file apps/backend/.../oficina_service.py --what "..."'))
    console.log(chalk.gray('    agent edit --files "schema.py, repo.py, service.py, router.py" --what "..."\n'))
    process.exit(1)
  }

  if (!what || what.trim() === '') {
    console.log(chalk.red('\n  ❌ Descreva a mudança com --what "<descrição>"\n'))
    process.exit(1)
  }

  console.log('')
  console.log(chalk.bold.cyan('  ✏️   Agent Edit'))

  // Identifica o alvo para exibição
  if (fileList.length > 1) {
    console.log(chalk.gray('  Arquivos:'))
    fileList.forEach((f, i) =>
      console.log(chalk.gray(`    ${i + 1}.`) + chalk.white(` ${f}`))
    )
  } else if (fileList.length === 1) {
    console.log(chalk.gray('  Alvo:    ') + chalk.white(fileList[0]))
  } else {
    const target = chalk.white(`${tipo} ${nome}`) + (options.app ? chalk.gray(` [${options.app}]`) : '')
    console.log(chalk.gray('  Alvo:    ') + target)
  }

  console.log(chalk.gray('  Mudança: ') + chalk.white(what.slice(0, 90)) + (what.length > 90 ? '...' : ''))
  console.log('')

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('  ❌ Projeto não inicializado. Execute: agent init\n'))
    process.exit(1)
  }

  const config = loadConfig(projectRoot)!

  // ── Resolve padrão (--use-pattern) ───────────────────────────────────────

  let resolvedPattern: PatternEntry | null = null

  if (options.usePattern) {
    resolvedPattern = loadPattern(options.usePattern, projectRoot)

    if (!resolvedPattern) {
      const available = listPatterns(projectRoot)
      console.log(chalk.red(`  ❌ Padrão "${options.usePattern}" não encontrado.\n`))

      if (available.length > 0) {
        console.log(chalk.yellow('  Padrões disponíveis:'))
        available.forEach(p => {
          const desc = p.description ? chalk.gray(` — ${p.description}`) : ''
          console.log(chalk.white(`    • ${p.name}`) + desc)
        })
        console.log('')

        const { chosenPattern } = await inquirer.prompt([{
          type:    'list',
          name:    'chosenPattern',
          message: 'Usar um padrão existente como referência?',
          choices: [
            ...available.map(p => ({
              name:  p.name + (p.description ? ` (${p.description})` : ''),
              value: p.name
            })),
            { name: 'Continuar sem padrão', value: '__none__' }
          ]
        }])

        if (chosenPattern !== '__none__') {
          resolvedPattern = loadPattern(chosenPattern, projectRoot)
        }
      } else {
        const { continueWithout } = await inquirer.prompt([{
          type:    'confirm',
          name:    'continueWithout',
          message: 'Continuar sem padrão?',
          default: true
        }])
        if (!continueWithout) process.exit(0)
      }
    }

    if (resolvedPattern) {
      const isMulti = resolvedPattern.files && resolvedPattern.files.length > 1
      console.log(chalk.green(`  📌 Padrão: ${chalk.white(resolvedPattern.name)}`) +
        (isMulti ? chalk.cyan(' [multi-arquivo]') : ''))

      if (isMulti && resolvedPattern.files) {
        resolvedPattern.files.forEach(f =>
          console.log(chalk.gray(`     • [${f.role}] ${f.sourcePath}`))
        )
      }
      console.log('')
    }
  }

  const instruction = buildEditInstruction({
    tipo,
    nome,
    files:   fileList,
    app:     options.app,
    what,
    pattern: resolvedPattern
  })

  const spinner = ora('Lendo arquivo existente...').start()
  const filesEdited: string[] = []

  const result = await runAgent({
    instruction,
    profile: config.profile,
    projectRoot,
    aiConfig: config.ai,
    mode: 'generate',
    maxSteps: 20,
    onStep: (step: AgentStep) => {
      if (step.type === 'tool_call') {
        const tool = step.tool || ''
        const labels: Record<string, string> = {
          read_file:   'Lendo arquivo atual...',
          list_dir:    'Localizando arquivo...',
          search_code: 'Buscando no projeto...',
          write_file:  'Salvando edição...',
          finish:      'Finalizando...'
        }

        if (tool === 'write_file') {
          const match = step.content.match(/"path"\s*:\s*"([^"]+)"/)
          spinner.text = match
            ? `Salvando ${path.basename(match[1])}...`
            : 'Salvando edição...'
        } else {
          spinner.text = labels[tool] || `${tool}...`
        }
      } else if (step.type === 'thinking') {
        spinner.text = step.content
      }

      if (step.type === 'tool_result' && step.tool === 'write_file') {
        const match = step.content.match(/Arquivo criado: (.+)/)
        if (match) filesEdited.push(match[1])
      }
    }
  })

  spinner.stop()

  if (!result.success) {
    console.log(chalk.red(`\n  ❌ Erro: ${result.error}\n`))
    process.exit(1)
  }

  const allFiles = result.files?.length ? result.files : filesEdited

  if (allFiles.length > 0) {
    console.log(chalk.bold.green('\n  ✅ Arquivos editados:\n'))
    allFiles.forEach(f =>
      console.log(chalk.white(`    ~ ${f.replace(projectRoot + '/', '')}`))
    )
  } else {
    console.log(chalk.yellow('\n  ⚠️  Nenhum arquivo foi modificado.\n'))
    process.exit(0)
  }

  if (result.response) {
    console.log('\n' + chalk.gray('  ' + result.response.replace(/\n/g, '\n  ')) + '\n')
  }

  // ── Reindexação ───────────────────────────────────────────────────────────
  let shouldReindex = yes
  if (!yes && allFiles.length > 0) {
    const { confirm } = await inquirer.prompt([{
      type:    'confirm',
      name:    'confirm',
      message: `Reindexar ${allFiles.length} arquivo(s) editado(s)?`,
      default: true
    }])
    shouldReindex = confirm
  }

  if (shouldReindex && allFiles.length > 0) {
    const s = ora('Reindexando...').start()
    for (const f of allFiles) {
      await indexFile(f, projectRoot, config.ai.baseUrl || 'http://localhost:11434', config.ai.embeddingModel)
    }
    s.succeed(`${allFiles.length} arquivo(s) reindexado(s)`)
  }

  console.log('')
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD INSTRUCTION PARA EDIÇÃO
//
// Diferença chave em relação ao generate:
//   - O agente LÊ o(s) arquivo(s) EXISTENTE(s) antes de qualquer coisa
//   - Faz edições CIRÚRGICAS — não reescreve do zero
//   - O --pattern é referência de COMO implementar, não de estrutura completa
//   - --files permite editar N arquivos em cascata (ex: schema→repo→service→router)
// ─────────────────────────────────────────────────────────────────────────────

function buildEditInstruction(opts: {
  tipo?:   string
  nome?:   string
  files:   string[]   // [] = localizar por tipo+nome | [x] = arquivo único | [x,y,...] = cascata
  app?:    string
  what:    string
  pattern: PatternEntry | null
}): string {
  const { tipo, nome, files, app, what, pattern } = opts
  const partes: string[] = []
  const isMultiFile = files.length > 1
  const isSingleFile = files.length === 1
  const isSearch = files.length === 0

  // ── Cabeçalho ─────────────────────────────────────────────────────────────

  if (isMultiFile) {
    partes.push(
      `Objetivo: EDITAR os seguintes arquivos existentes EM CASCATA (nessa ordem exata):\n` +
      files.map((f, i) => `  ${i + 1}. ${f}`).join('\n')
    )
  } else if (isSingleFile) {
    partes.push(`Objetivo: EDITAR o arquivo existente "${files[0]}".`)
  } else {
    partes.push(`Objetivo: EDITAR o(s) arquivo(s) existente(s) do(a) ${tipo} "${nome}"${app ? ` no workspace "${app}"` : ''}.`)
  }

  partes.push(`\nMudança solicitada:\n${what}`)

  // ── Padrão de referência (como implementar) ────────────────────────────────

  if (pattern) {
    partes.push('\n' + formatPatternForInstruction(pattern))
    partes.push(`
⚠️  USO DO PADRÃO:
O padrão acima é uma REFERÊNCIA de implementação — mostra COMO fazer a mudança.
Adapte a lógica do padrão para cada arquivo existente que você vai ler.
NÃO substitua nenhum arquivo inteiro pelo padrão. Integre cirurgicamente.`)
  }

  // ── Etapa 1: Leitura ───────────────────────────────────────────────────────

  if (isMultiFile) {
    // Cascata: lê todos antes de escrever qualquer um
    const readList = files.map((f, i) => `  ${i + 1}. read_file("${f}")`).join('\n')
    partes.push(`
ETAPA 1 — LEIA TODOS OS ARQUIVOS ANTES DE EDITAR (OBRIGATÓRIO):
Use read_file em cada arquivo na ordem abaixo:
${readList}

Entenda COMPLETAMENTE a estrutura atual de cada arquivo antes de qualquer escrita.
Preste atenção nas assinaturas de função — a mudança se propaga em cascata.`)

  } else if (isSingleFile) {
    partes.push(`
ETAPA 1 — LEIA O ARQUIVO ATUAL (OBRIGATÓRIO):
Use read_file no arquivo: ${files[0]}
Entenda completamente a estrutura, imports e lógica existente ANTES de qualquer edição.`)

  } else {
    partes.push(`
ETAPA 1 — LOCALIZE E LEIA O(S) ARQUIVO(S) (OBRIGATÓRIO):
Use list_dir e/ou search_code para encontrar o(s) arquivo(s) de ${tipo} "${nome}".
Depois use read_file em CADA arquivo que precisa ser editado.
Entenda completamente a estrutura atual antes de qualquer mudança.`)
  }

  // ── Etapa 2: Planejar ─────────────────────────────────────────────────────

  if (isMultiFile) {
    partes.push(`
ETAPA 2 — MAPEIE A CASCATA:
Para cada arquivo, identifique:
  • O que muda na assinatura da função (parâmetros novos)?
  • O que precisa ser importado?
  • Como a mudança se propaga do arquivo anterior para o próximo?
A consistência entre os arquivos é obrigatória — parâmetros adicionados no schema
devem aparecer no repository, service e router com os mesmos nomes.`)
  } else {
    partes.push(`
ETAPA 2 — PLANEJE A EDIÇÃO:
Com base no arquivo lido, defina exatamente o que precisa mudar:
  • Quais imports adicionar?
  • Quais funções/métodos modificar?
  • O que NÃO deve mudar?
Edições cirúrgicas são preferíveis a reescritas completas.`)
  }

  // ── Etapa 3: Escrever ─────────────────────────────────────────────────────

  if (isMultiFile) {
    partes.push(`
ETAPA 3 — EDITE E SALVE CADA ARQUIVO NA ORDEM:
Use write_file para cada arquivo, respeitando a ordem: ${files.map(f => path.basename(f)).join(' → ')}
REGRAS:
  • Preserve TODO o código existente que não precisa mudar
  • Mantenha o estilo de indentação e nomenclatura de cada arquivo original
  • Não remova imports, funções ou endpoints não mencionados na mudança
  • Os parâmetros novos devem ter os MESMOS nomes em todos os arquivos`)
  } else {
    partes.push(`
ETAPA 3 — EDITE E SALVE:
Use write_file com o arquivo COMPLETO e modificado.
REGRAS:
  • Preserve todo o código existente que não precisa mudar
  • Mantenha o estilo de indentação e nomenclatura do arquivo original
  • Não remova imports ou funções que não foram mencionados na mudança`)
  }

  partes.push(`
ETAPA 4 — FINALIZE:
Use finish com:
  • Os caminhos de todos os arquivos modificados
  • Um resumo curto do que foi alterado em cada arquivo`)

  return partes.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// COMANDO
// ─────────────────────────────────────────────────────────────────────────────

export function editCommand(): Command {
  const cmd = new Command('edit')

  cmd
    .description('Edita arquivos existentes com base em uma descrição da mudança')
    .argument('[tipo]', 'Tipo do artefato (ex: service, router, model)')
    .argument('[nome]', 'Nome do módulo (ex: oficina, veiculo)')
    .option('--file <caminho>',   'Caminho direto de UM arquivo a editar')
    .option('--files <caminhos>', 'Múltiplos arquivos separados por vírgula (edição em cascata)')
    .option('--what <mudança>',   'Descrição do que deve ser alterado (obrigatório)')
    .option('--use-pattern <nome>', 'Padrão salvo como referência de implementação')
    .option('--app <app>', 'App ou workspace alvo')
    .option('-y, --yes', 'Pula confirmações')
    .addHelpText('after', `
Exemplos:
  # Por tipo + nome (agente localiza os arquivos)
  $ agent edit service oficina --what "adicionar filtro por razao_social e paginação"

  # Por caminho direto (arquivo único)
  $ agent edit --file apps/backend/app/services/oficina_service.py --what "adicionar filtro"

  # Múltiplos arquivos em cascata (schema → repository → service → router)
  $ agent edit \\
      --files "app/schemas/oficina_schema.py, app/repositories/oficina_repository.py, app/services/oficina_service.py, app/api/v1/oficina_router.py" \\
      --what "adicionar filtro por razao_social e paginação na cadeia get_all → listar_todos" \\
      --use-pattern filtro-paginacao

  # Com padrão de referência
  $ agent edit service oficina --what "adicionar filtro" --use-pattern filtro-paginacao
    `)
    .action(async (tipo: string | undefined, nome: string | undefined, options: any) => {
      if (!options.what) {
        console.log(chalk.red('\n  ❌ --what é obrigatório. Descreva o que deve ser alterado.\n'))
        cmd.help()
        process.exit(1)
      }

      await runEdit({
        tipo,
        nome,
        file:       options.file,
        files:      options.files,
        what:       options.what,
        usePattern: options.usePattern,
        app:        options.app,
        yes:        options.yes
      })
    })

  return cmd
}