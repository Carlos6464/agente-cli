import chalk from 'chalk'
const path = require('path')
const fs   = require('fs')

import { runInit, loadConfig, hasConfig, saveConfig } from './commands/init'

function separator(title: string) {
  console.log('\n' + chalk.bgWhite.black(` ${title} `) + '\n')
}
function ok(msg: string)   { console.log(chalk.green('  ✅ ' + msg)) }
function fail(msg: string) { console.log(chalk.red('  ❌ ' + msg)) }
function info(msg: string) { console.log(chalk.gray('  → ' + msg)) }

async function main() {

  // ── TESTE 1: Roda o agent init no próprio projeto ─────────────────────────

  separator('TESTE 1 — Roda agent init no projeto agente-cli')

  info('Isso vai detectar stack, resolver ambiguidades e indexar...')
  info('Responda as perguntas que aparecerem\n')

  await runInit({ reindex: false })

  // ── TESTE 2: Verifica se a config foi salva ───────────────────────────────

  separator('TESTE 2 — Verifica .agent/config.json')

  const configExists = hasConfig(process.cwd())

  if (configExists) {
    ok('.agent/config.json existe')
  } else {
    fail('.agent/config.json não foi criado')
    process.exit(1)
  }

  const config = loadConfig(process.cwd())

  if (!config) {
    fail('Não foi possível carregar a config')
    process.exit(1)
  }

  ok(`Versão: ${config.version}`)
  ok(`Projeto: ${config.profile.projectName}`)
  ok(`Linguagem: ${config.profile.language}`)
  ok(`Ollama model: ${config.ollama.defaultModel}`)
  info(`Criado em: ${config.createdAt}`)

  // ── TESTE 3: Verifica o índice RAG ────────────────────────────────────────

  separator('TESTE 3 — Verifica .agent/index/vectors.json')

  const indexPath = path.join(process.cwd(), '.agent', 'index', 'vectors.json')

  if (fs.existsSync(indexPath)) {
    const stat = fs.statSync(indexPath)
    ok(`Índice existe: ${Math.round(stat.size / 1024)}kb`)
  } else {
    fail('Índice não encontrado')
  }

  // ── TESTE 4: Verifica .gitignore ──────────────────────────────────────────

  separator('TESTE 4 — Verifica .gitignore')

  const gitignorePath = path.join(process.cwd(), '.gitignore')

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8')
    if (content.includes('.agent/')) {
      ok('.agent/ está no .gitignore')
    } else {
      fail('.agent/ não foi adicionado ao .gitignore')
    }
  } else {
    info('.gitignore não existe (normal em projetos novos)')
  }

  // ── TESTE 5: loadConfig funciona sem reindexar ────────────────────────────

  separator('TESTE 5 — loadConfig retorna config salva')

  const config2 = loadConfig()

  if (config2 && config2.profile.projectName === config.profile.projectName) {
    ok('loadConfig retornou a config correta')
    info(`Ambiguidades resolvidas: ${config2.profile.ambiguities.length === 0 ? 'nenhuma' : config2.profile.ambiguities.join(', ')}`)
  } else {
    fail('loadConfig retornou config incorreta ou null')
  }

  separator('TODOS OS TESTES CONCLUÍDOS')
}

main().catch(err => {
  console.error(chalk.red('\n❌ Erro inesperado:'), err)
  process.exit(1)
})