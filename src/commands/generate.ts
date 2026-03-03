import chalk from 'chalk'
import ora from 'ora'
import inquirer from 'inquirer'
import path from 'path'
import { Command } from 'commander'
import { loadConfig, hasConfig } from './init'
import { runAgent, AgentStep } from '../core/agent/agent-core'
import { indexFile } from '../rag/indexer'

export async function runGenerate(options: {
  tipo: string
  nome: string
  app?: string
  context?: string
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

  const exemplosFound = config.profile.examplePaths
    ? Object.entries(config.profile.examplePaths)
        .map(([k, v]) => `  - Exemplo de ${k}: ${v}`)
        .join('\n')
    : null

  const exemploDoTipo = config.profile.examplePaths?.[tipo]
    || config.profile.examplePaths?.[tipo.replace('-', '')]
    || null

  const instruction = buildInstruction(tipo, nome, app, context || null, exemploDoTipo, exemplosFound)

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
        list_dir: 'Explorando estrutura...',
        read_file: 'Lendo arquivo de referência...',
        search_code: 'Buscando padrões existentes...',
        write_file: 'Salvando arquivo...',
        finish: 'Finalizando...'
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

  // Reindexação
  let shouldReindex = yes
  if (!yes && allFiles.length > 0) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
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

function buildInstruction(
  tipo: string,
  nome: string,
  app: string | undefined,
  context: string | null,
  exemploDoTipo: string | null,
  todosExemplos: string | null
): string {
  const partes: string[] = []

  partes.push(`Objetivo: Criar um(a) ${tipo} chamado(a) "${nome}"${app ? ` no workspace/app "${app}"` : ''}.`)

  if (context) {
    const tipoNorm = tipo.toLowerCase()
    if (['model', 'entity', 'entidade', 'tabela'].some(t => tipoNorm.includes(t))) {
      partes.push(`\nESPECIFICAÇÃO DA TABELA/MODEL:\n${context}\n\nUse esses campos exatamente. Adapte tipos para o ORM do projeto.`)
    } else if (['schema', 'dto', 'serializer', 'type', 'interface'].some(t => tipoNorm.includes(t))) {
      partes.push(`\nESPECIFICAÇÃO DO SCHEMA/DTO:\n${context}\n\nCrie os campos de validação/tipagem conforme especificado.`)
    } else if (['service', 'serviço', 'use-case', 'usecase'].some(t => tipoNorm.includes(t))) {
      partes.push(`\nESPECIFICAÇÃO DO SERVICE/USE-CASE:\n${context}\n\nImplemente a lógica de negócio conforme especificado.`)
    } else if (['module', 'módulo'].some(t => tipoNorm.includes(t))) {
      partes.push(`\nESPECIFICAÇÃO DO MÓDULO COMPLETO:\n${context}\n\nCrie todos os arquivos necessários para o módulo (model, service, etc) com base nestes campos.`)
    } else {
      partes.push(`\nCONTEXTO ADICIONAL:\n${context}`)
    }
  }

  if (exemploDoTipo) {
    partes.push(`\nETAPA OBRIGATÓRIA 1 — LEIA A REFERÊNCIA DIRETA:\nUse read_file no arquivo: ${exemploDoTipo}\nMemorize: imports, decorators, estilo de nomenclatura e estrutura.`)
  } else {
    partes.push(`\nETAPA OBRIGATÓRIA 1 — ENCONTRE E LEIA UMA REFERÊNCIA:\nUse list_dir e search_code para achar um exemplo de "${tipo}". Depois use read_file no mais relevante.`)
  }

  if (todosExemplos) {
    partes.push(`\nOutros arquivos de referência:\n${todosExemplos}`)
  }

  partes.push(`\nETAPA 2 — LOCAL CORRETO: Use list_dir para confirmar onde o arquivo deve ser criado seguindo o padrão do projeto.`)
  partes.push(`\nETAPA 3 — CRIE O(S) ARQUIVO(S): Use write_file com o código completo. Imite fielmente os padrões de imports e estrutura da referência.`)
  partes.push(`\nETAPA 4 — FINALIZE: Use finish com os caminhos dos arquivos criados.`)

  return partes.join('\n')
}

export function generateCommand(): Command {
  const cmd = new Command('generate')

  cmd
    .description('Gera código lendo e imitando os padrões reais do projeto')
    .argument('<tipo>', 'Ex: module, service, model, schema, router, controller, dto')
    .argument('<nome>', 'Nome do artefato (ex: UserProfile)')
    .option('--app <app>', 'App ou workspace alvo')
    .option('--context <ctx>', 'Campos, relacionamentos ou regras de negócio')
    .option('-y, --yes', 'Pula confirmações')
    .action(async (tipo: string, nome: string, options: any) => {
      await runGenerate({
        tipo,
        nome,
        app: options.app,
        context: options.context,
        yes: options.yes
      })
    })

  return cmd
}