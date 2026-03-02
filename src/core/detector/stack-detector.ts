import path from 'path'
import fs from 'fs'
import { listDir, readFile } from '../../tools/filesystem.tools'

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS E INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

export type Architecture = 'mvc' | 'modular' | 'ddd' | 'clean' | 'simple' | 'component-based' | 'none' | 'unknown'

export interface StackProfile {
  projectName: string
  rootDir: string
  language: 'typescript' | 'javascript' | 'python' | 'go' | 'php' | 'dart' | 'unknown'
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'pip' | 'composer' | 'none'
  monorepo: 'turborepo' | 'nx' | 'none'
  backend: 'express' | 'nestjs' | 'fastapi' | 'laravel' | 'fastify' | 'none'
  frontend: 'angular' | 'react' | 'nextjs' | 'vue' | 'nuxtjs' | 'none'
  mobile: 'react-native' | 'expo' | 'ionic' | 'flutter' | 'none'
  orm: 'prisma' | 'typeorm' | 'sequelize' | 'eloquent' | 'drizzle' | 'sqlalchemy' | 'none'
  database: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite' | 'none' | 'unknown'
  architecture: Architecture
  testing: 'jest' | 'mocha' | 'pytest' | 'vitest' | 'cypress' | 'playwright' | 'none'
  apps: string[]
  ambiguities: string[]
  examplePaths: {
    [key: string]: string
  }
  architecturalSummary?: string
}

export interface DetectionResult {
  success: boolean
  profile?: StackProfile
  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export function detectStack(projectRoot: string): DetectionResult {
  try {
    const rootDir = listDir(projectRoot)
    if (!rootDir.success || !rootDir.items) {
      return { success: false, error: 'Não foi possível ler o diretório raiz.' }
    }

    const names = rootDir.items.map(i => i.name)
    const workspaces = detectWorkspaces(projectRoot, names)
    const allDeps = aggregateAllDependencies(projectRoot, workspaces)

    const profile: StackProfile = {
      projectName: path.basename(projectRoot),
      rootDir: projectRoot,
      language: detectLanguage(names, allDeps),
      packageManager: detectPackageManager(names),
      monorepo: detectMonorepo(names),
      backend: detectBackend(names, projectRoot, allDeps, workspaces),
      frontend: detectFrontend(names, allDeps),
      mobile: detectMobile(allDeps),
      orm: detectORM(names, projectRoot, allDeps),
      database: detectDatabase(names, projectRoot, allDeps),
      architecture: detectArchitecture(projectRoot, names, workspaces),
      testing: detectTesting(names, projectRoot, allDeps),
      apps: workspaces,
      ambiguities: [],
      examplePaths: findExamplePaths(projectRoot, workspaces)
    }

    return { success: true, profile }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES AUXILIARES DE DETECÇÃO BÁSICA
// ─────────────────────────────────────────────────────────────────────────────

function detectWorkspaces(projectRoot: string, names: string[]): string[] {
  const workspaces: string[] = []
  const dirsToScan = ['apps', 'packages', 'libs']
  
  for (const dir of dirsToScan) {
    if (names.includes(dir)) {
      const scan = listDir(path.join(projectRoot, dir))
      if (scan.success && scan.items) {
        workspaces.push(...scan.items.filter(i => i.type === 'directory').map(i => path.join(dir, i.name)))
      }
    }
  }
  return workspaces
}

function aggregateAllDependencies(projectRoot: string, workspaces: string[]): string[] {
  const deps = new Set<string>()
  
  const tryReadPkg = (dir: string) => {
    const pkgPath = path.join(dir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        if (pkg.dependencies) Object.keys(pkg.dependencies).forEach(d => deps.add(d))
        if (pkg.devDependencies) Object.keys(pkg.devDependencies).forEach(d => deps.add(d))
      } catch (e) {}
    }
  }

  tryReadPkg(projectRoot)
  for (const ws of workspaces) {
    tryReadPkg(path.join(projectRoot, ws))
  }

  return Array.from(deps)
}

function detectLanguage(names: string[], allDeps: string[]): StackProfile['language'] {
  if (names.includes('tsconfig.json') || names.includes('tsconfig.base.json') || allDeps.includes('typescript')) return 'typescript'
  if (names.includes('pubspec.yaml')) return 'dart'
  if (names.includes('package.json')) return 'javascript'
  if (names.includes('requirements.txt') || names.includes('pyproject.toml') || names.includes('main.py')) return 'python'
  if (names.includes('composer.json')) return 'php'
  if (names.includes('go.mod')) return 'go'
  return 'unknown'
}

function detectPackageManager(names: string[]): StackProfile['packageManager'] {
  if (names.includes('pnpm-lock.yaml') || names.includes('pnpm-workspace.yaml')) return 'pnpm'
  if (names.includes('yarn.lock')) return 'yarn'
  if (names.includes('package-lock.json')) return 'npm'
  if (names.includes('composer.lock')) return 'composer'
  if (names.includes('requirements.txt')) return 'pip'
  return 'none'
}

function detectMonorepo(names: string[]): StackProfile['monorepo'] {
  if (names.includes('turbo.json')) return 'turborepo'
  if (names.includes('nx.json')) return 'nx'
  return 'none'
}

function detectBackend(names: string[], projectRoot: string, allDeps: string[], workspaces: string[]): StackProfile['backend'] {
  if (allDeps.includes('@nestjs/core') || names.includes('nest-cli.json')) return 'nestjs'
  if (names.includes('artisan')) return 'laravel'

  if (names.includes('requirements.txt')) {
    const req = readFile(path.join(projectRoot, 'requirements.txt'))
    if (req.success && req.content && req.content.toLowerCase().includes('fastapi')) return 'fastapi'
    return 'none'
  }

  if (allDeps.includes('fastify')) return 'fastify'
  if (allDeps.includes('express')) return 'express'
  
  for (const ws of workspaces) {
    if (fs.existsSync(path.join(projectRoot, ws, 'nest-cli.json'))) return 'nestjs'
  }

  return 'none'
}

function detectFrontend(names: string[], allDeps: string[]): StackProfile['frontend'] {
  if (allDeps.includes('next') || names.includes('next.config.js') || names.includes('next.config.mjs') || names.includes('next.config.ts')) return 'nextjs'
  if (allDeps.includes('nuxt') || names.includes('nuxt.config.js') || names.includes('nuxt.config.ts')) return 'nuxtjs'
  if (allDeps.includes('@angular/core') || names.includes('angular.json')) return 'angular'
  if (allDeps.includes('vue')) return 'vue'
  if (allDeps.includes('react') || allDeps.includes('react-dom')) return 'react'
  return 'none'
}

function detectMobile(allDeps: string[]): StackProfile['mobile'] {
  if (allDeps.includes('expo')) return 'expo'
  if (allDeps.includes('react-native')) return 'react-native'
  if (allDeps.includes('@ionic/react') || allDeps.includes('@ionic/angular') || allDeps.includes('@ionic/vue')) return 'ionic'
  return 'none'
}

function detectORM(names: string[], projectRoot: string, allDeps: string[]): StackProfile['orm'] {
  if (allDeps.includes('drizzle-orm') || names.includes('drizzle.config.ts')) return 'drizzle'
  if (allDeps.includes('@prisma/client') || names.includes('prisma')) return 'prisma'
  if (allDeps.includes('typeorm')) return 'typeorm'
  
  if (names.includes('requirements.txt')) {
    const req = readFile(path.join(projectRoot, 'requirements.txt'))
    if (req.success && req.content && req.content.toLowerCase().includes('sqlalchemy')) return 'sqlalchemy'
  }

  return 'none'
}

function detectDatabase(names: string[], projectRoot: string, allDeps: string[]): StackProfile['database'] {
  if (allDeps.includes('pg') || allDeps.includes('postgres') || allDeps.includes('@types/pg')) return 'postgresql'
  if (allDeps.includes('mysql') || allDeps.includes('mysql2')) return 'mysql'
  if (allDeps.includes('mongoose') || allDeps.includes('mongodb')) return 'mongodb'
  if (allDeps.includes('sqlite3') || allDeps.includes('better-sqlite3')) return 'sqlite'

  if (names.includes('prisma')) {
    const schemaPath = path.join(projectRoot, 'prisma', 'schema.prisma')
    const schema = readFile(schemaPath)
    if (schema.success && schema.content) {
      if (schema.content.includes('provider = "postgresql"')) return 'postgresql'
      if (schema.content.includes('provider = "mysql"')) return 'mysql'
      if (schema.content.includes('provider = "mongodb"')) return 'mongodb'
      if (schema.content.includes('provider = "sqlite"')) return 'sqlite'
    }
  }

  if (names.includes('requirements.txt')) {
    const req = readFile(path.join(projectRoot, 'requirements.txt'))
    if (req.success && req.content) {
      const content = req.content.toLowerCase()
      if (content.includes('psycopg2') || content.includes('asyncpg')) return 'postgresql'
      if (content.includes('pymysql')) return 'mysql'
      if (content.includes('motor') || content.includes('pymongo')) return 'mongodb'
    }
  }

  const composeFile = names.includes('docker-compose.yml') ? 'docker-compose.yml' : 
                      names.includes('docker-compose.yaml') ? 'docker-compose.yaml' : null;
  if (composeFile) {
    const compose = readFile(path.join(projectRoot, composeFile))
    if (compose.success && compose.content) {
      const content = compose.content.toLowerCase()
      if (content.includes('image: postgres') || content.includes('postgres:')) return 'postgresql'
      if (content.includes('image: mysql') || content.includes('mysql:')) return 'mysql'
      if (content.includes('image: mongo') || content.includes('mongo:')) return 'mongodb'
    }
  }

  return 'unknown' 
}

function detectTesting(names: string[], projectRoot: string, allDeps: string[]): StackProfile['testing'] {
  if (allDeps.includes('cypress')) return 'cypress'
  if (allDeps.includes('@playwright/test')) return 'playwright'
  if (allDeps.includes('jest') || names.includes('jest.config.ts') || names.includes('jest.config.js')) return 'jest'
  if (allDeps.includes('vitest') || names.includes('vitest.config.ts')) return 'vitest'
  if (names.includes('pytest.ini') || names.includes('conftest.py')) return 'pytest'
  
  if (names.includes('requirements.txt')) {
    const req = readFile(path.join(projectRoot, 'requirements.txt'))
    if (req.success && req.content && req.content.toLowerCase().includes('pytest')) return 'pytest'
  }

  return 'none'
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECÇÃO DE ARQUITETURA INTELIGENTE
// ─────────────────────────────────────────────────────────────────────────────

function detectArchitecture(projectRoot: string, rootNames: string[], workspaces: string[]): Architecture {
  const foldersToAnalyze: string[] = [...rootNames]
  
  const baseDirs = ['src', 'app', 'lib']
  for (const dir of baseDirs) {
    if (rootNames.includes(dir)) {
      const scanDir = listDir(path.join(projectRoot, dir))
      if (scanDir.success && scanDir.items) {
        foldersToAnalyze.push(...scanDir.items.filter(i => i.type === 'directory').map(i => i.name.toLowerCase()))
      }
    }
  }

  foldersToAnalyze.push(...workspaces.map(ws => path.basename(ws).toLowerCase()))

  // Removido o 'core' propositalmente para não causar falsos positivos de DDD no FastAPI
  if (foldersToAnalyze.some(f => ['domain', 'application', 'infrastructure', 'use-cases'].includes(f))) return 'ddd'
  if (foldersToAnalyze.some(f => ['modules', 'features'].includes(f))) return 'modular'
  if (foldersToAnalyze.some(f => ['controllers', 'routes', 'api', 'routers', 'repositories'].includes(f))) return 'mvc'
  if (foldersToAnalyze.some(f => ['components', 'pages', 'screens', 'hooks', 'store', 'contexts', 'layouts'].includes(f))) return 'component-based'

  return 'simple'
}

// ─────────────────────────────────────────────────────────────────────────────
// BUSCA FUZZY
// ─────────────────────────────────────────────────────────────────────────────

function findExamplePaths(projectRoot: string, workspaces: string[]): StackProfile['examplePaths'] {
  const examples: StackProfile['examplePaths'] = {}
  
  const searchDirs = workspaces.length > 0 
    ? workspaces.map(ws => {
        const wsSrc = path.join(projectRoot, ws, 'src')
        return fs.existsSync(wsSrc) ? wsSrc : path.join(projectRoot, ws)
      })
    : [path.join(projectRoot, 'src'), path.join(projectRoot, 'app'), path.join(projectRoot, 'lib'), projectRoot]

  const patterns = [
    // Backend
    { key: 'controller', file: /(controller|router)\.(ts|js|py|php)$/i,           path: /\/(controllers?|routers?)\/.*\.(ts|js|py|php)$/i },
    { key: 'service',    file: /service\.(ts|js|py|php)$/i,                       path: /\/(services?)\/.*\.(ts|js|py|php)$/i },
    { key: 'use-case',   file: /use-?case\.(ts|js|py|php)$/i,                     path: /\/(use-?cases?)\/.*\.(ts|js|py|php)$/i },
    { key: 'port',       file: /ports?\.(ts|js|py|php)$/i,                        path: /\/(ports?)\/.*\.(ts|js|py|php)$/i },
    { key: 'model',      file: /model\.(ts|js|py|php)$/i,                         path: /\/(models?)\/.*\.(ts|js|py|php)$/i },
    { key: 'errors',     file: /errors?\.(ts|js|py|php)$/i,                        path: /\/(errors?)\/.*\.(ts|js|py|php)$/i },
    { key: 'strategies', file: /strategies?\.(ts|js|py|php)$/i,                    path: /\/(strategies?)\/.*\.(ts|js|py|php)$/i },
    { key: 'entity',     file: /(entity|usuario|postagem|papel)\.(ts|js|py|php)$/i,path: /\/(entities)\/.*\.(ts|js|py|php)$/i },
    { key: 'repository', file: /repository\.(ts|js|py|php)$/i,                    path: /\/(repositories)\/.*\.(ts|js|py|php)$/i },
    { key: 'schema',     file: /schema\.(ts|js|py|php)$/i,                        path: /\/(schemas?)\/.*\.(ts|js|py|php)$/i },
    { key: 'vo',         file: /(vo|value-?object)\.(ts|js|py|php)$/i,            path: /\/(vos?|value-?objects?)\/.*\.(ts|js|py|php)$/i },
    { key: 'route',      file: /route[s]?\.(ts|js|py|php)$/i,                     path: /\/(routes?)\/.*\.(ts|js|py|php)$/i },
    { key: 'middleware', file: /middleware\.(ts|js|py|php)$/i,                    path: /\/(middlewares?)\/.*\.(ts|js|py|php)$/i },
    { key: 'module',     file: /module\.(ts|js|py|php)$/i,                        path: /\/(modules?)\/.*\.(ts|js|py|php)$/i },
    
    // Frontend / Mobile
    { key: 'component',  file: /component\.(ts|tsx|js|jsx|vue|dart)$/i,           path: /\/(components?|widgets?)\/.*\.(ts|tsx|js|jsx|vue|dart)$/i },
    { key: 'page',       file: /(page|screen|view)\.(ts|tsx|js|jsx|vue|dart)$/i,  path: /\/(pages?|screens?|views?|app)\/.*\.(ts|tsx|js|jsx|vue|dart)$/i },
    { key: 'layout',     file: /layout\.(ts|tsx|js|jsx|vue|dart)$/i,              path: /\/(layouts?)\/.*\.(ts|tsx|js|jsx|vue|dart)$/i },
    { key: 'hook',       file: /^use[A-Z].*\.(ts|tsx|js|jsx)$/,                   path: /\/(hooks?)\/.*\.(ts|tsx|js|jsx)$/i },
    { key: 'store',      file: /(store|slice|context|state)\.(ts|tsx|js|jsx)$/i,  path: /\/(stores?|slices?|contexts?|states?)\/.*\.(ts|tsx|js|jsx)$/i },
    { key: 'template',   file: /\.html$/i,                                        path: null }
  ]

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue
    
    const scan = listDir(dir, true) 
    if (!scan.success || !scan.items) continue

    for (const item of scan.items) {
      if (item.type !== 'file') continue
      
      const fileName = item.name
      
      // Ignora arquivos de teste
      if (fileName.includes('.test.') || fileName.includes('.spec.') || fileName.startsWith('test_')) continue
      
      // Filtra estritamente por extensões de código aceitas
      if (!/\.(ts|tsx|js|jsx|py|go|php|vue|dart|html)$/.test(fileName)) continue
      
      // TRAVA DE SEGURANÇA: Ignora explicitamente os arquivos de "barril" (exportação) e de inicialização vazios
      // Permite index.tsx/jsx porque no React/Next/Expo eles são frequentemente componentes de tela reais
      if (/^(__init__\.py|index\.(ts|js))$/.test(fileName)) continue

      const unixPath = item.path.replace(/\\/g, '/')

      for (const p of patterns) {
        if (!examples[p.key]) {
          if (p.file.test(fileName) || (p.path && p.path.test(unixPath))) {
            examples[p.key] = path.relative(projectRoot, item.path)
          }
        }
      }
    }
  }

  return examples
}