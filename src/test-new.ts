import chalk from 'chalk'
const fs   = require('fs')
const path = require('path')

function separator(title: string) {
  console.log('\n' + chalk.bgGreen.black(` ${title} `) + '\n')
}
function ok(msg: string)   { console.log(chalk.green('  ✅ ' + msg)) }
function fail(msg: string) { console.log(chalk.red('  ❌ ' + msg)) }
function info(msg: string) { console.log(chalk.gray('  → ' + msg)) }

// ── TESTE 1: importações ──────────────────────────────────────────────────────

separator('TESTE 1 — Importações')

try {
  require('./core/wizard/stack-wizard')
  ok('stack-wizard.ts importado')
} catch (e) { fail(`stack-wizard: ${(e as Error).message}`) }

try {
  require('./core/templates/template-engine')
  ok('template-engine.ts importado')
} catch (e) { fail(`template-engine: ${(e as Error).message}`) }

try {
  require('./core/memory/profile-memory')
  ok('profile-memory.ts importado')
} catch (e) { fail(`profile-memory: ${(e as Error).message}`) }

try {
  require('./commands/new')
  ok('new.ts importado')
} catch (e) { fail(`new.ts: ${(e as Error).message}`) }

// ── TESTE 2: Template Engine gera arquivos sem I/O ────────────────────────────

separator('TESTE 2 — Template Engine')

const { generateProjectFiles } = require('./core/templates/template-engine')

const mockProfile = {
  projectName:    'test-app',
  rootDir:        '/tmp/test-app',
  language:       'typescript',
  packageManager: 'npm',
  backend:        'nestjs',
  frontend:       'none',
  mobile:         'none',
  monorepo:       'none',
  orm:            'prisma',
  database:       'postgresql',
  architecture:   'modular',
  testing:        'jest',
  apps:           [],
  ambiguities:    [],
  examplePaths:   {}
}

const result = generateProjectFiles(mockProfile, '/tmp/test-app')

if (result.success && result.files.length > 0) {
  ok(`${result.files.length} arquivo(s) gerado(s) para NestJS + Prisma:`)
  result.files.forEach((f: any) => info(f.path))
} else {
  fail(`Erro: ${result.error}`)
}

// ── TESTE 3: Profile Memory ───────────────────────────────────────────────────

separator('TESTE 3 — Profile Memory')

const { saveProfile, loadProfile, listProfiles, deleteProfile } = require('./core/memory/profile-memory')

// Salva um perfil de teste
saveProfile('test-nestjs-prisma', mockProfile)
ok('Perfil "test-nestjs-prisma" salvo em ~/.agent/profiles/')

// Carrega de volta
const loaded = loadProfile('test-nestjs-prisma')
if (loaded && loaded.profile.backend === 'nestjs') {
  ok('Perfil carregado corretamente')
  info(`Backend: ${loaded.profile.backend}`)
  info(`ORM: ${loaded.profile.orm}`)
  info(`Criado em: ${loaded.createdAt}`)
} else {
  fail('Perfil não carregado corretamente')
}

// Lista todos
const profiles = listProfiles()
ok(`${profiles.length} perfil(is) salvos em ~/.agent/profiles/`)
profiles.forEach((p: any) => info(p.name))

// Remove o perfil de teste
deleteProfile('test-nestjs-prisma')
ok('Perfil de teste removido')

// ── TESTE 4: Comando registrado no CLI ────────────────────────────────────────

separator('TESTE 4 — Comando new no CLI')

try {
  const { execSync } = require('child_process')
  const help = execSync('node -r ts-node/register src/index.ts --help', {
    encoding: 'utf-8', cwd: process.cwd()
  })
  if (help.includes('new')) {
    ok('Comando "new" registrado no CLI')
  } else {
    fail('Comando "new" não encontrado no help')
  }
} catch (e) {
  fail(`Erro ao verificar CLI: ${(e as Error).message}`)
}

separator('COMO USAR')
info('Cria um projeto novo com wizard interativo:')
console.log('')
console.log(chalk.cyan('  npm run dev -- new meu-projeto'))
console.log(chalk.gray('  → Roda o wizard e gera a estrutura'))
console.log('')
console.log(chalk.cyan('  npm run dev -- new meu-projeto --profile nestjs-prisma-ddd'))
console.log(chalk.gray('  → Usa perfil salvo, pula o wizard'))
console.log('')

separator('TODOS OS TESTES CONCLUÍDOS')