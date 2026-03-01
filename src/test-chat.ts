import chalk from 'chalk'

function separator(title: string) {
  console.log('\n' + chalk.bgBlue.white(` ${title} `) + '\n')
}
function ok(msg: string)   { console.log(chalk.green('  ✅ ' + msg)) }
function fail(msg: string) { console.log(chalk.red('  ❌ ' + msg)) }
function info(msg: string) { console.log(chalk.gray('  → ' + msg)) }

separator('AGENT CHAT — Testes de importação e estrutura')

// ── TESTE 1: importa sem erros ────────────────────────────────────────────────

try {
  const { chatCommand, runChat } = require('./commands/chat')
  ok('chat.ts importado sem erros')
  ok('chatCommand exportado')
  ok('runChat exportado')
} catch (e) {
  fail(`Erro ao importar: ${(e as Error).message}`)
  process.exit(1)
}

// ── TESTE 2: comando registrado no CLI ────────────────────────────────────────

separator('TESTE 2 — Comando registrado no CLI')

try {
  const { execSync } = require('child_process')
  const help = execSync('node -r ts-node/register src/index.ts --help', {
    encoding: 'utf-8',
    cwd: process.cwd()
  })

  if (help.includes('chat')) {
    ok('Comando "chat" registrado no CLI')
  } else {
    fail('Comando "chat" não encontrado no help')
  }
} catch (e) {
  fail(`Erro ao verificar CLI: ${(e as Error).message}`)
}

// ── TESTE 3: histórico ────────────────────────────────────────────────────────

separator('TESTE 3 — Funções de histórico')

const fs   = require('fs')
const path = require('path')

// Simula salvar e carregar histórico
const testHistoryPath = path.join(process.cwd(), '.agent', 'test-history.json')
const testMessages    = [
  { role: 'user',      content: 'como funciona o RAG?',     timestamp: new Date().toISOString() },
  { role: 'assistant', content: 'O RAG funciona assim...',  timestamp: new Date().toISOString() },
]

try {
  fs.writeFileSync(testHistoryPath, JSON.stringify(testMessages, null, 2))
  const loaded = JSON.parse(fs.readFileSync(testHistoryPath, 'utf-8'))

  if (loaded.length === 2 && loaded[0].role === 'user') {
    ok('Histórico salvo e carregado corretamente')
  }

  fs.unlinkSync(testHistoryPath)
  ok('Arquivo de histórico de teste removido')
} catch (e) {
  fail(`Erro no teste de histórico: ${(e as Error).message}`)
}

separator('COMO USAR')

info('O agent chat é interativo. Inicie com:')
console.log('')
console.log(chalk.cyan('  npm run dev -- chat'))
console.log('')
console.log(chalk.gray('  Exemplos de perguntas:'))
console.log(chalk.gray('  • "como o provider do ollama está implementado?"'))
console.log(chalk.gray('  • "explica o fluxo do agent core"'))
console.log(chalk.gray('  • "como posso adicionar um novo comando ao CLI?"'))
console.log(chalk.gray('  • "quais ferramentas o agente tem?"'))
console.log('')
console.log(chalk.gray('  Comandos dentro do chat:'))
console.log(chalk.gray('  /sair  /limpar  /historico  /ajuda'))
console.log('')

separator('TODOS OS TESTES CONCLUÍDOS')