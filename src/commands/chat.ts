import { Command } from 'commander'
import chalk from 'chalk'

export function chatCommand(): Command {
  const command = new Command('chat')
  command
    .description('Conversa livre com o agente no contexto do projeto')
    .action(() => {
      console.log(chalk.blue('💬 Modo chat iniciado'))
      console.log(chalk.gray('  Carregando contexto do projeto...'))
      console.log(chalk.gray('  Digite "sair" para encerrar'))
      console.log(chalk.yellow('\n⚠️  Em construção — Etapa 11'))
    })
  return command
}
