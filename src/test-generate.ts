import chalk from 'chalk'
const fs   = require('fs')
const path = require('path')
import { runGenerate } from './commands/generate'

function separator(title: string) {
  console.log('\n' + chalk.bgMagenta.white(` ${title} `) + '\n')
}
function ok(msg: string)   { console.log(chalk.green('  ✅ ' + msg)) }
function fail(msg: string) { console.log(chalk.red('  ❌ ' + msg)) }
function info(msg: string) { console.log(chalk.gray('  → ' + msg)) }

async function main() {

  // ── TESTE 1: Gera um service simples ──────────────────────────────────────

  separator('TESTE 1 — Gera um service simples')

  await runGenerate({
    tipo: 'service',
    nome: 'calculator',
    yes:  true   // pula confirmação de reindexar
  })

  const serviceExists = fs.existsSync(path.join(process.cwd(), 'src/calculator.service.ts')) ||
    fs.existsSync(path.join(process.cwd(), 'src/services/calculator.service.ts')) ||
    // busca em qualquer lugar do src
    findFileRecursive(path.join(process.cwd(), 'src'), 'calculator.service.ts')

  if (serviceExists) {
    ok('calculator.service.ts criado com sucesso')
  } else {
    fail('Arquivo não encontrado — verifique o output acima')
  }

  // ── LIMPEZA ───────────────────────────────────────────────────────────────

  separator('LIMPEZA')
  try {
    // Remove qualquer arquivo de calculator criado
    cleanupFiles(path.join(process.cwd(), 'src'), 'calculator')
    ok('Arquivos de teste removidos')
  } catch (e) {
    info('Nenhum arquivo para limpar')
  }

  separator('TESTE CONCLUÍDO')
}

function findFileRecursive(dir: string, filename: string): boolean {
  if (!fs.existsSync(dir)) return false
  const entries = fs.readdirSync(dir)
  for (const entry of entries) {
    const full = path.join(dir, entry)
    if (entry === filename) return true
    if (fs.statSync(full).isDirectory()) {
      if (findFileRecursive(full, filename)) return true
    }
  }
  return false
}

function cleanupFiles(dir: string, prefix: string) {
  if (!fs.existsSync(dir)) return
  const entries = fs.readdirSync(dir)
  for (const entry of entries) {
    const full = path.join(dir, entry)
    if (entry.startsWith(prefix)) {
      fs.rmSync(full, { recursive: true, force: true })
    } else if (fs.statSync(full).isDirectory()) {
      cleanupFiles(full, prefix)
      // remove pasta vazia
      if (fs.readdirSync(full).length === 0) {
        fs.rmdirSync(full)
      }
    }
  }
}

main().catch(err => {
  console.error(chalk.red('\n❌ Erro inesperado:'), err)
  process.exit(1)
})