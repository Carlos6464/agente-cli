import { Command } from 'commander'
import chalk from 'chalk'

export function newCommand(): Command {
  const command = new Command('new')
  command
    .description('Cria um novo projeto do zero com o wizard de stack')
    .argument('<nome>', 'Nome do projeto')
    .option('--profile <perfil>', 'Usar um perfil salvo')
    .action((nome: string, options: { profile?: string }) => {
      console.log(chalk.blue('🚀 Criando projeto:'), chalk.bold(nome))
      if (options.profile) {
        console.log(chalk.gray(`  Usando perfil: ${options.profile}`))
      } else {
        console.log(chalk.gray('  Iniciando wizard...'))
      }
      console.log(chalk.yellow('\n⚠️  Em construção — Etapa 12'))
    })
  return command
}
