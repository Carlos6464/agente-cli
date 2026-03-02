#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { newCommand } from './commands/new'
import { initCommand } from './commands/init'
import { generateCommand } from './commands/generate'
import { runCommand } from './commands/run'
import { chatCommand } from './commands/chat'

const program = new Command()

program
  .name('agent')
  .description(chalk.bold('🤖 Agent CLI') + '\nAgente inteligente adaptável a qualquer stack')
  .version('0.1.0')

// program.addCommand(newCommand())
program.addCommand(initCommand())
program.addCommand(generateCommand())
program.addCommand(runCommand())
program.addCommand(chatCommand())

if (!process.argv.slice(2).length) {
  program.outputHelp()
}

program.parse(process.argv)
