import chalk from 'chalk'

// O agent run é interativo por natureza — não dá para testar automaticamente
// Este arquivo demonstra como usar e testa o que pode ser testado sem input

function separator(title: string) {
  console.log('\n' + chalk.bgYellow.black(` ${title} `) + '\n')
}
function ok(msg: string)   { console.log(chalk.green('  ✅ ' + msg)) }
function info(msg: string) { console.log(chalk.gray('  → ' + msg)) }

separator('AGENT RUN — Como usar')

info('O agent run é interativo. Use via CLI:')
console.log('')
console.log(chalk.white('  npm run dev -- run'))
console.log(chalk.gray('  → Abre menu: Build / Test / Lint / Database / Deploy / Custom'))
console.log('')
console.log(chalk.white('  npm run dev -- run --app api'))
console.log(chalk.gray('  → Pula seleção de app, já usa "api"'))
console.log('')

separator('TESTE — Verifica se o comando está registrado no CLI')

const { execSync } = require('child_process')

try {
  const help = execSync('node -r ts-node/register src/index.ts --help', {
    encoding: 'utf-8',
    cwd: process.cwd()
  })

  if (help.includes('run')) {
    ok('Comando "run" registrado no CLI')
  } else {
    console.log(chalk.red('  ❌ Comando "run" não encontrado no help'))
  }
} catch (e) {
  console.log(chalk.red('  ❌ Erro ao verificar CLI'))
}

separator('TESTE — Verifica dependências do run.ts')

try {
  require('./commands/run')
  ok('run.ts importado sem erros')
} catch (e) {
  console.log(chalk.red(`  ❌ Erro ao importar: ${(e as Error).message}`))
}

separator('USO DIRETO')
info('Para testar o agent run de verdade:')
console.log('')
console.log(chalk.cyan('  npm run dev -- run'))
console.log('')
info('Selecione "Test" e confirme — vai rodar os testes do projeto.')
console.log('')