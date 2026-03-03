import chalk from 'chalk'
import ora from 'ora'
import inquirer from 'inquirer'
import path from 'path'
import { Command } from 'commander'
import { loadConfig, hasConfig } from './init'
import { runAgent, AgentStep } from '../core/agent/agent-core'
import { indexFile } from '../rag/indexer'
import { loadPattern, listPatterns, PatternEntry, formatPatternForInstruction } from './pattern'

export async function runGenerate(options: {
  tipo: string
  nome: string
  app?: string
  context?: string
  usePattern?: string
  projectRoot?: string
  yes?: boolean
}) {
  const { tipo, nome, app, context, yes = false } = options
  const projectRoot = options.projectRoot || process.cwd()

  console.log('')
  console.log(chalk.bold.cyan('  ⚙️  Agent Generate'))
  console.log(chalk.gray(`  Gerando: ${chalk.white(tipo)} ${chalk.white(nome)}${app ? chalk.gray(` [${app}]`) : ''}`))

  if (context) {
    console.log(chalk.gray(`  Contexto: ${chalk.white(context.slice(0, 80))}${context.length > 80 ? '...' : ''}`))
  }

  console.log('')

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('  ❌ Projeto não inicializado.'))
    console.log(chalk.yellow('  Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const config = loadConfig(projectRoot)!

  // ── Resolve o padrão solicitado (--use-pattern) ───────────────────────────

  let resolvedPattern: PatternEntry | null = null

  if (options.usePattern) {
    resolvedPattern = loadPattern(options.usePattern, projectRoot)

    if (!resolvedPattern) {
      const available = listPatterns(projectRoot)

      console.log(chalk.red(`  ❌ Padrão "${options.usePattern}" não encontrado.\n`))

      if (available.length > 0) {
        console.log(chalk.yellow('  Padrões disponíveis no projeto:'))
        available.forEach(p => {
          const desc = p.description ? chalk.gray(` — ${p.description}`) : ''
          console.log(chalk.white(`    • ${p.name}`) + desc)
        })
        console.log('')

        const { chosenPattern } = await inquirer.prompt([{
          type:    'list',
          name:    'chosenPattern',
          message: 'Usar um dos padrões existentes?',
          choices: [
            ...available.map(p => ({ name: p.name + (p.description ? ` (${p.description})` : ''), value: p.name })),
            { name: 'Continuar sem padrão', value: '__none__' }
          ]
        }])

        if (chosenPattern !== '__none__') {
          resolvedPattern = loadPattern(chosenPattern, projectRoot)
        }
      } else {
        console.log(chalk.gray('  Nenhum padrão salvo ainda.'))
        console.log(chalk.gray('  Use: agent pattern save <nome> --file <arquivo>'))
        console.log(chalk.gray('  Ou:  agent pattern save <nome> --files "<arq1>, <arq2>"\n'))

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
      // Detecta se é multi-arquivo para exibir feedback correto
      const isMulti = resolvedPattern.files && resolvedPattern.files.length > 1

      console.log(chalk.green(`  📌 Padrão carregado: ${chalk.white(resolvedPattern.name)}`) +
        (isMulti ? chalk.cyan('  [multi-arquivo]') : ''))

      if (isMulti && resolvedPattern.files) {
        resolvedPattern.files.forEach(f => {
          const lines = f.content.split('\n').length
          console.log(chalk.gray(`     • [${f.role}] ${f.sourcePath} (${lines} linhas)`))
        })
      } else if (resolvedPattern.sourceFile) {
        const lines = (resolvedPattern.content || '').split('\n').length
        console.log(chalk.gray(`     Referência: ${resolvedPattern.sourceFile} (${lines} linhas)`))
      }
      console.log('')
    }
  }

  // ── Monta referências do examplePaths (comportamento original) ────────────

  const exemplosFound = config.profile.examplePaths
    ? Object.entries(config.profile.examplePaths)
        .map(([k, v]) => `  - Exemplo de ${k}: ${v}`)
        .join('\n')
    : null

  const exemploDoTipo = config.profile.examplePaths?.[tipo]
    || config.profile.examplePaths?.[tipo.replace('-', '')]
    || null

  const instruction = buildInstruction(
    tipo, nome, app,
    context || null,
    exemploDoTipo,
    exemplosFound,
    resolvedPattern
  )

  console.log(chalk.gray(`  Instrução preparada para o Agente...\n`))

  const spinner = ora('Lendo referências do projeto...').start()
  const filesCreated: string[] = []

  const result = await runAgent({
    instruction,
    profile: config.profile,
    projectRoot,
    aiConfig: config.ai,
    mode: 'generate',
    maxSteps: 25,
    onStep: (step: AgentStep) => {
      const labels: Record<string, string> = {
        list_dir:    'Explorando estrutura...',
        read_file:   'Lendo arquivo de referência...',
        search_code: 'Buscando padrões existentes...',
        write_file:  'Salvando arquivo...',
        finish:      'Finalizando...'
      }

      if (step.type === 'tool_call') {
        const tool = step.tool || ''
        if (tool === 'write_file') {
          const match = step.content.match(/"path"\s*:\s*"([^"]+)"/)
          spinner.text = match ? `Salvando ${path.basename(match[1])}...` : 'Salvando arquivo...'
        } else {
          spinner.text = labels[tool] || `${tool}...`
        }
      } else if (step.type === 'thinking') {
        spinner.text = step.content
      }

      if (step.type === 'tool_result' && step.tool === 'write_file') {
        const match = step.content.match(/Arquivo criado: (.+)/)
        if (match) filesCreated.push(match[1])
      }
    }
  })

  spinner.stop()

  if (!result.success) {
    console.log(chalk.red(`\n  ❌ Erro: ${result.error}\n`))
    process.exit(1)
  }

  const allFiles = result.files?.length ? result.files : filesCreated

  if (allFiles.length > 0) {
    console.log(chalk.bold.green('\n  ✅ Arquivos gerados:\n'))
    allFiles.forEach(f =>
      console.log(chalk.white(`    + ${f.replace(projectRoot + '/', '')}`))
    )
  } else {
    console.log(chalk.yellow('\n  ⚠️  Nenhum arquivo foi criado.\n'))
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
      message: `Reindexar ${allFiles.length} arquivo(s) na IA?`,
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
// BUILD INSTRUCTION
//
// Hierarquia de referências (da mais para a menos autoritativa):
//   1. --use-pattern  → padrão explícito aprovado (prioridade MÁXIMA)
//                       suporta multi-arquivo via formatPatternForInstruction()
//   2. examplePaths   → arquivos detectados automaticamente pelo Stack Detector
//   3. --context      → campos, regras de negócio, especificações
// ─────────────────────────────────────────────────────────────────────────────

function buildInstruction(
  tipo:           string,
  nome:           string,
  app:            string | undefined,
  context:        string | null,
  exemploDoTipo:  string | null,
  todosExemplos:  string | null,
  pattern:        PatternEntry | null
): string {
  const partes: string[] = []

  partes.push(`Objetivo: Criar um(a) ${tipo} chamado(a) "${nome}"${app ? ` no workspace/app "${app}"` : ''}.`)

  // ── 1. PADRÃO EXPLÍCITO (prioridade máxima) ───────────────────────────────
  // Quando o usuário passou --use-pattern, esse bloco substitui qualquer
  // busca por referência. Suporta 1 ou N arquivos transparentemente.

  if (pattern) {
    partes.push('\n' + formatPatternForInstruction(pattern))
  }

  // ── 2. CONTEXTO / ESPECIFICAÇÃO ───────────────────────────────────────────


  // Quando padrão + contexto coexistem, deixa explícito que os campos
  // do contexto SUBSTITUEM os do padrão — não complementam.
  // Sem isso o LLM pode manter os campos do arquivo original (ex: problema.nome)
  // em vez de usar os campos especificados pelo usuário.
  if (pattern && context) {
    partes.push(`
⚠️  ADAPTAÇÃO OBRIGATÓRIA DOS CAMPOS:
O padrão acima usa campos do módulo original apenas como exemplo de ESTRUTURA.
Você DEVE substituir esses campos pelos especificados no CONTEXTO abaixo.
Regra: mantenha a lógica (filter, ilike, offset, limit, etc), troque apenas os nomes dos campos e colunas.
NÃO misture campos do padrão original com os do contexto.`)
  }

  if (context) {
    const tipoNorm = tipo.toLowerCase()
    if (['model', 'entity', 'entidade', 'tabela'].some(t => tipoNorm.includes(t))) {
      partes.push(`\nESPECIFICAÇÃO DA TABELA/MODEL:\n${context}\n\nUse esses campos exatamente. Adapte tipos para o ORM do projeto.`)
    } else if (['schema', 'dto', 'serializer', 'type', 'interface'].some(t => tipoNorm.includes(t))) {
      partes.push(`\nESPECIFICAÇÃO DO SCHEMA/DTO:\n${context}\n\nCrie os campos de validação/tipagem conforme especificado.`)
    } else if (['service', 'serviço', 'use-case', 'usecase'].some(t => tipoNorm.includes(t))) {
      partes.push(`\nESPECIFICAÇÃO DO SERVICE/USE-CASE:\n${context}\n\nImplemente a lógica de negócio conforme especificado.`)
    } else if (['module', 'módulo'].some(t => tipoNorm.includes(t))) {
      partes.push(`\nESPECIFICAÇÃO DO MÓDULO COMPLETO:\n${context}\n\nCrie todos os arquivos necessários para o módulo com base nestes campos.`)
    } else {
      partes.push(`\nCONTEXTO ADICIONAL:\n${context}`)
    }
  }

  // ── 3. REFERÊNCIAS DO PROJETO (quando não há padrão explícito) ────────────

  if (!pattern) {
    if (exemploDoTipo) {
      partes.push(`\nETAPA OBRIGATÓRIA 1 — LEIA A REFERÊNCIA DIRETA:\nUse read_file no arquivo: ${exemploDoTipo}\nMemorize: imports, decorators, estilo de nomenclatura e estrutura.`)
    } else {
      partes.push(`\nETAPA OBRIGATÓRIA 1 — ENCONTRE E LEIA UMA REFERÊNCIA:\nUse list_dir e search_code para achar um exemplo de "${tipo}". Depois use read_file no mais relevante.`)
    }

    if (todosExemplos) {
      partes.push(`\nOutros arquivos de referência:\n${todosExemplos}`)
    }
  } else {
    // Com padrão explícito, só verifica localização
    partes.push(`\nETAPA OBRIGATÓRIA 1 — O padrão já foi fornecido acima. Use read_file APENAS para confirmar o local correto onde o(s) arquivo(s) deve(m) ser criado(s).`)
  }

  partes.push(`\nETAPA 2 — LOCAL CORRETO: Use list_dir para confirmar onde o arquivo deve ser criado seguindo o padrão do projeto.`)
  partes.push(`\nETAPA 3 — CRIE O(S) ARQUIVO(S): Use write_file com o código completo. ${pattern ? 'Adapte o PADRÃO OBRIGATÓRIO acima para o novo contexto.' : 'Imite fielmente os padrões de imports e estrutura da referência.'}`)
  partes.push(`\nETAPA 4 — FINALIZE: Use finish com os caminhos dos arquivos criados.`)

  return partes.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// COMANDO
// ─────────────────────────────────────────────────────────────────────────────

export function generateCommand(): Command {
  const cmd = new Command('generate')

  cmd
    .description('Gera código lendo e imitando os padrões reais do projeto')
    .argument('<tipo>', 'Ex: module, service, model, schema, router, controller, dto')
    .argument('<nome>', 'Nome do artefato (ex: UserProfile)')
    .option('--app <app>', 'App ou workspace alvo')
    .option('--context <ctx>', 'Campos, relacionamentos ou regras de negócio')
    .option('--use-pattern <nome>', 'Usa um padrão salvo como referência obrigatória (ver: agent pattern list)')
    .option('-y, --yes', 'Pula confirmações')
    .action(async (tipo: string, nome: string, options: any) => {
      await runGenerate({
        tipo,
        nome,
        app:        options.app,
        context:    options.context,
        usePattern: options.usePattern,
        yes:        options.yes
      })
    })

  return cmd
}