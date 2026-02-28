import { Command } from 'commander'
import chalk from 'chalk'

export function runCommand(): Command {
  const command = new Command('run')
  command
    .description('Executa tarefas do projeto com seleção interativa')
    .option('--app <app>', 'App alvo no monorepo')
    .action((options: { app?: string }) => {
      console.log(chalk.blue('🔧 Executar tarefa'))
      console.log(chalk.gray('  1. Build'))
      console.log(chalk.gray('  2. Test'))
      console.log(chalk.gray('  3. Lint / Format'))
      console.log(chalk.gray('  4. Database (migrate, seed, reset)'))
      console.log(chalk.gray('  5. Deploy'))
      console.log(chalk.gray('  6. Custom Script'))
      if (options.app) console.log(chalk.gray(`\n  App alvo: ${options.app}`))
      console.log(chalk.yellow('\n⚠️  Em construção — Etapa 10'))
    })
  return command
}
