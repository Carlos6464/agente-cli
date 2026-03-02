import chalk from 'chalk'
import ora from 'ora'
import { Command } from 'commander'
import { loadConfig, hasConfig } from './init'
import { indexProject } from '../rag/indexer'

export async function runIndex(options: { force?: boolean; projectRoot?: string } = {}) {
  const projectRoot = options.projectRoot || process.cwd()
  
  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('\n  ❌ Projeto não inicializado. Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const config = loadConfig(projectRoot)!
  
  // Pega o modelo que já está salvo no config.json
  const model = config.ai.embeddingModel || 'gemini-embedding-001'

  console.log(chalk.bold.cyan('\n  🧠 Agent Indexer (Sincronização de Memória)'))
  console.log(chalk.gray(`  Projeto: ${projectRoot}\n`))
  
  const spinner = ora('Atualizando memória vetorial com novos arquivos...').start()
  
  const indexResult = await indexProject({ 
    projectRoot, 
    model: model, 
    forceReindex: options.force || false, 
    onProgress: (msg) => { spinner.text = msg } 
  })
  
  if (indexResult.success) {
    spinner.succeed(`Memória atualizada com sucesso!`)
    console.log(chalk.green(`  ✅ ${indexResult.chunksCreated} novos chunks criados.`))
    console.log(chalk.gray(`  ⏭️  ${indexResult.skipped} arquivos já indexados foram ignorados.\n`))
  } else {
    spinner.fail(`Falha na indexação: ${indexResult.error}\n`)
  }
}

export function indexCommand(): Command {
  const command = new Command('index')
  command.description('Atualiza a memória do Agente (RAG) lendo os novos arquivos criados')
         .option('-f, --force', 'Força a reindexação de todos os arquivos do zero', false)
         .action(async (options) => { await runIndex({ force: options.force }) })
  return command
}