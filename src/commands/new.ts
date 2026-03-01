import chalk from 'chalk'
import ora   from 'ora'
const inquirer = require('inquirer')
const fs       = require('fs')
const path     = require('path')
import { Command } from 'commander'

import { runWizard }                          from '../core/wizard/stack-wizard'
import { generateProjectFiles, writeProjectFiles } from '../core/templates/template-engine'
import { saveProfile, loadProfile, listProfiles }  from '../core/memory/profile-memory'
import { saveConfig, AgentConfig }                 from './init'
import { indexProject }                            from '../rag/indexer'
import { OLLAMA_MODELS }                           from '../providers/ollama.provider'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT NEW
//
// Cria um projeto do zero com wizard interativo.
// Usa o perfil salvo se --profile for informado.
//
// Fluxo:
//   1. Cria a pasta do projeto
//   2. Carrega perfil salvo OU roda o wizard
//   3. Salva perfil se o usuário pediu
//   4. Gera arquivos base com o Template Engine
//   5. Salva .agent/config.json
//   6. Indexa o projeto no RAG
//   7. Exibe próximos passos
// ─────────────────────────────────────────────────────────────────────────────

export async function runNew(options: {
  nome:          string
  profile?:      string
  projectRoot?:  string
}) {
  const { nome } = options
  const parentDir   = options.projectRoot || process.cwd()
  const projectRoot = path.join(parentDir, nome)

  console.log('')
  console.log(chalk.bold.cyan('  🚀 Agent New'))
  console.log(chalk.gray(`  Criando: ${chalk.white(nome)}\n`))

  // ── 1. Verifica se a pasta já existe ──────────────────────────────────────

  if (fs.existsSync(projectRoot)) {
    const { overwrite } = await inquirer.prompt([{
      type:    'confirm',
      name:    'overwrite',
      message: `A pasta "${nome}" já existe. Continuar mesmo assim?`,
      default: false
    }])

    if (!overwrite) {
      console.log(chalk.gray('\n  Cancelado.\n'))
      process.exit(0)
    }
  } else {
    fs.mkdirSync(projectRoot, { recursive: true })
    console.log(chalk.gray(`  Pasta criada: ${projectRoot}`))
  }

  // ── 2. Carrega perfil ou roda o wizard ────────────────────────────────────

  let profile: any
  let savedAs: string | undefined

  if (options.profile) {
    // Tenta carregar perfil salvo
    const saved = loadProfile(options.profile)

    if (saved) {
      profile = { ...saved.profile, projectName: nome, rootDir: projectRoot }
      console.log(chalk.green(`\n  ✓ Perfil "${options.profile}" carregado`))
      printStackSummary(profile)
    } else {
      // Perfil não encontrado — lista os disponíveis e pergunta
      const profiles = listProfiles()
      console.log(chalk.yellow(`\n  ⚠️  Perfil "${options.profile}" não encontrado.`))

      if (profiles.length > 0) {
        console.log(chalk.gray(`\n  Perfis disponíveis: ${profiles.map(p => p.name).join(', ')}\n`))
      }

      console.log(chalk.gray('  Iniciando wizard...\n'))
      const result = await runWizard(nome)
      profile = { ...result.profile, rootDir: projectRoot }
      savedAs = result.savedAs
    }
  } else {
    // Sem perfil — roda o wizard direto
    console.log('')
    const result = await runWizard(nome)
    profile = { ...result.profile, rootDir: projectRoot }
    savedAs = result.savedAs
  }

  // ── 3. Salva perfil se solicitado ─────────────────────────────────────────

  if (savedAs) {
    saveProfile(savedAs, profile)
    console.log(chalk.green(`\n  ✓ Perfil "${savedAs}" salvo em ~/.agent/profiles/`))
  }

  // ── 4. Confirma antes de gerar ────────────────────────────────────────────

  console.log('')
  printStackSummary(profile)

  const { confirmed } = await inquirer.prompt([{
    type:    'confirm',
    name:    'confirmed',
    message: 'Gerar estrutura do projeto?',
    default: true
  }])

  if (!confirmed) {
    fs.rmSync(projectRoot, { recursive: true, force: true })
    console.log(chalk.gray('\n  Cancelado. Pasta removida.\n'))
    process.exit(0)
  }

  // ── 5. Gera arquivos base ─────────────────────────────────────────────────

  console.log('')
  const genSpinner = ora('Gerando estrutura do projeto...').start()

  const templateResult = generateProjectFiles(profile, projectRoot)

  if (!templateResult.success) {
    genSpinner.fail(`Erro ao gerar templates: ${templateResult.error}`)
    process.exit(1)
  }

  const { written, errors } = writeProjectFiles(templateResult.files, projectRoot)

  if (errors.length > 0) {
    genSpinner.warn(`${written.length} arquivo(s) criado(s), ${errors.length} erro(s)`)
    errors.forEach(e => console.log(chalk.red(`  ! ${e}`)))
  } else {
    genSpinner.succeed(`${written.length} arquivo(s) gerado(s)`)
  }

  // ── 6. Salva .agent/config.json ───────────────────────────────────────────

  const config: AgentConfig = {
    version:     '1.0.0',
    createdAt:   new Date().toISOString(),
    projectRoot,
    profile,
    ollama: {
      baseUrl:        'http://localhost:11434',
      defaultModel:   OLLAMA_MODELS.DEFAULT,
      fastModel:      OLLAMA_MODELS.FAST,
      embeddingModel: 'nomic-embed-text'
    }
  }

  saveConfig(config, projectRoot)

  // ── 7. Indexa o projeto ───────────────────────────────────────────────────

  const indexSpinner = ora('Indexando projeto no RAG...').start()

  const indexResult = await indexProject({
    projectRoot,
    onProgress: (msg) => { indexSpinner.text = msg }
  })

  if (indexResult.success) {
    indexSpinner.succeed(`Indexação concluída — ${indexResult.chunksCreated} chunks`)
  } else {
    indexSpinner.warn(`Indexação com erro: ${indexResult.error}`)
  }

  // ── 8. Resultado final ────────────────────────────────────────────────────

  console.log('')
  console.log(chalk.bold.green('  ✅ Projeto criado com sucesso!\n'))
  console.log(chalk.gray(`  Localização: ${projectRoot}`))
  console.log('')
  console.log(chalk.bold('  Próximos passos:'))
  console.log(chalk.white(`  cd ${nome}`))
  console.log(chalk.white(`  ${profile.packageManager} install`))
  console.log(chalk.white(`  ${profile.packageManager} run dev`))
  console.log('')
  console.log(chalk.gray('  Depois que tiver código no projeto:'))
  console.log(chalk.white('  agent generate module <nome>   ') + chalk.gray('— gera módulos'))
  console.log(chalk.white('  agent chat                     ') + chalk.gray('— conversa sobre o projeto'))
  console.log('')
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — exibe resumo da stack
// ─────────────────────────────────────────────────────────────────────────────

function printStackSummary(profile: any) {
  const line = (label: string, value: string) => {
    if (value && value !== 'none' && value !== 'unknown') {
      console.log(`  ${chalk.green('✓')} ${chalk.gray(label.padEnd(16))} ${chalk.white(value)}`)
    }
  }

  console.log(chalk.bold('  Stack selecionada:\n'))
  line('Linguagem',       profile.language)
  line('Package Manager', profile.packageManager)
  line('Backend',         profile.backend)
  line('Frontend',        profile.frontend)
  line('Mobile',          profile.mobile)
  line('Monorepo',        profile.monorepo)
  line('ORM',             profile.orm)
  line('Banco',           profile.database)
  line('Arquitetura',     profile.architecture)
  line('Testes',          profile.testing)
  console.log('')
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMANDER WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

export function newCommand(): Command {
  const command = new Command('new')

  command
    .description('Cria um novo projeto do zero com wizard de stack')
    .argument('<nome>', 'Nome do projeto')
    .option('--profile <perfil>', 'Usar um perfil de stack salvo (~/.agent/profiles/)')
    .action(async (nome: string, options: { profile?: string }) => {
      await runNew({ nome, profile: options.profile })
    })

  return command
}