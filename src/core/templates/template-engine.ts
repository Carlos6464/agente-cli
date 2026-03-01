const fs   = require('fs')
const path = require('path')
import { StackProfile } from '../detector/stack-detector'

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE ENGINE
//
// Gera a estrutura de pastas e arquivos base de um projeto novo.
// Cada combinação de stack tem um conjunto de arquivos iniciais.
//
// Os templates são strings TypeScript — sem arquivos externos,
// sem dependência de rede. Tudo embutido no binário.
// ─────────────────────────────────────────────────────────────────────────────

export interface GeneratedFile {
  path:    string
  content: string
}

export interface TemplateResult {
  success: boolean
  files:   GeneratedFile[]
  error?:  string
}

// ─────────────────────────────────────────────────────────────────────────────
// GERA OS ARQUIVOS PARA UM PROJETO NOVO
// ─────────────────────────────────────────────────────────────────────────────

export function generateProjectFiles(
  profile:     StackProfile,
  projectRoot: string
): TemplateResult {
  try {
    const files: GeneratedFile[] = []

    // Arquivos comuns a todos os projetos Node.js
    if (profile.language === 'typescript' || profile.language === 'javascript') {
      files.push(...generateNodeBase(profile))
    }

    // Arquivos específicos por backend
    if (profile.backend === 'nestjs') {
      files.push(...generateNestJS(profile))
    } else if (profile.backend === 'express') {
      files.push(...generateExpress(profile))
    } else if (profile.backend === 'fastify') {
      files.push(...generateFastify(profile))
    }

    // ORM
    if (profile.orm === 'prisma') {
      files.push(...generatePrisma(profile))
    }

    // Arquivos de ambiente
    files.push(...generateEnvFiles(profile))

    // README
    files.push(generateReadme(profile))

    // .gitignore
    files.push(generateGitignore(profile))

    return { success: true, files }

  } catch (err) {
    return { success: false, files: [], error: (err as Error).message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ESCREVE OS ARQUIVOS NO DISCO
// ─────────────────────────────────────────────────────────────────────────────

export function writeProjectFiles(
  files:       GeneratedFile[],
  projectRoot: string
): { written: string[]; errors: string[] } {
  const written: string[] = []
  const errors:  string[] = []

  for (const file of files) {
    try {
      const fullPath = path.join(projectRoot, file.path)
      const dir      = path.dirname(fullPath)

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(fullPath, file.content, 'utf-8')
      written.push(file.path)
    } catch (err) {
      errors.push(`${file.path}: ${(err as Error).message}`)
    }
  }

  return { written, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

function generateNodeBase(profile: StackProfile): GeneratedFile[] {
  const isTS  = profile.language === 'typescript'
  const name  = profile.projectName

  const packageJson = {
    name,
    version: '0.1.0',
    private: true,
    scripts: {
      build:  isTS ? 'tsc' : 'echo "No build step"',
      start:  isTS ? 'node dist/main.js' : 'node src/index.js',
      dev:    isTS ? 'ts-node src/main.ts' : 'node src/index.js',
      test:   profile.testing === 'jest' ? 'jest' : profile.testing === 'vitest' ? 'vitest' : 'echo "No tests"',
      lint:   'eslint . --ext .ts,.js',
    },
    dependencies:    {} as Record<string, string>,
    devDependencies: {} as Record<string, string>
  }

  const files: GeneratedFile[] = [
    { path: 'package.json', content: JSON.stringify(packageJson, null, 2) }
  ]

  if (isTS) {
    const tsconfig = {
      compilerOptions: {
        target:         'ES2020',
        module:         'commonjs',
        lib:            ['ES2020'],
        outDir:         './dist',
        rootDir:        './src',
        strict:         true,
        esModuleInterop: true,
        skipLibCheck:   true,
        forceConsistentCasingInFileNames: true,
        experimentalDecorators: profile.backend === 'nestjs',
        emitDecoratorMetadata:  profile.backend === 'nestjs',
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist']
    }
    files.push({ path: 'tsconfig.json', content: JSON.stringify(tsconfig, null, 2) })
  }

  return files
}

function generateNestJS(profile: StackProfile): GeneratedFile[] {
  const name = profile.projectName

  const appModule = `import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'

@Module({
  imports:     [],
  controllers: [AppController],
  providers:   [AppService],
})
export class AppModule {}
`

  const appController = `import { Controller, Get } from '@nestjs/common'
import { AppService } from './app.service'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello()
  }
}
`

  const appService = `import { Injectable } from '@nestjs/common'

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!'
  }
}
`

  const main = `import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ValidationPipe } from '@nestjs/common'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.enableCors()

  const port = process.env.PORT || 3000
  await app.listen(port)
  console.log(\`Application running on http://localhost:\${port}\`)
}

bootstrap()
`

  const files: GeneratedFile[] = [
    { path: 'src/app.module.ts',     content: appModule     },
    { path: 'src/app.controller.ts', content: appController },
    { path: 'src/app.service.ts',    content: appService    },
    { path: 'src/main.ts',           content: main          },
  ]

  // Estrutura por arquitetura
  if (profile.architecture === 'modular') {
    files.push({
      path:    'src/modules/.gitkeep',
      content: ''
    })
  }

  if (profile.architecture === 'ddd') {
    files.push(
      { path: 'src/domain/.gitkeep',          content: '' },
      { path: 'src/application/.gitkeep',     content: '' },
      { path: 'src/infra/.gitkeep',           content: '' },
    )
  }

  return files
}

function generateExpress(profile: StackProfile): GeneratedFile[] {
  const main = `import express from 'express'
import cors from 'cors'

const app  = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'Hello World!' })
})

app.listen(port, () => {
  console.log(\`Server running on http://localhost:\${port}\`)
})

export default app
`

  return [
    { path: 'src/main.ts',          content: main },
    { path: 'src/routes/.gitkeep',  content: ''   },
    { path: 'src/middlewares/.gitkeep', content: '' },
  ]
}

function generateFastify(profile: StackProfile): GeneratedFile[] {
  const main = `import Fastify from 'fastify'

const fastify = Fastify({ logger: true })
const port    = Number(process.env.PORT) || 3000

fastify.get('/', async () => {
  return { message: 'Hello World!' }
})

const start = async () => {
  try {
    await fastify.listen({ port, host: '0.0.0.0' })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
`

  return [
    { path: 'src/main.ts',         content: main },
    { path: 'src/routes/.gitkeep', content: ''   },
    { path: 'src/plugins/.gitkeep', content: ''  },
  ]
}

function generatePrisma(profile: StackProfile): GeneratedFile[] {
  const providerMap: Record<string, string> = {
    postgresql: 'postgresql',
    mysql:      'mysql',
    sqlite:     'sqlite',
    mongodb:    'mongodb',
  }

  const provider = providerMap[profile.database] || 'postgresql'

  const urlMap: Record<string, string> = {
    postgresql: 'postgresql://user:password@localhost:5432/mydb?schema=public',
    mysql:      'mysql://user:password@localhost:3306/mydb',
    sqlite:     'file:./dev.db',
    mongodb:    'mongodb://localhost:27017/mydb',
  }

  const schema = `// This is your Prisma schema file
// Learn more: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
  url      = env("DATABASE_URL")
}

// Exemplo de model — substitua pelo seu domínio
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`

  const dbUrl = urlMap[profile.database] || urlMap.postgresql

  return [
    { path: 'prisma/schema.prisma', content: schema },
    { path: '.env.example', content: `DATABASE_URL="${dbUrl}"\n` },
  ]
}

function generateEnvFiles(profile: StackProfile): GeneratedFile[] {
  const lines: string[] = [
    '# Ambiente',
    'NODE_ENV=development',
    'PORT=3000',
    '',
  ]

  if (profile.database !== 'none' && profile.orm !== 'prisma') {
    lines.push('# Banco de dados')
    lines.push('DATABASE_URL=')
    lines.push('')
  }

  lines.push('# JWT (se usar autenticação)')
  lines.push('JWT_SECRET=')

  const content = lines.join('\n') + '\n'

  return [
    { path: '.env.example', content },
  ]
}

function generateReadme(profile: StackProfile): GeneratedFile {
  const { projectName: name, language, backend, frontend, orm, database, packageManager: pkgMgr } = profile

  const stack = [
    language,
    backend  !== 'none' ? backend  : '',
    frontend !== 'none' ? frontend : '',
    orm      !== 'none' ? orm      : '',
    database !== 'none' && database !== 'unknown' ? database : '',
  ].filter(Boolean).join(' + ')

  const content = `# ${name}

> Stack: ${stack}

## Setup

\`\`\`bash
${pkgMgr} install
cp .env.example .env
# configure o .env com suas credenciais
${pkgMgr} run dev
\`\`\`

## Scripts

| Comando | Descrição |
|---|---|
| \`${pkgMgr} run dev\`   | Inicia em modo desenvolvimento |
| \`${pkgMgr} run build\` | Compila para produção |
| \`${pkgMgr} test\`      | Roda os testes |
| \`${pkgMgr} run lint\`  | Verifica o código |

## Estrutura

\`\`\`
src/
├── main.ts         # Ponto de entrada
└── ...
\`\`\`

---

*Projeto criado com [agent-cli](https://github.com/adriano/agent-cli)*
`

  return { path: 'README.md', content }
}

function generateGitignore(profile: StackProfile): GeneratedFile {
  const lines = [
    '# Dependencies',
    'node_modules/',
    '',
    '# Build',
    'dist/',
    'build/',
    '.next/',
    '',
    '# Environment',
    '.env',
    '.env.local',
    '.env.production',
    '',
    '# Agent CLI',
    '.agent/',
    '',
    '# OS',
    '.DS_Store',
    'Thumbs.db',
  ]

  if (profile.orm === 'prisma') {
    lines.push('', '# Prisma', 'prisma/migrations/dev/')
  }

  return { path: '.gitignore', content: lines.join('\n') + '\n' }
}