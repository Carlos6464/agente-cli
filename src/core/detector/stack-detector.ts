const path = require('path')
import { readFile, listDir } from '../../tools/filesystem.tools'

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'unknown'
export type MonorepoTool   = 'turborepo' | 'nx' | 'lerna' | 'none'
export type Language       = 'typescript' | 'javascript' | 'python' | 'php' | 'ruby' | 'go' | 'unknown'
export type Backend        = 'nestjs' | 'express' | 'fastify' | 'laravel' | 'django' | 'fastapi' | 'rails' | 'none'
export type Frontend       = 'nextjs' | 'react' | 'nuxt' | 'angular' | 'vue' | 'vite' | 'none'
export type Mobile         = 'expo' | 'react-native-cli' | 'flutter' | 'none'
export type ORM            = 'prisma' | 'typeorm' | 'drizzle' | 'mongoose' | 'sequelize' | 'eloquent' | 'activerecord' | 'none'
export type Database       = 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'redis' | 'unknown' | 'none'
export type Architecture   = 'ddd' | 'mvc' | 'modular' | 'simple' | 'unknown'
export type TestFramework  = 'jest' | 'vitest' | 'phpunit' | 'pytest' | 'rspec' | 'none'

export interface StackProfile {
  // Informações do projeto
  projectName: string
  rootDir: string

  // Stack detectada
  language: Language
  packageManager: PackageManager
  monorepo: MonorepoTool
  backend: Backend
  frontend: Frontend
  mobile: Mobile
  orm: ORM
  database: Database
  architecture: Architecture
  testing: TestFramework

  // Apps encontrados no monorepo (ex: ['api', 'web', 'mobile'])
  apps: string[]

  // Campos que o detector não conseguiu determinar sozinho
  // O agent init vai perguntar ao usuário sobre esses
  ambiguities: string[]

  // Exemplos de código encontrados para usar como few-shot no LLM
  // O caminho para um módulo existente que serve de referência
  examplePaths: {
    module?: string
    service?: string
    controller?: string
    entity?: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTADO DA DETECÇÃO
// ─────────────────────────────────────────────────────────────────────────────

export interface DetectionResult {
  success: boolean
  profile?: StackProfile
  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECTOR PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export function detectStack(projectRoot: string = process.cwd()): DetectionResult {
  try {
    const ambiguities: string[] = []

    // ── 1. Lê o package.json ────────────────────────────────────────────────
    // É a fonte principal de informação para projetos Node.js
    // Para outros projetos (Python, PHP), vamos checar outros arquivos

    let packageJson: any = null
    let allDeps: string[] = []

    const pkgResult = readFile(path.join(projectRoot, 'package.json'))
    if (pkgResult.success && pkgResult.content) {
      try {
        packageJson = JSON.parse(pkgResult.content)
        // Junta dependências normais e de dev em um array só para facilitar buscas
        allDeps = [
          ...Object.keys(packageJson.dependencies || {}),
          ...Object.keys(packageJson.devDependencies || {})
        ]
      } catch {
        // package.json malformado — continua sem ele
      }
    }

    // ── 2. Lista a estrutura raiz do projeto ────────────────────────────────
    const rootItems = listDir(projectRoot)
    const rootNames = rootItems.success
      ? rootItems.items!.map(i => i.name)
      : []

    // ── 3. Detecta cada parte da stack ──────────────────────────────────────

    const language       = detectLanguage(projectRoot, rootNames, allDeps)
    const packageManager = detectPackageManager(rootNames, packageJson)
    const monorepo       = detectMonorepo(rootNames, packageJson, allDeps)
    const backend        = detectBackend(allDeps, rootNames, projectRoot, language)
    const frontend       = detectFrontend(allDeps, rootNames)
    const mobile         = detectMobile(allDeps, rootNames)
    const orm            = detectORM(allDeps, rootNames, language)
    const database       = detectDatabase(allDeps, rootNames, projectRoot)
    const testing        = detectTesting(allDeps, rootNames, language)
    const apps           = detectApps(projectRoot, rootNames, monorepo)
    const architecture   = detectArchitecture(projectRoot, rootNames, apps)
    const examplePaths   = findExamplePaths(projectRoot, apps, architecture)

    // ── 4. Registra ambiguidades ────────────────────────────────────────────
    if (architecture === 'unknown') ambiguities.push('architecture')
    if (database === 'unknown') ambiguities.push('database')
    if (language === 'unknown') ambiguities.push('language')

    const profile: StackProfile = {
      projectName: packageJson?.name || path.basename(projectRoot),
      rootDir: projectRoot,
      language,
      packageManager,
      monorepo,
      backend,
      frontend,
      mobile,
      orm,
      database,
      architecture,
      testing,
      apps,
      ambiguities,
      examplePaths
    }

    return { success: true, profile }

  } catch (err) {
    return {
      success: false,
      error: `Erro ao detectar stack: ${(err as Error).message}`
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES DE DETECÇÃO
// Cada função é responsável por detectar uma parte da stack.
// Todas recebem as deps e os arquivos raiz que já foram lidos — sem I/O extra.
// ─────────────────────────────────────────────────────────────────────────────

function detectLanguage(
  projectRoot: string,
  rootNames: string[],
  allDeps: string[]
): Language {
  // TypeScript — tsconfig presente ou typescript nas deps
  if (rootNames.includes('tsconfig.json') || allDeps.includes('typescript')) {
    return 'typescript'
  }
  // Python — arquivos característicos
  if (
    rootNames.includes('requirements.txt') ||
    rootNames.includes('pyproject.toml') ||
    rootNames.includes('setup.py') ||
    rootNames.includes('Pipfile')
  ) {
    return 'python'
  }
  // PHP — composer.json presente
  if (rootNames.includes('composer.json')) {
    return 'php'
  }
  // Ruby — Gemfile presente
  if (rootNames.includes('Gemfile')) {
    return 'ruby'
  }
  // Go — go.mod presente
  if (rootNames.includes('go.mod')) {
    return 'go'
  }
  // JavaScript puro — tem package.json mas não é TypeScript
  if (rootNames.includes('package.json')) {
    return 'javascript'
  }
  return 'unknown'
}

function detectPackageManager(
  rootNames: string[],
  packageJson: any
): PackageManager {
  // Lock files são a forma mais confiável de detectar o package manager
  if (rootNames.includes('pnpm-lock.yaml'))     return 'pnpm'
  if (rootNames.includes('yarn.lock'))           return 'yarn'
  if (rootNames.includes('package-lock.json'))   return 'npm'

  // Alternativa: campo packageManager no package.json (Node.js Corepack)
  if (packageJson?.packageManager) {
    if (packageJson.packageManager.startsWith('pnpm')) return 'pnpm'
    if (packageJson.packageManager.startsWith('yarn')) return 'yarn'
    if (packageJson.packageManager.startsWith('npm'))  return 'npm'
  }

  // Tem package.json mas sem lock file — assume npm como padrão
  if (rootNames.includes('package.json')) return 'npm'

  return 'unknown'
}

function detectMonorepo(
  rootNames: string[],
  packageJson: any,
  allDeps: string[]
): MonorepoTool {
  // Turborepo — turbo.json na raiz ou turbo nas deps
  if (rootNames.includes('turbo.json') || allDeps.includes('turbo')) {
    return 'turborepo'
  }
  // Nx — nx.json na raiz ou @nrwl/workspace / nx nas deps
  if (
    rootNames.includes('nx.json') ||
    allDeps.includes('nx') ||
    allDeps.includes('@nrwl/workspace')
  ) {
    return 'nx'
  }
  // Lerna — lerna.json na raiz
  if (rootNames.includes('lerna.json')) {
    return 'lerna'
  }
  // Workspaces no package.json sem ferramenta dedicada também é monorepo
  // mas vamos tratar como 'none' por enquanto
  return 'none'
}

function detectBackend(
  allDeps: string[],
  rootNames: string[],
  projectRoot: string,
  language: Language
): Backend {
  // Node.js backends
  if (allDeps.includes('@nestjs/core'))   return 'nestjs'
  if (allDeps.includes('fastify'))        return 'fastify'
  if (allDeps.includes('express'))        return 'express'

  // PHP — Laravel
  if (language === 'php') {
    const composerResult = readFile(path.join(projectRoot, 'composer.json'))
    if (composerResult.success && composerResult.content) {
      if (composerResult.content.includes('laravel/framework')) return 'laravel'
    }
  }

  // Python
  if (language === 'python') {
    const reqResult = readFile(path.join(projectRoot, 'requirements.txt'))
    if (reqResult.success && reqResult.content) {
      if (reqResult.content.toLowerCase().includes('django')) return 'django'
      if (reqResult.content.toLowerCase().includes('fastapi')) return 'fastapi'
    }
    const pyprojectResult = readFile(path.join(projectRoot, 'pyproject.toml'))
    if (pyprojectResult.success && pyprojectResult.content) {
      if (pyprojectResult.content.toLowerCase().includes('django')) return 'django'
      if (pyprojectResult.content.toLowerCase().includes('fastapi')) return 'fastapi'
    }
  }

  // Ruby — Rails
  if (language === 'ruby') {
    const gemfileResult = readFile(path.join(projectRoot, 'Gemfile'))
    if (gemfileResult.success && gemfileResult.content) {
      if (gemfileResult.content.includes("gem 'rails'") ||
          gemfileResult.content.includes('gem "rails"')) return 'rails'
    }
  }

  return 'none'
}

function detectFrontend(allDeps: string[], rootNames: string[]): Frontend {
  // A ordem importa — Next.js usa React, então verificamos Next primeiro
  if (allDeps.includes('next'))              return 'nextjs'
  if (allDeps.includes('nuxt'))              return 'nuxt'
  if (allDeps.includes('@angular/core'))     return 'angular'
  if (allDeps.includes('vue'))               return 'vue'
  if (allDeps.includes('vite') && allDeps.includes('react')) return 'vite'
  if (allDeps.includes('react'))             return 'react'
  return 'none'
}

function detectMobile(allDeps: string[], rootNames: string[]): Mobile {
  if (allDeps.includes('expo'))              return 'expo'
  if (allDeps.includes('react-native'))      return 'react-native-cli'
  return 'none'
}

function detectORM(
  allDeps: string[],
  rootNames: string[],
  language: Language
): ORM {
  // Node.js ORMs
  if (allDeps.includes('@prisma/client') || allDeps.includes('prisma')) return 'prisma'
  if (allDeps.includes('typeorm'))           return 'typeorm'
  if (allDeps.includes('drizzle-orm'))       return 'drizzle'
  if (allDeps.includes('mongoose'))          return 'mongoose'
  if (allDeps.includes('sequelize'))         return 'sequelize'

  // PHP — Eloquent vem embutido no Laravel, não aparece nas deps separado
  if (language === 'php')                    return 'eloquent'

  // Ruby — ActiveRecord vem embutido no Rails
  if (language === 'ruby')                   return 'activerecord'

  return 'none'
}

function detectDatabase(
  allDeps: string[],
  rootNames: string[],
  projectRoot: string
): Database {
  // Detecta pelo driver/cliente da linguagem
  if (allDeps.includes('pg') || allDeps.includes('@types/pg')) return 'postgresql'
  if (allDeps.includes('mysql2') || allDeps.includes('mysql'))  return 'mysql'
  if (allDeps.includes('better-sqlite3') || allDeps.includes('sqlite3')) return 'sqlite'
  if (allDeps.includes('mongodb') || allDeps.includes('mongoose')) return 'mongodb'
  if (allDeps.includes('ioredis') || allDeps.includes('redis')) return 'redis'

  // Tenta ler o schema do Prisma para detectar o banco
  const prismaSchema = readFile(path.join(projectRoot, 'prisma', 'schema.prisma'))
  if (prismaSchema.success && prismaSchema.content) {
    const content = prismaSchema.content.toLowerCase()
    if (content.includes('provider = "postgresql"')) return 'postgresql'
    if (content.includes('provider = "mysql"'))      return 'mysql'
    if (content.includes('provider = "sqlite"'))     return 'sqlite'
    if (content.includes('provider = "mongodb"'))    return 'mongodb'
  }

  return 'unknown'
}

function detectTesting(
  allDeps: string[],
  rootNames: string[],
  language: Language
): TestFramework {
  if (allDeps.includes('vitest'))  return 'vitest'
  if (allDeps.includes('jest') || allDeps.includes('@types/jest')) return 'jest'
  if (language === 'php')          return 'phpunit'
  if (language === 'python')       return 'pytest'
  if (language === 'ruby')         return 'rspec'
  return 'none'
}

function detectApps(
  projectRoot: string,
  rootNames: string[],
  monorepo: MonorepoTool
): string[] {
  // Só faz sentido detectar apps em monorepos
  if (monorepo === 'none') return []

  // Convenção mais comum: apps ficam na pasta /apps
  if (rootNames.includes('apps')) {
    const appsDir = listDir(path.join(projectRoot, 'apps'))
    if (appsDir.success && appsDir.items) {
      return appsDir.items
        .filter(i => i.type === 'directory')
        .map(i => i.name)
    }
  }

  // Alternativa: pasta /packages para libs compartilhadas
  // Retorna vazio — apps são detectados só na pasta /apps por enquanto
  return []
}

function detectArchitecture(
  projectRoot: string,
  rootNames: string[],
  apps: string[]
): Architecture {
  // Detecta baseado nos nomes de pastas que são indicadores fortes de padrão

  // Pastas características de DDD + Clean Architecture
  const dddIndicators = ['domain', 'application', 'infra', 'infrastructure', 'use-cases', 'usecases', 'repositories', 'entities']

  // Pastas características de MVC
  const mvcIndicators = ['controllers', 'models', 'views', 'routes']

  // Pastas características de estrutura modular
  const modularIndicators = ['modules', 'features']

  // Verifica na raiz do projeto
  const score = checkArchitectureScore(rootNames, dddIndicators, mvcIndicators, modularIndicators)
  if (score !== 'unknown') return score

  // Se não encontrou na raiz e tem apps, verifica dentro de cada app
  for (const app of apps) {
    const appDir = listDir(path.join(projectRoot, 'apps', app), true)
    if (appDir.success && appDir.items) {
      const appNames = appDir.items.map(i => i.name)
      const appScore = checkArchitectureScore(appNames, dddIndicators, mvcIndicators, modularIndicators)
      if (appScore !== 'unknown') return appScore
    }
  }

  return 'unknown'
}

function checkArchitectureScore(
  names: string[],
  dddIndicators: string[],
  mvcIndicators: string[],
  modularIndicators: string[]
): Architecture {
  const dddScore     = names.filter(n => dddIndicators.includes(n.toLowerCase())).length
  const mvcScore     = names.filter(n => mvcIndicators.includes(n.toLowerCase())).length
  const modularScore = names.filter(n => modularIndicators.includes(n.toLowerCase())).length

  if (dddScore >= 2)     return 'ddd'
  if (mvcScore >= 2)     return 'mvc'
  if (modularScore >= 1) return 'modular'

  return 'unknown'
}

function findExamplePaths(
  projectRoot: string,
  apps: string[],
  architecture: Architecture
): StackProfile['examplePaths'] {
  // Tenta encontrar arquivos reais do projeto para usar como referência no LLM
  // Quanto mais específico o exemplo, melhor o código gerado

  const examples: StackProfile['examplePaths'] = {}

  // Pastas onde módulos costumam ficar
  const searchPaths = apps.length > 0
    ? apps.map(app => path.join(projectRoot, 'apps', app, 'src'))
    : [path.join(projectRoot, 'src')]

  for (const searchPath of searchPaths) {
    const scan = listDir(searchPath, true)
    if (!scan.success || !scan.items) continue

    for (const item of scan.items) {
      if (item.type !== 'file') continue
      const name = item.name.toLowerCase()

      // Procura exemplos de cada tipo de arquivo
      if (!examples.module     && name.endsWith('.module.ts'))     examples.module     = item.path
      if (!examples.service    && name.endsWith('.service.ts'))    examples.service    = item.path
      if (!examples.controller && name.endsWith('.controller.ts')) examples.controller = item.path
      if (!examples.entity     && name.endsWith('.entity.ts'))     examples.entity     = item.path

      // Se já encontrou todos, para de buscar
      if (examples.module && examples.service && examples.controller && examples.entity) break
    }

    if (examples.module && examples.service && examples.controller && examples.entity) break
  }

  return examples
}