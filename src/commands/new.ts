import chalk from 'chalk'
import ora   from 'ora'
const inquirer = require('inquirer')
const fs       = require('fs')
const path     = require('path')
import { Command } from 'commander'

import { runWizard } from '../core/wizard/stack-wizard'
import { saveProfile, loadProfile, listProfiles } from '../core/memory/profile-memory'
import { saveConfig, AgentConfig } from './init'
import { indexProject } from '../rag/indexer'
import { ProviderFactory } from '../providers/provider.factory'
import { LLMMessage, AIConfig } from '../providers/llm-provider.interface'

async function generateProjectWithLLM(projectName: string, projectRoot: string, profile: any, config: any): Promise<string[]> {
  const provider = ProviderFactory.create(config.ai)
  const stackDescription = Object.entries(profile).filter(([k, v]) => v && v !== 'none' && v !== 'unknown' && typeof v === 'string').map(([k, v]) => `${k}: ${v}`).join('\n')

  const messages: LLMMessage[] = [
    { role: 'system', content: `Crie os arquivos iniciais de um projeto. Responda no formato:\n### ARQUIVO: caminho/relativo\n\`\`\`\nconteudo\n\`\`\`` },
    { role: 'user', content: `Projeto "${projectName}" stack:\n${stackDescription}\nCrie os arquivos iniciais.` }
  ]

  const result = await provider.complete(messages, { temperature: 0.2, maxTokens: 4000 })
  if (!result.success || !result.content) return []
  return parseAndWriteFiles(result.content, projectRoot)
}

function parseAndWriteFiles(llmResponse: string, projectRoot: string): string[] {
  const written: string[] = []
  const regex = /###\s*ARQUIVO:\s*(.+?)\n```(?:\w+)?\n([\s\S]*?)```/g
  let match
  while ((match = regex.exec(llmResponse)) !== null) {
    const rel = match[1].trim(); const content = match[2]
    if (!rel || rel.includes('..')) continue
    try {
      const fullPath = path.join(projectRoot, rel)
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, content, 'utf-8')
      written.push(rel)
    } catch {}
  }
  return written
}

export async function runNew(options: { nome: string; profile?: string; projectRoot?: string }) {
  const { nome } = options
  const projectRoot = path.join(options.projectRoot || process.cwd(), nome)
  console.log(chalk.bold.cyan('\n  🚀 Agent New\n'))

  if (fs.existsSync(projectRoot)) {
    const { overwrite } = await inquirer.prompt([{ type: 'confirm', name: 'overwrite', message: `A pasta "${nome}" já existe. Continuar?`, default: false }])
    if (!overwrite) process.exit(0)
  } else fs.mkdirSync(projectRoot, { recursive: true })

  let profile: any, savedAs: string | undefined
  if (options.profile) {
    const saved = loadProfile(options.profile)
    if (saved) profile = { ...saved.profile, projectName: nome, rootDir: projectRoot }
    else profile = { ...(await runWizard(nome)).profile, rootDir: projectRoot }
  } else {
    const result = await runWizard(nome)
    profile = { ...result.profile, rootDir: projectRoot }
    savedAs = result.savedAs
  }
  if (savedAs) saveProfile(savedAs, profile)

  const tempAiConfig: AIConfig = { provider: 'ollama', baseUrl: 'http://localhost:11434', defaultModel: 'deepseek-coder-v2:latest', embeddingModel: 'nomic-embed-text' }
  const genSpinner = ora('Gerando projeto com LLM...').start()
  
  let written: string[] = []
  try {
    if (await ProviderFactory.create(tempAiConfig).isAvailable()) {
      written = await generateProjectWithLLM(nome, projectRoot, profile, { ai: tempAiConfig })
      genSpinner.succeed(`${written.length} arquivos gerados.`)
    } else throw new Error('Offline')
  } catch {
    genSpinner.warn('LLM offline, criando mínimo manualmente.')
    const pkg = JSON.stringify({ name: nome, version: '0.1.0' }, null, 2)
    fs.writeFileSync(path.join(projectRoot, 'package.json'), pkg)
    fs.writeFileSync(path.join(projectRoot, 'README.md'), `# ${nome}`)
    written = ['package.json', 'README.md']
  }

  const config: AgentConfig = { version: '1.0.0', createdAt: new Date().toISOString(), projectRoot, profile, ai: tempAiConfig }
  saveConfig(config, projectRoot)
  console.log(chalk.bold.green('\n  ✅ Projeto criado!\n'))
}

export function newCommand(): Command {
  const cmd = new Command('new')
  cmd.description('Cria projeto').argument('<nome>').option('--profile <perfil>').action(async (n: string, o: any) => await runNew({ nome: n, profile: o.profile }))
  return cmd
}