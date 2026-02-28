import chalk from 'chalk'
import ora   from 'ora'
const inquirer = require('inquirer')
import { Command } from 'commander'

import { loadConfig, hasConfig }         from './init'
import { runAgent }                      from '../core/agent/agent-core'
import { indexFile }                     from '../rag/indexer'
import { AgentStep }                     from '../core/agent/agent-core'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT GENERATE
//
// Gera código seguindo os padrões do projeto atual.
// Uso:
//   agent generate module payments
//   agent generate service users --app api
//   agent generate component Button --app web
//   agent generate page dashboard --app web
//
// Fluxo:
//   1. Carrega .agent/config.json
//   2. Monta instrução rica com tipo, nome e app alvo
//   3. Roda o Agent Core (RAG + LLM + tool calling)
//   4. Mostra preview dos arquivos que serão criados
//   5. Pede confirmação antes de escrever
//   6. Reindexe os arquivos criados no RAG
// ─────────────────────────────────────────────────────────────────────────────

export async function runGenerate(options: {
  tipo:         string
  nome:         string
  app?:         string
  projectRoot?: string
  yes?:         boolean   // pula confirmação
}) {
  const { tipo, nome, app, yes = false } = options
  const projectRoot = options.projectRoot || process.cwd()

  console.log('')
  console.log(chalk.bold.cyan('  ⚙️  Agent Generate'))
  console.log(chalk.gray(`  Gerando: ${chalk.white(tipo)} ${chalk.white(nome)}${app ? chalk.gray(` [${app}]`) : ''}\n`))

  // ── 1. Carrega config ──────────────────────────────────────────────────────

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('  ❌ Projeto não inicializado.'))
    console.log(chalk.yellow('  Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const config = loadConfig(projectRoot)!

  // ── 2. Monta a instrução ───────────────────────────────────────────────────

  const instruction = buildInstruction(tipo, nome, app, config.profile)

  console.log(chalk.gray(`  Instrução: ${instruction.slice(0, 100)}...\n`))

  // ── 3. Roda o agente ───────────────────────────────────────────────────────

  const spinner = ora('Pensando...').start()
  const filesCreated: string[] = []

  const result = await runAgent({
    instruction,
    profile:     config.profile,
    projectRoot,
    baseUrl:     config.ollama.baseUrl,
    mode:        'generate',
    maxSteps:    20,
    onStep: (step: AgentStep) => {
      if (step.type === 'thinking') {
        spinner.text = `Pensando... (${step.content})`
      }
      if (step.type === 'tool_call') {
        const tool = step.tool || ''
        if (tool === 'write_file') {
          // Extrai o caminho do arquivo da descrição do step
          const match = step.content.match(/write_file\(.*?"path":"([^"]+)"/)
          const filePath = match ? match[1] : 'arquivo'
          spinner.text = `Criando ${filePath}...`
        } else if (tool === 'read_file') {
          spinner.text = `Lendo referências...`
        } else if (tool === 'list_dir') {
          spinner.text = `Explorando estrutura...`
        } else if (tool === 'search_code') {
          spinner.text = `Buscando padrões...`
        }
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

  // ── 4. Exibe resultado ────────────────────────────────────────────────────

  const allFiles = result.files || filesCreated

  if (allFiles.length > 0) {
    console.log(chalk.bold.green('\n  ✅ Arquivos gerados:\n'))
    allFiles.forEach(f => {
      const rel = f.replace(projectRoot + '/', '')
      console.log(chalk.white(`    + ${rel}`))
    })
  }

  if (result.response) {
    console.log('\n' + chalk.gray('  ' + result.response.replace(/\n/g, '\n  ')) + '\n')
  }

  // ── 5. Confirmação antes de reindexar ─────────────────────────────────────

  if (allFiles.length === 0) {
    console.log(chalk.yellow('\n  ⚠️  Nenhum arquivo foi criado.'))
    console.log(chalk.gray('  Tente ser mais específico na instrução.\n'))
    process.exit(0)
  }

  let shouldReindex = yes

  if (!yes) {
    const { confirm } = await inquirer.prompt([{
      type:    'confirm',
      name:    'confirm',
      message: `Reindexar ${allFiles.length} arquivo(s) no RAG?`,
      default: true
    }])
    shouldReindex = confirm
  }

  // ── 6. Reindexe ───────────────────────────────────────────────────────────

  if (shouldReindex) {
    const reindexSpinner = ora('Reindexando arquivos criados...').start()

    for (const filePath of allFiles) {
      await indexFile(filePath, projectRoot, config.ollama.baseUrl, config.ollama.embeddingModel)
    }

    reindexSpinner.succeed(`${allFiles.length} arquivo(s) reindexado(s)`)
  }

  console.log('')
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTA A INSTRUÇÃO RICA PARA O AGENTE
// Quanto mais contexto, melhor o código gerado
// ─────────────────────────────────────────────────────────────────────────────

function buildInstruction(
  tipo:    string,
  nome:    string,
  app:     string | undefined,
  profile: any
): string {
  const parts: string[] = []

  // Base da instrução
  parts.push(`Gere um(a) ${tipo} chamado(a) "${nome}" seguindo os padrões do projeto.`)

  // App alvo no monorepo
  if (app) {
    parts.push(`O código deve ser criado dentro do app "${app}".`)
  }

  // Hints específicos por tipo
  const typeHints: Record<string, string> = {
    module:     `Crie todos os arquivos necessários: ${nome}.module.ts, ${nome}.service.ts, ${nome}.controller.ts. Se usar TypeORM ou Prisma, inclua também a entidade ou model.`,
    service:    `Crie o arquivo ${nome}.service.ts com a classe de serviço, métodos CRUD básicos e injeção de dependências.`,
    controller: `Crie o arquivo ${nome}.controller.ts com os endpoints REST: GET (listagem e por id), POST, PUT/PATCH e DELETE.`,
    entity:     `Crie o arquivo ${nome}.entity.ts com os campos básicos: id, createdAt, updatedAt e campos específicos do domínio.`,
    repository: `Crie o arquivo ${nome}.repository.ts com os métodos de acesso ao banco de dados.`,
    page:       `Crie o arquivo ${nome}.tsx com o componente de página, incluindo layout, estados e chamadas de API.`,
    component:  `Crie o arquivo ${nome}.tsx com o componente React, props tipadas e estilos.`,
    hook:       `Crie o arquivo use${nome}.ts com o custom hook, estados, efeitos e retorno tipado.`,
    dto:        `Crie o arquivo ${nome}.dto.ts com os DTOs de criação, atualização e resposta.`,
    test:       `Crie o arquivo ${nome}.spec.ts com testes unitários cobrindo os casos principais.`,
  }

  const hint = typeHints[tipo.toLowerCase()]
  if (hint) parts.push(hint)

  // Hints da stack detectada
  if (profile.backend === 'nestjs') {
    parts.push('Use os padrões do NestJS: decorators, injeção de dependência pelo construtor e módulos.')
  }
  if (profile.orm === 'prisma') {
    parts.push('Use o PrismaClient para acesso ao banco de dados.')
  }
  if (profile.orm === 'typeorm') {
    parts.push('Use os decorators do TypeORM e injete o Repository pelo módulo.')
  }
  if (profile.architecture === 'ddd') {
    parts.push('Siga a arquitetura DDD: separe domain, application e infra corretamente.')
  }

  // Instrução final
  parts.push('Antes de criar os arquivos, liste a estrutura da pasta src para entender onde colocar os novos arquivos. Use arquivos existentes como referência de estilo e nomenclatura.')

  return parts.join(' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMANDER WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

export function generateCommand(): Command {
  const command = new Command('generate')

  command
    .description('Gera código seguindo os padrões do projeto atual')
    .argument('<tipo>', 'O que gerar: module, service, controller, entity, page, component, hook, dto, test')
    .argument('<nome>', 'Nome do que será gerado (ex: payments, UserProfile)')
    .option('--app <app>', 'App alvo dentro do monorepo (ex: api, web, mobile)')
    .option('-y, --yes',   'Pula confirmações')
    .action(async (tipo: string, nome: string, options: { app?: string; yes?: boolean }) => {
      await runGenerate({
        tipo,
        nome,
        app:  options.app,
        yes:  options.yes
      })
    })

  return command
}