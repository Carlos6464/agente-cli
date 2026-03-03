import chalk from 'chalk'
const fs       = require('fs')
const path     = require('path')
const inquirer = require('inquirer')
import { Command } from 'commander'
import { hasConfig, loadConfig } from './init'
import { readFile } from '../tools/filesystem.tools'

// ─────────────────────────────────────────────────────────────────────────────
// AGENT PATTERN — Biblioteca de padrões aprovados do projeto
//
// Problema que resolve: o LLM alucina quando pedimos algo que não está no
// índice RAG — ele cai no treinamento genérico em vez do código real.
//
// Solução: você salva um trecho de código real que já implementou e aprovou.
// O agente usa esse trecho como referência OBRIGATÓRIA — não como sugestão.
//
// Diferença do RAG:
//   RAG = busca automática por similaridade semântica (pode errar)
//   Pattern = referência explícita que você escolheu (nunca erra)
//
// Armazenamento: .agent/patterns/<nome>.json (por projeto, não global)
// ─────────────────────────────────────────────────────────────────────────────

export interface PatternEntry {
  name:        string
  description: string
  savedAt:     string
  sourceFile:  string   // caminho original (relativo à raiz do projeto)
  content:     string   // conteúdo do arquivo no momento do save
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE DISCO
// ─────────────────────────────────────────────────────────────────────────────

function getPatternsDir(projectRoot: string): string {
  return path.join(projectRoot, '.agent', 'patterns')
}

function getPatternPath(projectRoot: string, name: string): string {
  return path.join(getPatternsDir(projectRoot), `${sanitize(name)}.json`)
}

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, '-')
}

export function savePattern(entry: PatternEntry, projectRoot: string): void {
  const dir = getPatternsDir(projectRoot)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getPatternPath(projectRoot, entry.name), JSON.stringify(entry, null, 2), 'utf-8')
}

export function loadPattern(name: string, projectRoot: string): PatternEntry | null {
  const p = getPatternPath(projectRoot, name)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

export function listPatterns(projectRoot: string): PatternEntry[] {
  const dir = getPatternsDir(projectRoot)
  if (!fs.existsSync(dir)) return []
  try {
    return (fs.readdirSync(dir) as string[])
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as PatternEntry }
        catch { return null }
      })
      .filter(Boolean) as PatternEntry[]
  } catch { return [] }
}

export function deletePattern(name: string, projectRoot: string): boolean {
  const p = getPatternPath(projectRoot, name)
  if (!fs.existsSync(p)) return false
  try { fs.unlinkSync(p); return true } catch { return false }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBCOMANDO: pattern save
// ─────────────────────────────────────────────────────────────────────────────

async function runPatternSave(name: string, options: { file?: string; desc?: string; projectRoot?: string }) {
  const projectRoot = options.projectRoot || process.cwd()

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('\n  ❌ Projeto não inicializado. Execute primeiro: agent init\n'))
    process.exit(1)
  }

  // ── Resolve o arquivo fonte ───────────────────────────────────────────────
  let sourceFile = options.file

  if (!sourceFile) {
    const { filePath } = await inquirer.prompt([{
      type:     'input',
      name:     'filePath',
      message:  'Caminho do arquivo de referência (relativo à raiz do projeto):',
      validate: (v: string) => v.trim().length > 0 || 'Informe o caminho'
    }])
    sourceFile = filePath.trim()
  }

  // Resolve relativo à raiz do projeto
  const absFile = path.isAbsolute(sourceFile)
    ? sourceFile
    : path.join(projectRoot, sourceFile)

  const readResult = readFile(absFile)
  if (!readResult.success || !readResult.content) {
    console.log(chalk.red(`\n  ❌ Arquivo não encontrado: ${sourceFile}\n`))
    process.exit(1)
  }

  // ── Descrição opcional ────────────────────────────────────────────────────
  let description = options.desc || ''
  if (!description) {
    const { desc } = await inquirer.prompt([{
      type:    'input',
      name:    'desc',
      message: 'Descrição curta do padrão (opcional — Enter para pular):',
    }])
    description = desc.trim()
  }

  // ── Verifica sobreescrita ─────────────────────────────────────────────────
  const existing = loadPattern(name, projectRoot)
  if (existing) {
    console.log(chalk.yellow(`\n  ⚠️  Já existe um padrão chamado "${name}" (salvo em ${existing.savedAt.slice(0, 10)}).`))
    console.log(chalk.gray(`  Arquivo original: ${existing.sourceFile}\n`))

    const { overwrite } = await inquirer.prompt([{
      type:    'confirm',
      name:    'overwrite',
      message: 'Sobrescrever?',
      default: false
    }])
    if (!overwrite) { console.log(chalk.gray('\n  Cancelado.\n')); process.exit(0) }
  }

  // ── Salva ─────────────────────────────────────────────────────────────────
  const entry: PatternEntry = {
    name,
    description,
    savedAt:    new Date().toISOString(),
    sourceFile: path.relative(projectRoot, absFile),
    content:    readResult.content
  }

  savePattern(entry, projectRoot)

  console.log(chalk.bold.green(`\n  ✅ Padrão "${name}" salvo!\n`))
  console.log(chalk.gray(`  Arquivo: ${entry.sourceFile}`))
  if (description) console.log(chalk.gray(`  Descrição: ${description}`))
  console.log(chalk.gray(`  Linhas: ${entry.content.split('\n').length}`))
  console.log('')
  console.log(chalk.white(`  Para usar: `) + chalk.cyan(`agent generate <tipo> <nome> --use-pattern ${name}\n`))
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBCOMANDO: pattern list
// ─────────────────────────────────────────────────────────────────────────────

function runPatternList(options: { projectRoot?: string }) {
  const projectRoot = options.projectRoot || process.cwd()

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('\n  ❌ Projeto não inicializado. Execute primeiro: agent init\n'))
    process.exit(1)
  }

  const patterns = listPatterns(projectRoot)

  console.log(chalk.bold.cyan('\n  📚 Padrões do Projeto\n'))

  if (patterns.length === 0) {
    console.log(chalk.gray('  Nenhum padrão salvo ainda.'))
    console.log(chalk.gray('  Use: agent pattern save <nome> --file <arquivo>\n'))
    return
  }

  for (const p of patterns) {
    const lines = p.content.split('\n').length
    const date  = p.savedAt.slice(0, 10)
    console.log(chalk.bold.white(`  ${p.name}`))
    console.log(chalk.gray(`  Arquivo: ${p.sourceFile} (${lines} linhas) — salvo em ${date}`))
    if (p.description) console.log(chalk.gray(`  Descrição: ${p.description}`))
    console.log(chalk.gray(`  Uso: agent generate <tipo> <nome> --use-pattern ${p.name}`))
    console.log('')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBCOMANDO: pattern delete
// ─────────────────────────────────────────────────────────────────────────────

async function runPatternDelete(name: string, options: { projectRoot?: string }) {
  const projectRoot = options.projectRoot || process.cwd()

  const existing = loadPattern(name, projectRoot)
  if (!existing) {
    console.log(chalk.red(`\n  ❌ Padrão "${name}" não encontrado.\n`))
    process.exit(1)
  }

  const { confirm } = await inquirer.prompt([{
    type:    'confirm',
    name:    'confirm',
    message: `Remover o padrão "${name}"?`,
    default: false
  }])

  if (!confirm) { console.log(chalk.gray('\n  Cancelado.\n')); return }

  deletePattern(name, projectRoot)
  console.log(chalk.green(`\n  ✅ Padrão "${name}" removido.\n`))
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBCOMANDO: pattern show
// Exibe o conteúdo completo de um padrão salvo
// ─────────────────────────────────────────────────────────────────────────────

function runPatternShow(name: string, options: { projectRoot?: string }) {
  const projectRoot = options.projectRoot || process.cwd()

  const pattern = loadPattern(name, projectRoot)
  if (!pattern) {
    console.log(chalk.red(`\n  ❌ Padrão "${name}" não encontrado.\n`))
    process.exit(1)
  }

  console.log(chalk.bold.cyan(`\n  📄 Padrão: ${pattern.name}\n`))
  console.log(chalk.gray(`  Arquivo: ${pattern.sourceFile}`))
  if (pattern.description) console.log(chalk.gray(`  Descrição: ${pattern.description}`))
  console.log(chalk.gray(`  Salvo em: ${pattern.savedAt.slice(0, 10)}\n`))
  console.log(chalk.gray('  ' + '─'.repeat(50)))
  console.log(pattern.content)
  console.log(chalk.gray('  ' + '─'.repeat(50) + '\n'))
}

// ─────────────────────────────────────────────────────────────────────────────
// COMANDO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export function patternCommand(): Command {
  const cmd = new Command('pattern')
  cmd.description('Gerencia padrões de código aprovados — referências explícitas para o agent generate')

  // pattern save <nome>
  cmd
    .command('save <nome>')
    .description('Salva um arquivo como padrão de referência nomeado')
    .option('--file <caminho>', 'Arquivo fonte (relativo à raiz do projeto)')
    .option('--desc <descrição>', 'Descrição curta do padrão')
    .action(async (nome: string, opts: any) => {
      await runPatternSave(nome, { file: opts.file, desc: opts.desc })
    })

  // pattern list
  cmd
    .command('list')
    .description('Lista todos os padrões salvos no projeto')
    .action((opts: any) => runPatternList({}))

  // pattern show <nome>
  cmd
    .command('show <nome>')
    .description('Exibe o conteúdo completo de um padrão')
    .action((nome: string, opts: any) => runPatternShow(nome, {}))

  // pattern delete <nome>
  cmd
    .command('delete <nome>')
    .description('Remove um padrão salvo')
    .action(async (nome: string, opts: any) => {
      await runPatternDelete(nome, {})
    })

  return cmd
}