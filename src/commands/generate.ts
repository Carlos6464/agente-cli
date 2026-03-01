import chalk from 'chalk'
import ora   from 'ora'
const inquirer = require('inquirer')
const path     = require('path')
import { Command }   from 'commander'
import { loadConfig, hasConfig }  from './init'
import { runAgent, AgentStep }    from '../core/agent/agent-core'
import { indexFile }              from '../rag/indexer'

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

  // Injeta os exemplos que a IA detectou no Init para ela não ficar cega testando list_dir atoa
  const exemplosFound = config.profile.examplePaths 
    ? Object.entries(config.profile.examplePaths).map(([k, v]) => `  - Exemplo de ${k}: ${v}`).join('\n') 
    : '  (Nenhum exemplo base encontrado)'

  const instruction = `
Objetivo: Criar um(a) ${tipo} chamado(a) "${nome}"${app ? ` no workspace/app "${app}"` : ''}.

Arquivos de exemplo reais detectados na arquitetura do usuário:
${exemplosFound}

REGRAS DE EXECUÇÃO:
1. LER REFERÊNCIA: Se existir um arquivo de exemplo do mesmo tipo (ou parecido) na lista acima, USE A FERRAMENTA "read_file" nele primeiro para aprender os imports e o estilo de arquitetura exato (ex: injeção de dependência, decorators, types do DDD).
2. DESCOBRIR LOCAL: Use "list_dir" se precisar saber onde salvar o arquivo novo.
3. CRIAR O CÓDIGO: Use a ferramenta "write_file" para salvar o código gerado no disco.
   🚨 REGRA DE OURO: NUNCA responda com blocos de código Markdown no chat! Sempre coloque o código final dentro do parâmetro "content" da ferramenta "write_file".
4. FINALIZAR: Use a ferramenta "finish" informando o que foi feito.
`.trim()

  const spinner = ora('Iniciando o raciocínio da IA...').start()
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
        list_dir: 'Explorando pastas...', 
        read_file: 'Lendo código de referência do Aura...', 
        search_code: 'Buscando padrões...', 
        write_file: 'Escrevendo arquivo no disco...', 
        finish: 'Finalizando...' 
      }
      if (step.type === 'tool_call') {
        spinner.text = step.tool === 'write_file' && step.content.match(/"path"\s*:\s*"([^"]+)"/) 
          ? `Salvando ${path.basename(step.content.match(/"path"\s*:\s*"([^"]+)"/)![1])}...` 
          : labels[step.tool!] || `${step.tool}...`
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
    console.log(chalk.red(`\n  ❌ Erro: ${result.error}\n`)); process.exit(1)
  }

  const allFiles = result.files?.length ? result.files : filesCreated

  if (allFiles.length > 0) {
    console.log(chalk.bold.green('\n  ✅ Arquivos gerados:\n'))
    allFiles.forEach(f => console.log(chalk.white(`    + ${f.replace(projectRoot + '/', '')}`)))
  } else {
    console.log(chalk.yellow('\n  ⚠️  Nenhum arquivo foi criado.\n')); process.exit(0)
  }

  if (result.response) console.log('\n' + chalk.gray('  ' + result.response.replace(/\n/g, '\n  ')) + '\n')

  let shouldReindex = yes
  if (!yes && allFiles.length > 0) {
    const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Reindexar ${allFiles.length} arquivo(s) na IA?`, default: true }])
    shouldReindex = confirm
  }

  if (shouldReindex && allFiles.length > 0) {
    const s = ora('Reindexando...').start()
    for (const f of allFiles) {
      await indexFile(f, projectRoot, config.ai.baseUrl || 'http://localhost:11434', config.ai.embeddingModel)
    }
    s.succeed(`${allFiles.length} arquivo(s) reindexado(s)`)
  }
}

export function generateCommand(): Command {
  const cmd = new Command('generate')
  cmd.description('Gera código lendo e imitando os padrões reais do projeto')
     .argument('<tipo>', 'Ex: module, service, use-case, dto, vo')
     .argument('<nome>', 'Nome')
     .option('--app <app>', 'App ou Lib alvo (ex: libs/domain)')
     .option('-y, --yes', 'Pula confirmações')
     .action(async (tipo: string, nome: string, options: any) => { await runGenerate({ tipo, nome, app: options.app, yes: options.yes }) })
  return cmd
}