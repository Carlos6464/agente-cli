const inquirer = require('inquirer')
import { StackProfile } from '../detector/stack-detector'

// ─────────────────────────────────────────────────────────────────────────────
// STACK WIZARD
//
// Pergunta ao usuário qual stack quer usar para um projeto novo.
// Retorna um StackProfile completo — o mesmo formato do Stack Detector,
// mas preenchido via perguntas em vez de detecção automática.
// ─────────────────────────────────────────────────────────────────────────────

export interface WizardResult {
  profile:  StackProfile
  savedAs?: string
}

export async function runWizard(projectName: string): Promise<WizardResult> {

  // ── 1. Tipo do projeto ────────────────────────────────────────────────────

  const { projectType } = await inquirer.prompt([{
    type:    'list',
    name:    'projectType',
    message: 'Que tipo de projeto?',
    choices: [
      { name: '🔧 API / Backend',             value: 'backend'   },
      { name: '🌐 Fullstack (API + Frontend)', value: 'fullstack' },
      { name: '⚛️  Frontend / SPA',           value: 'frontend'  },
      { name: '📱 Mobile',                     value: 'mobile'    },
      { name: '📦 Monorepo',                   value: 'monorepo'  },
      { name: '🛠️  CLI / Ferramenta',          value: 'cli'       },
    ]
  }])

  // ── 2. Linguagem ──────────────────────────────────────────────────────────

  const { language } = await inquirer.prompt([{
    type:    'list',
    name:    'language',
    message: 'Linguagem principal?',
    choices: [
      { name: 'TypeScript (recomendado)', value: 'typescript' },
      { name: 'JavaScript',               value: 'javascript' },
      { name: 'Python',                   value: 'python'     },
      { name: 'PHP',                      value: 'php'        },
    ]
  }])

  // ── 3. Backend ────────────────────────────────────────────────────────────

  let backend  = 'none'
  let frontend = 'none'
  let mobile   = 'none'
  let monorepo = 'none'

  if (['backend', 'fullstack'].includes(projectType)) {
    if (language === 'typescript' || language === 'javascript') {
      const { backendChoice } = await inquirer.prompt([{
        type:    'list',
        name:    'backendChoice',
        message: 'Framework de backend?',
        choices: [
          { name: 'NestJS', value: 'nestjs'  },
          { name: 'Express', value: 'express' },
          { name: 'Fastify', value: 'fastify' },
        ]
      }])
      backend = backendChoice
    } else if (language === 'python') {
      const { backendChoice } = await inquirer.prompt([{
        type: 'list', name: 'backendChoice', message: 'Framework?',
        choices: [
          { name: 'FastAPI', value: 'fastapi' },
          { name: 'Django',  value: 'django'  },
        ]
      }])
      backend = backendChoice
    } else if (language === 'php') {
      backend = 'laravel'
    }
  }

  // ── 4. Frontend ───────────────────────────────────────────────────────────

  if (['frontend', 'fullstack'].includes(projectType)) {
    const { frontendChoice } = await inquirer.prompt([{
      type: 'list', name: 'frontendChoice', message: 'Framework de frontend?',
      choices: [
        { name: 'Next.js',   value: 'nextjs'  },
        { name: 'React + Vite', value: 'vite' },
        { name: 'Vue 3',     value: 'vue'     },
        { name: 'Angular',   value: 'angular' },
        { name: 'Nuxt',      value: 'nuxt'    },
      ]
    }])
    frontend = frontendChoice
  }

  // ── 5. Mobile ─────────────────────────────────────────────────────────────

  if (projectType === 'mobile') {
    const { mobileChoice } = await inquirer.prompt([{
      type: 'list', name: 'mobileChoice', message: 'Framework mobile?',
      choices: [
        { name: 'Expo',             value: 'expo'             },
        { name: 'React Native CLI', value: 'react-native-cli' },
      ]
    }])
    mobile = mobileChoice
  }

  // ── 6. Monorepo ───────────────────────────────────────────────────────────

  if (projectType === 'monorepo') {
    const { monorepoChoice } = await inquirer.prompt([{
      type: 'list', name: 'monorepoChoice', message: 'Ferramenta de monorepo?',
      choices: [
        { name: 'Turborepo', value: 'turborepo' },
        { name: 'Nx',        value: 'nx'        },
      ]
    }])
    monorepo = monorepoChoice
  }

  // ── 7. Banco de dados ─────────────────────────────────────────────────────

  let database = 'none'
  let orm      = 'none'

  if (['backend', 'fullstack', 'monorepo'].includes(projectType)) {
    const { dbChoice } = await inquirer.prompt([{
      type: 'list', name: 'dbChoice', message: 'Banco de dados?',
      choices: [
        { name: 'PostgreSQL', value: 'postgresql' },
        { name: 'MySQL',      value: 'mysql'      },
        { name: 'SQLite',     value: 'sqlite'     },
        { name: 'MongoDB',    value: 'mongodb'    },
        { name: 'Nenhum',     value: 'none'       },
      ]
    }])
    database = dbChoice

    if (database !== 'none' && (language === 'typescript' || language === 'javascript')) {
      const { ormChoice } = await inquirer.prompt([{
        type: 'list', name: 'ormChoice', message: 'ORM?',
        choices: [
          { name: 'Prisma',    value: 'prisma'  },
          { name: 'TypeORM',   value: 'typeorm' },
          { name: 'DrizzleORM', value: 'drizzle' },
          { name: 'Nenhum',    value: 'none'    },
        ]
      }])
      orm = ormChoice
    }
  }

  // ── 8. Arquitetura ────────────────────────────────────────────────────────

  let architecture = 'simple'

  if (['backend', 'fullstack', 'monorepo'].includes(projectType)) {
    const { archChoice } = await inquirer.prompt([{
      type: 'list', name: 'archChoice', message: 'Padrão arquitetural?',
      choices: [
        { name: 'Simples',  value: 'simple'  },
        { name: 'Modular',  value: 'modular' },
        { name: 'MVC',      value: 'mvc'     },
        { name: 'DDD',      value: 'ddd'     },
      ]
    }])
    architecture = archChoice
  }

  // ── 9. Package manager ────────────────────────────────────────────────────

  let packageManager = 'npm'

  if (language === 'typescript' || language === 'javascript') {
    const { pkgMgr } = await inquirer.prompt([{
      type: 'list', name: 'pkgMgr', message: 'Package manager?',
      choices: [
        { name: 'npm',  value: 'npm'  },
        { name: 'pnpm', value: 'pnpm' },
        { name: 'yarn', value: 'yarn' },
      ]
    }])
    packageManager = pkgMgr
  }

  // ── 10. Testes ────────────────────────────────────────────────────────────

  let testing = 'none'

  if (language === 'typescript' || language === 'javascript') {
    const { testChoice } = await inquirer.prompt([{
      type: 'list', name: 'testChoice', message: 'Framework de testes?',
      choices: [
        { name: 'Jest',   value: 'jest'   },
        { name: 'Vitest', value: 'vitest' },
        { name: 'Nenhum', value: 'none'   },
      ]
    }])
    testing = testChoice
  }

  // ── 10.5 Docker ───────────────────────────────────────────────────────────
  let docker = 'none'

  if (['backend', 'fullstack', 'monorepo', 'frontend'].includes(projectType)) {
    const { dockerChoice } = await inquirer.prompt([{
      type: 'list', name: 'dockerChoice', message: 'Configuração de Docker inicial?',
      choices: [
        { name: 'Ambos (Dockerfile + Compose)', value: 'both' },
        { name: 'Apenas Dockerfile', value: 'dockerfile' },
        { name: 'Apenas Docker Compose', value: 'compose' },
        { name: 'Nenhuma', value: 'none' },
      ]
    }])
    docker = dockerChoice
  }

  // ── 11. Salvar como perfil ────────────────────────────────────────────────

  const { saveProfile } = await inquirer.prompt([{
    type: 'confirm', name: 'saveProfile',
    message: 'Salvar essa stack como perfil para reusar depois?',
    default: false
  }])

  let savedAs: string | undefined

  if (saveProfile) {
    const { name } = await inquirer.prompt([{
      type:     'input',
      name:     'name',
      message:  'Nome do perfil (ex: nestjs-prisma-ddd):',
      validate: (v: string) => v.trim().length > 0 || 'Nome não pode ser vazio'
    }])
    savedAs = name.trim()
  }

  // ── Monta o StackProfile ──────────────────────────────────────────────────

  const profile: StackProfile = {
    projectName:    projectName,
    rootDir:        process.cwd(),
    language:       language       as any,
    packageManager: packageManager as any,
    monorepo:       monorepo       as any,
    backend:        backend        as any,
    frontend:       frontend       as any,
    mobile:         mobile         as any,
    orm:            orm            as any,
    database:       database       as any,
    architecture:   architecture   as any,
    testing:        testing        as any,
    docker:         docker         as any, // Propriedade adicionada!
    apps:           [],
    ambiguities:    [],
    examplePaths:   {}
  }

  return { profile, savedAs }
}