const path = require('path')
import { readFile, listDir } from '../../tools/filesystem.tools'

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown'
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
  projectName: string
  rootDir: string
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
  apps: string[] // Contém a lista de todas as apps/* e libs/*
  ambiguities: string[]
  examplePaths: {
    module?: string
    service?: string
    controller?: string
    entity?: string
    repository?: string
    'use-case'?: string
    schema?: string
    vo?: string
    strategy?: string
    dto?: string
    [key: string]: string | undefined
  }
}

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
    
    const rootItems = listDir(projectRoot)
    const rootNames = rootItems.success ? rootItems.items!.map(i => i.name) : []

    // ── 1. Detectar Workspaces Reais (apps, libs, packages) ────────────────
    const workspaces = detectWorkspaces(projectRoot, rootNames)

    // ── 2. Agregar TODAS as dependências do Monorepo ───────────────────────
    let allDeps: string[] = []
    let packageJson: any = null

    // Lendo o package.json da raiz
    const rootPkgResult = readFile(path.join(projectRoot, 'package.json'))
    if (rootPkgResult.success && rootPkgResult.content) {
      try {
        packageJson = JSON.parse(rootPkgResult.content)
        allDeps.push(...Object.keys(packageJson.dependencies || {}))
        allDeps.push(...Object.keys(packageJson.devDependencies || {}))
      } catch {}
    }

    // Lendo os package.json dos workspaces (libs, apps, etc)
    for (const ws of workspaces) {
      const wsPkgResult = readFile(path.join(projectRoot, ws, 'package.json'))
      if (wsPkgResult.success && wsPkgResult.content) {
        try {
          const wsPkg = JSON.parse(wsPkgResult.content)
          allDeps.push(...Object.keys(wsPkg.dependencies || {}))
          allDeps.push(...Object.keys(wsPkg.devDependencies || {}))
        } catch {}
      }
    }

    allDeps = [...new Set(allDeps)] // Remove dependências duplicadas

    // ── 3. Detecta cada parte da stack baseada na visão global ─────────────
    const language       = detectLanguage(projectRoot, rootNames, allDeps)
    const packageManager = detectPackageManager(rootNames, packageJson)
    const monorepo       = detectMonorepo(rootNames, packageJson, allDeps)
    const backend        = detectBackend(allDeps, projectRoot, language)
    const frontend       = detectFrontend(allDeps)
    const mobile         = detectMobile(allDeps)
    const orm            = detectORM(allDeps, language)
    const database       = detectDatabase(allDeps, projectRoot, workspaces)
    const testing        = detectTesting(allDeps, language)
    const architecture   = detectArchitecture(projectRoot, rootNames, workspaces)
    const examplePaths   = findExamplePaths(projectRoot, workspaces)

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
      apps: workspaces, // Repassa todos os pacotes encontrados para a IA ver
      ambiguities,
      examplePaths
    }

    return { success: true, profile }

  } catch (err) {
    return { success: false, error: `Erro ao detectar stack: ${(err as Error).message}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES DE DETECÇÃO AUXILIARES
// ─────────────────────────────────────────────────────────────────────────────

function detectWorkspaces(projectRoot: string, rootNames: string[]): string[] {
  const workspaces: string[] = []
  const searchDirs = ['apps', 'libs', 'packages', 'services']

  for (const dir of searchDirs) {
    if (rootNames.includes(dir)) {
      const items = listDir(path.join(projectRoot, dir))
      if (items.success && items.items) {
        for (const item of items.items) {
          if (item.type === 'directory') workspaces.push(`${dir}/${item.name}`)
        }
      }
    }
  }
  return workspaces
}

function detectLanguage(projectRoot: string, rootNames: string[], allDeps: string[]): Language {
  if (rootNames.includes('tsconfig.json') || allDeps.includes('typescript')) return 'typescript'
  if (rootNames.includes('requirements.txt') || rootNames.includes('pyproject.toml')) return 'python'
  if (rootNames.includes('composer.json')) return 'php'
  if (rootNames.includes('Gemfile')) return 'ruby'
  if (rootNames.includes('go.mod')) return 'go'
  if (rootNames.includes('package.json')) return 'javascript'
  return 'unknown'
}

function detectPackageManager(rootNames: string[], packageJson: any): PackageManager {
  if (rootNames.includes('pnpm-lock.yaml') || rootNames.includes('pnpm-workspace.yaml')) return 'pnpm'
  if (rootNames.includes('yarn.lock')) return 'yarn'
  if (rootNames.includes('bun.lockb')) return 'bun'
  if (rootNames.includes('package-lock.json')) return 'npm'
  if (packageJson?.packageManager) {
    if (packageJson.packageManager.startsWith('pnpm')) return 'pnpm'
    if (packageJson.packageManager.startsWith('yarn')) return 'yarn'
    if (packageJson.packageManager.startsWith('npm')) return 'npm'
  }
  if (rootNames.includes('package.json')) return 'npm'
  return 'unknown'
}

function detectMonorepo(rootNames: string[], packageJson: any, allDeps: string[]): MonorepoTool {
  if (rootNames.includes('turbo.json') || allDeps.includes('turbo')) return 'turborepo'
  if (rootNames.includes('nx.json') || allDeps.includes('nx') || allDeps.includes('@nrwl/workspace')) return 'nx'
  if (rootNames.includes('lerna.json')) return 'lerna'
  return 'none'
}

function detectBackend(allDeps: string[], projectRoot: string, language: Language): Backend {
  if (allDeps.includes('@nestjs/core')) return 'nestjs'
  if (allDeps.includes('fastify')) return 'fastify'
  if (allDeps.includes('express')) return 'express'
  if (language === 'php') {
    const composerResult = readFile(path.join(projectRoot, 'composer.json'))
    if (composerResult.success && composerResult.content?.includes('laravel/framework')) return 'laravel'
  }
  if (language === 'python') {
    const reqResult = readFile(path.join(projectRoot, 'requirements.txt'))
    if (reqResult.success && reqResult.content) {
      if (reqResult.content.toLowerCase().includes('django')) return 'django'
      if (reqResult.content.toLowerCase().includes('fastapi')) return 'fastapi'
    }
  }
  return 'none'
}

function detectFrontend(allDeps: string[]): Frontend {
  if (allDeps.includes('next')) return 'nextjs'
  if (allDeps.includes('nuxt')) return 'nuxt'
  if (allDeps.includes('@angular/core')) return 'angular'
  if (allDeps.includes('vue')) return 'vue'
  if (allDeps.includes('vite') && allDeps.includes('react')) return 'vite'
  if (allDeps.includes('react')) return 'react'
  return 'none'
}

function detectMobile(allDeps: string[]): Mobile {
  if (allDeps.includes('expo')) return 'expo'
  if (allDeps.includes('react-native')) return 'react-native-cli'
  return 'none'
}

function detectORM(allDeps: string[], language: Language): ORM {
  if (allDeps.includes('@prisma/client') || allDeps.includes('prisma')) return 'prisma'
  if (allDeps.includes('typeorm')) return 'typeorm'
  if (allDeps.includes('drizzle-orm')) return 'drizzle'
  if (allDeps.includes('mongoose')) return 'mongoose'
  if (allDeps.includes('sequelize')) return 'sequelize'
  if (language === 'php') return 'eloquent'
  if (language === 'ruby') return 'activerecord'
  return 'none'
}

function detectDatabase(allDeps: string[], projectRoot: string, workspaces: string[]): Database {
  if (allDeps.includes('pg') || allDeps.includes('@types/pg') || allDeps.includes('postgres')) return 'postgresql'
  if (allDeps.includes('mysql2') || allDeps.includes('mysql')) return 'mysql'
  if (allDeps.includes('better-sqlite3') || allDeps.includes('sqlite3')) return 'sqlite'
  if (allDeps.includes('mongodb') || allDeps.includes('mongoose')) return 'mongodb'
  if (allDeps.includes('ioredis') || allDeps.includes('redis')) return 'redis'

  // Busca esquemas de banco (Prisma/Drizzle) em toda a arvore do monorepo
  const searchDirs = [projectRoot, ...workspaces.map(ws => path.join(projectRoot, ws))]
  for (const dir of searchDirs) {
    const prisma = readFile(path.join(dir, 'prisma', 'schema.prisma'))
    if (prisma.success && prisma.content) {
      const content = prisma.content.toLowerCase()
      if (content.includes('provider = "postgresql"')) return 'postgresql'
      if (content.includes('provider = "mysql"')) return 'mysql'
      if (content.includes('provider = "sqlite"')) return 'sqlite'
      if (content.includes('provider = "mongodb"')) return 'mongodb'
    }
  }
  return 'unknown'
}

function detectTesting(allDeps: string[], language: Language): TestFramework {
  if (allDeps.includes('vitest')) return 'vitest'
  if (allDeps.includes('jest') || allDeps.includes('@types/jest')) return 'jest'
  if (language === 'php') return 'phpunit'
  if (language === 'python') return 'pytest'
  if (language === 'ruby') return 'rspec'
  return 'none'
}

function detectArchitecture(projectRoot: string, rootNames: string[], workspaces: string[]): Architecture {
  const dddIndicators = ['domain', 'application', 'infra', 'infrastructure', 'use-cases', 'repositories', 'entities']
  const mvcIndicators = ['controllers', 'models', 'views', 'routes']
  const modularIndicators = ['modules', 'features']

  // Checa na raiz
  let score = checkArchitectureScore(rootNames, dddIndicators, mvcIndicators, modularIndicators)
  if (score !== 'unknown') return score

  // Checa os nomes dos workspaces (Ex: libs/domain, libs/infrastructure = DDD)
  const workspaceNames = workspaces.map(w => w.split('/')[1])
  score = checkArchitectureScore(workspaceNames, dddIndicators, mvcIndicators, modularIndicators)
  if (score !== 'unknown') return score

  // Entra nos diretórios para checar
  for (const ws of workspaces) {
    const wsDir = listDir(path.join(projectRoot, ws), true)
    if (wsDir.success && wsDir.items) {
      const names = wsDir.items.map(i => i.name)
      const s = checkArchitectureScore(names, dddIndicators, mvcIndicators, modularIndicators)
      if (s !== 'unknown') return s
    }
  }
  return 'unknown'
}

function checkArchitectureScore(names: string[], ddd: string[], mvc: string[], mod: string[]): Architecture {
  const dddScore = names.filter(n => ddd.includes(n.toLowerCase())).length
  const mvcScore = names.filter(n => mvc.includes(n.toLowerCase())).length
  const modScore = names.filter(n => mod.includes(n.toLowerCase())).length

  if (dddScore >= 2) return 'ddd'
  if (mvcScore >= 2) return 'mvc'
  if (modScore >= 1) return 'modular'
  return 'unknown'
}

function findExamplePaths(projectRoot: string, workspaces: string[]): StackProfile['examplePaths'] {
  const examples: StackProfile['examplePaths'] = {}
  
  // Procura arquivos de exemplo na raiz e em todos os workspaces detectados
  const searchPaths = workspaces.length > 0
    ? workspaces.map(ws => path.join(projectRoot, ws, 'src'))
    : [path.join(projectRoot, 'src')]

  // Padrões de arquivos cruciais em arquiteturas avançadas (como a sua)
  const targets = [
    'module', 'service', 'controller', 'entity', 
    'repository', 'use-case', 'schema', 'vo', 'strategy', 'dto'
  ]

  for (const searchPath of searchPaths) {
    const scan = listDir(searchPath, true)
    if (!scan.success || !scan.items) continue

    for (const item of scan.items) {
      if (item.type !== 'file') continue
      const name = item.name.toLowerCase()

      // Associa o arquivo ao tipo se tiver o sufixo correto
      for (const target of targets) {
        if (!examples[target] && name.includes(`.${target}.ts`)) {
          examples[target] = item.path
        }
      }
    }
  }
  return examples
}