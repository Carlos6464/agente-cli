import chalk from 'chalk'
import ora   from 'ora'
const inquirer = require('inquirer')
const fs       = require('fs')
const path     = require('path')
import { Command }   from 'commander'
import { runWizard }                               from '../core/wizard/stack-wizard'
import { saveProfile, loadProfile, listProfiles }  from '../core/memory/profile-memory'
import { saveConfig, AgentConfig }                 from './init'
import { indexProject }                            from '../rag/indexer'
import { OllamaProvider, OLLAMA_MODELS }           from '../providers/ollama.provider'
import { LLMMessage }                              from '../providers/llm-provider.interface'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT NEW — zero conhecimento embutido
//
// O Template Engine estático foi removido.
// Em vez disso, o LLM recebe as escolhas do wizard e gera os arquivos
// do zero — consultando o que encontrar sobre a stack escolhida.
//
// Isso garante que o código gerado reflita a versão ATUAL das ferramentas,
// não um template que pode estar desatualizado.
// ─────────────────────────────────────────────────────────────────────────────

// Gera os arquivos do projeto usando o LLM
async function generateProjectWithLLM(
  projectName: string,
  projectRoot: string,
  profile:     any,
  config:      any
): Promise<string[]> {

  const provider = new OllamaProvider(config.ollama.defaultModel, config.ollama.baseUrl)

  // Descreve a stack escolhida em linguagem natural, sem ditar como fazer
  const stackDescription = Object.entries({
    linguagem:       profile.language,
    'pkg manager':   profile.packageManager,
    backend:         profile.backend,
    frontend:        profile.frontend,
    mobile:          profile.mobile,
    monorepo:        profile.monorepo,
    orm:             profile.orm,
    banco:           profile.database,
    arquitetura:     profile.architecture,
    testes:          profile.testing,
  })
    .filter(([_, v]) => v && v !== 'none' && v !== 'unknown')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `Você é um gerador de projetos. Crie os arquivos iniciais de um projeto novo.
Responda com os arquivos no formato:
### ARQUIVO: caminho/relativo/do/arquivo
\`\`\`
conteúdo do arquivo
\`\`\`

Gere apenas os arquivos essenciais para o projeto funcionar.
Use as versões mais recentes e estáveis das ferramentas.
Não adicione explicações fora dos blocos de arquivo.`
    },
    {
      role: 'user',
      content: `Crie os arquivos iniciais para o projeto "${projectName}" com esta stack:

${stackDescription}

Gere os arquivos de configuração e estrutura base necessários para o projeto funcionar.
Inclua package.json (ou equivalente), arquivo de configuração principal, ponto de entrada e README.`
    }
  ]

  const result = await provider.complete(messages, { temperature: 0.2, maxTokens: 4000 })
  if (!result.success || !result.content) return []

  return parseAndWriteFiles(result.content, projectRoot)
}

// Faz parse da resposta do LLM e escreve os arquivos no disco
function parseAndWriteFiles(llmResponse: string, projectRoot: string): string[] {
  const written: string[] = []

  // Regex para capturar blocos ### ARQUIVO: ... seguidos de ```...```
  const fileBlockRegex = /###\s*ARQUIVO:\s*(.+?)\n```(?:\w+)?\n([\s\S]*?)```/g

  let match
  while ((match = fileBlockRegex.exec(llmResponse)) !== null) {
    const relativePath = match[1].trim()
    const content      = match[2]

    if (!relativePath || relativePath.includes('..')) continue  // segurança

    try {
      const fullPath = path.join(projectRoot, relativePath)
      const dir      = path.dirname(fullPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(fullPath, content, 'utf-8')
      written.push(relativePath)
    } catch {}
  }

  return written
}

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

export async function runNew(options: { nome: string; profile?: string; projectRoot?: string }) {
  const { nome }    = options
  const parentDir   = options.projectRoot || process.cwd()
  const projectRoot = path.join(parentDir, nome)

  console.log('')
  console.log(chalk.bold.cyan('  🚀 Agent New'))
  console.log(chalk.gray(`  Criando: ${chalk.white(nome)}\n`))

  // ── Verifica pasta ─────────────────────────────────────────────────────────

  if (fs.existsSync(projectRoot)) {
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm', name: 'overwrite',
      message: `A pasta "${nome}" já existe. Continuar?`, default: false
    }])
    if (!overwrite) { console.log(chalk.gray('\n  Cancelado.\n')); process.exit(0) }
  } else {
    fs.mkdirSync(projectRoot, { recursive: true })
  }

  // ── Wizard ou perfil salvo ─────────────────────────────────────────────────

  let profile: any
  let savedAs: string | undefined

  if (options.profile) {
    const saved = loadProfile(options.profile)
    if (saved) {
      profile = { ...saved.profile, projectName: nome, rootDir: projectRoot }
      console.log(chalk.green(`\n  ✓ Perfil "${options.profile}" carregado`))
      printStackSummary(profile)
    } else {
      const profiles = listProfiles()
      console.log(chalk.yellow(`\n  ⚠️  Perfil "${options.profile}" não encontrado.`))
      if (profiles.length > 0) {
        console.log(chalk.gray(`  Disponíveis: ${profiles.map((p: any) => p.name).join(', ')}\n`))
      }
      const result = await runWizard(nome)
      profile = { ...result.profile, rootDir: projectRoot }
      savedAs = result.savedAs
    }
  } else {
    console.log('')
    const result = await runWizard(nome)
    profile = { ...result.profile, rootDir: projectRoot }
    savedAs = result.savedAs
  }

  if (savedAs) {
    saveProfile(savedAs, profile)
    console.log(chalk.green(`\n  ✓ Perfil "${savedAs}" salvo em ~/.agent/profiles/`))
  }

  // ── Confirma ───────────────────────────────────────────────────────────────

  console.log('')
  printStackSummary(profile)

  const { confirmed } = await inquirer.prompt([{
    type: 'confirm', name: 'confirmed', message: 'Gerar projeto?', default: true
  }])

  if (!confirmed) {
    fs.rmSync(projectRoot, { recursive: true, force: true })
    console.log(chalk.gray('\n  Cancelado.\n'))
    process.exit(0)
  }

  // ── Gera com LLM ──────────────────────────────────────────────────────────

  console.log('')
  const genSpinner = ora('Gerando projeto com LLM...').start()

  // Config temporária para passar ao LLM
  const tempConfig = {
    profile,
    ollama: {
      baseUrl:        'http://localhost:11434',
      defaultModel:   OLLAMA_MODELS.DEFAULT,
      fastModel:      OLLAMA_MODELS.FAST,
      embeddingModel: 'nomic-embed-text'
    }
  }

  // Verifica se o Ollama está disponível
  const ollamaOk = await new OllamaProvider().isAvailable()

  let written: string[] = []

  if (ollamaOk) {
    try {
      written = await generateProjectWithLLM(nome, projectRoot, profile, tempConfig)
      genSpinner.succeed(`${written.length} arquivo(s) gerado(s) pelo LLM`)
    } catch (err) {
      genSpinner.warn(`LLM indisponível: ${(err as Error).message}`)
      genSpinner.warn('Criando estrutura mínima manualmente...')
      written = createMinimalStructure(projectRoot, profile, nome)
    }
  } else {
    genSpinner.warn('Ollama não disponível — criando estrutura mínima...')
    written = createMinimalStructure(projectRoot, profile, nome)
  }

  written.forEach(f => console.log(chalk.gray(`    + ${f}`)))

  // ── Salva config e indexa ──────────────────────────────────────────────────

  const config: AgentConfig = {
    version:     '1.0.0',
    createdAt:   new Date().toISOString(),
    projectRoot,
    profile,
    ollama:      tempConfig.ollama
  }
  saveConfig(config, projectRoot)

  const idxSpinner = ora('Indexando no RAG...').start()
  const idxResult  = await indexProject({ projectRoot, onProgress: msg => { idxSpinner.text = msg } })
  idxResult.success
    ? idxSpinner.succeed(`${idxResult.chunksCreated} chunks indexados`)
    : idxSpinner.warn(`Indexação parcial: ${idxResult.error}`)

  // ── Resultado ─────────────────────────────────────────────────────────────

  console.log('')
  console.log(chalk.bold.green('  ✅ Projeto criado!\n'))
  console.log(chalk.gray(`  Local: ${projectRoot}\n`))
  console.log(chalk.bold('  Próximos passos:'))
  console.log(chalk.white(`  cd ${nome}`))
  console.log(chalk.white(`  ${profile.packageManager} install`))
  console.log(chalk.white(`  ${profile.packageManager} run dev`))
  console.log('')
}

// Fallback minimalista quando o LLM não está disponível
// Só cria o esqueleto — sem nenhum conhecimento de framework
function createMinimalStructure(projectRoot: string, profile: any, projectName: string): string[] {
  const written: string[] = []

  const write = (relPath: string, content: string) => {
    const full = path.join(projectRoot, relPath)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf-8')
    written.push(relPath)
  }

  write('README.md', `# ${projectName}\n\nProjeto criado com agent-cli.\n\n## Setup\n\n\`\`\`bash\n${profile.packageManager} install\n${profile.packageManager} run dev\n\`\`\`\n`)
  write('.gitignore', 'node_modules/\ndist/\nbuild/\n.env\n.agent/\n')

  // package.json vazio — sem scripts fixos, o usuário configura
  write('package.json', JSON.stringify({ name: projectName, version: '0.1.0', private: true, scripts: {}, dependencies: {}, devDependencies: {} }, null, 2))
  write('src/.gitkeep', '')

  return written
}

export function newCommand(): Command {
  const cmd = new Command('new')
  cmd.description('Cria um projeto — o LLM gera os arquivos baseado na stack escolhida')
     .argument('<nome>', 'Nome do projeto')
     .option('--profile <perfil>', 'Usar perfil salvo (~/.agent/profiles/)')
     .action(async (nome: string, options: { profile?: string }) => {
       await runNew({ nome, profile: options.profile })
     })
  return cmd
}