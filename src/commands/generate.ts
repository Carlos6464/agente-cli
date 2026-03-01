import chalk from 'chalk'
import ora   from 'ora'
const inquirer = require('inquirer')
const path     = require('path')
import { Command }   from 'commander'
import { loadConfig, hasConfig }  from './init'
import { runAgent, AgentStep }    from '../core/agent/agent-core'
import { indexFile }              from '../rag/indexer'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT GENERATE — zero conhecimento embutido
//
// Este arquivo não sabe nada sobre NestJS, Express, Prisma, TypeORM,
// DDD, MVC ou qualquer outro framework/padrão.
//
// A instrução que o LLM recebe tem uma única regra:
//   LEIA o projeto antes de escrever qualquer linha de código.
//
// O LLM descobre tudo sozinho: onde ficam os arquivos, como se chamam,
// quais imports usam, qual versão da ferramenta está instalada,
// qual padrão arquitetural está sendo seguido.
// ─────────────────────────────────────────────────────────────────────────────

export async function runGenerate(options: {
  tipo:         string
  nome:         string
  app?:         string
  projectRoot?: string
  yes?:         boolean
}) {
  const { tipo, nome, app, yes = false } = options
  const projectRoot = options.projectRoot || process.cwd()

  console.log('')
  console.log(chalk.bold.cyan('  ⚙️  Agent Generate'))
  console.log(chalk.gray(`  Gerando: ${chalk.white(tipo)} ${chalk.white(nome)}${app ? chalk.gray(` [${app}]`) : ''}\n`))

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('  ❌ Projeto não inicializado.'))
    console.log(chalk.yellow('  Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const config = loadConfig(projectRoot)!

  // A instrução não tem nenhum conhecimento sobre frameworks —
  // apenas orienta o LLM a explorar e imitar o que encontrar
  const instruction = `
Preciso que você crie um(a) ${tipo} chamado(a) "${nome}"${app ? ` dentro do app "${app}"` : ''}.

ETAPAS OBRIGATÓRIAS — execute nesta ordem antes de criar qualquer arquivo:

1. LIST_DIR: Liste a raiz do projeto para entender a estrutura geral.

2. ENCONTRE UM EXEMPLO REAL: Procure no projeto um arquivo do mesmo tipo "${tipo}" que já existe.
   Use search_code ou list_dir para encontrá-lo.
   Se não achar um "${tipo}", procure o tipo mais próximo (ex: se for "repository", procure "service").

3. LEIA O EXEMPLO: Use read_file para ler esse arquivo existente completamente.
   Observe e memorize:
   - Exatamente onde o arquivo está no diretório
   - Como se chama (padrão de nomenclatura)
   - Quais imports usa e de onde vêm
   - Quais decorators, anotações ou padrões aplica
   - Como a classe/função/componente é estruturada internamente
   - Qual versão das dependências está sendo usada (veja o package.json se precisar)

4. SE NECESSÁRIO, leia mais 1 ou 2 arquivos relacionados para entender dependências
   (ex: se for criar um module, leia um module existente E o arquivo principal do app).

5. CRIE OS ARQUIVOS: Agora crie os novos arquivos imitando FIELMENTE o que você viu.
   - Mesma localização de pasta (seguindo o padrão existente)
   - Mesmo padrão de nomenclatura
   - Mesmos imports e estrutura
   - Não invente padrões novos
   - Não use APIs ou sintaxes que não viu no projeto

6. Use finish com um resumo do que foi criado.

IMPORTANTE: Você não tem conhecimento sobre como este projeto específico funciona até ler os arquivos.
Não assuma nada. Descubra tudo lendo o código real.
`.trim()

  const spinner      = ora('Lendo o projeto...').start()
  const filesCreated: string[] = []

  const result = await runAgent({
    instruction,
    profile:  config.profile,
    projectRoot,
    baseUrl:  config.ollama.baseUrl,
    mode:     'generate',
    maxSteps: 25,
    onStep: (step: AgentStep) => {
      const labels: Record<string, string> = {
        list_dir:    'Explorando estrutura...',
        read_file:   'Lendo referência...',
        search_code: 'Procurando exemplos...',
        write_file:  'Criando arquivo...',
        finish:      'Finalizando...',
      }
      if (step.type === 'tool_call') {
        const tool = step.tool || ''
        if (tool === 'write_file') {
          const match = step.content.match(/"path"\s*:\s*"([^"]+)"/)
          spinner.text = match ? `Criando ${path.basename(match[1])}...` : 'Criando arquivo...'
        } else {
          spinner.text = labels[tool] || `${tool}...`
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

  const allFiles = result.files?.length ? result.files : filesCreated

  if (allFiles.length > 0) {
    console.log(chalk.bold.green('\n  ✅ Arquivos gerados:\n'))
    allFiles.forEach(f => {
      console.log(chalk.white(`    + ${f.replace(projectRoot + '/', '')}`))
    })
  } else {
    console.log(chalk.yellow('\n  ⚠️  Nenhum arquivo foi criado.\n'))
    process.exit(0)
  }

  if (result.response) {
    console.log('\n' + chalk.gray('  ' + result.response.replace(/\n/g, '\n  ')) + '\n')
  }

  // Reindexe
  let shouldReindex = yes
  if (!yes) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm', name: 'confirm',
      message: `Reindexar ${allFiles.length} arquivo(s) no RAG?`,
      default: true
    }])
    shouldReindex = confirm
  }

  if (shouldReindex) {
    const s = ora('Reindexando...').start()
    for (const f of allFiles) {
      await indexFile(f, projectRoot, config.ollama.baseUrl, config.ollama.embeddingModel)
    }
    s.succeed(`${allFiles.length} arquivo(s) reindexado(s)`)
  }

  console.log('')
}

export function generateCommand(): Command {
  const cmd = new Command('generate')
  cmd.description('Gera código lendo e imitando os padrões reais do projeto')
     .argument('<tipo>', 'O que gerar (ex: module, service, component, page, hook, dto...)')
     .argument('<nome>', 'Nome do que gerar (ex: payments, UserProfile)')
     .option('--app <app>', 'App alvo no monorepo')
     .option('-y, --yes',   'Pula confirmações')
     .action(async (tipo: string, nome: string, options: { app?: string; yes?: boolean }) => {
       await runGenerate({ tipo, nome, app: options.app, yes: options.yes })
     })
  return cmd
}