import chalk from 'chalk'
import { detectStack } from './core/detector/stack-detector'

function separator(title: string) {
  console.log('\n' + chalk.bgGreen.white(` ${title} `) + '\n')
}
function ok(msg: string)   { console.log(chalk.green('  ✅ ' + msg)) }
function info(msg: string) { console.log(chalk.gray('  → ' + msg)) }
function warn(msg: string) { console.log(chalk.yellow('  ⚠️  ' + msg)) }
function fail(msg: string) { console.log(chalk.red('  ❌ ' + msg)) }

// ─────────────────────────────────────────────────────────────────────────────
// TESTE 1 — detecta o próprio projeto do agente
// ─────────────────────────────────────────────────────────────────────────────

separator('TESTE 1 — Detecta o próprio projeto (agente-cli)')

const result = detectStack(process.cwd())

if (!result.success) {
  fail(`Erro: ${result.error}`)
  process.exit(1)
}

const p = result.profile!

ok('Detecção concluída')
console.log('')

console.log(chalk.bold('  📋 Perfil detectado:\n'))

info(`Projeto:        ${chalk.white(p.projectName)}`)
info(`Diretório:      ${chalk.white(p.rootDir)}`)
console.log('')
info(`Linguagem:      ${chalk.cyan(p.language)}`)
info(`Package Manager:${chalk.cyan(p.packageManager)}`)
info(`Monorepo:       ${chalk.cyan(p.monorepo)}`)
console.log('')
info(`Backend:        ${chalk.cyan(p.backend)}`)
info(`Frontend:       ${chalk.cyan(p.frontend)}`)
info(`Mobile:         ${chalk.cyan(p.mobile)}`)
console.log('')
info(`ORM:            ${chalk.cyan(p.orm)}`)
info(`Banco:          ${chalk.cyan(p.database)}`)
info(`Arquitetura:    ${chalk.cyan(p.architecture)}`)
info(`Testes:         ${chalk.cyan(p.testing)}`)
console.log('')

if (p.apps.length > 0) {
  info(`Apps:           ${chalk.cyan(p.apps.join(', '))}`)
} else {
  info(`Apps:           ${chalk.gray('nenhum (projeto simples)')}`)
}

console.log('')

if (p.ambiguities.length > 0) {
  warn(`Ambiguidades:   ${p.ambiguities.join(', ')} (agent init vai perguntar ao usuário)`)
} else {
  ok('Nenhuma ambiguidade — stack detectada completamente')
}

console.log('')

if (Object.keys(p.examplePaths).length > 0) {
  info('Exemplos encontrados para o LLM:')
  if (p.examplePaths.module)     info(`  module:     ${p.examplePaths.module.replace(process.cwd() + '/', '')}`)
  if (p.examplePaths.service)    info(`  service:    ${p.examplePaths.service.replace(process.cwd() + '/', '')}`)
  if (p.examplePaths.controller) info(`  controller: ${p.examplePaths.controller.replace(process.cwd() + '/', '')}`)
  if (p.examplePaths.entity)     info(`  entity:     ${p.examplePaths.entity.replace(process.cwd() + '/', '')}`)
} else {
  info('Exemplos:       nenhum encontrado (projeto sem código ainda)')
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTE 2 — verifica campos obrigatórios
// ─────────────────────────────────────────────────────────────────────────────

separator('TESTE 2 — Verifica campos obrigatórios do perfil')

const requiredFields = ['projectName', 'rootDir', 'language', 'packageManager', 'monorepo', 'backend', 'frontend', 'mobile', 'orm', 'database', 'architecture', 'testing']

let allPresent = true
for (const field of requiredFields) {
  const value = (p as any)[field]
  if (value !== undefined && value !== null) {
    ok(`${field}: ${chalk.white(value)}`)
  } else {
    fail(`${field} está undefined`)
    allPresent = false
  }
}

if (allPresent) {
  console.log('')
  ok('Todos os campos obrigatórios presentes')
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTE 3 — valida detecções esperadas para o agente-cli
// ─────────────────────────────────────────────────────────────────────────────

separator('TESTE 3 — Valida detecções esperadas para agente-cli')

function expect(field: string, actual: string, expected: string) {
  if (actual === expected) {
    ok(`${field}: ${chalk.white(actual)} (correto)`)
  } else {
    warn(`${field}: esperado "${expected}", detectou "${actual}"`)
  }
}

expect('language',       p.language,       'typescript')
expect('packageManager', p.packageManager, 'npm')
expect('monorepo',       p.monorepo,       'none')
expect('backend',        p.backend,        'none')
expect('frontend',       p.frontend,       'none')
expect('mobile',         p.mobile,         'none')

separator('TODOS OS TESTES CONCLUÍDOS')