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
// Solução: você salva trechos de código real que já implementou e aprovou.
// O agente usa esses trechos como referência OBRIGATÓRIA — não como sugestão.
//
// Diferença do RAG:
//   RAG = busca automática por similaridade semântica (pode errar)
//   Pattern = referência explícita que você escolheu (nunca erra)
//
// Suporte a múltiplos arquivos:
//   Um padrão pode abranger várias camadas (repository, service, router).
//   Todos os arquivos são salvos juntos em um único .json.
//
// Armazenamento: .agent/patterns/<nome>.json (por projeto, não global)
// ─────────────────────────────────────────────────────────────────────────────

// Um arquivo dentro de um padrão multi-arquivo
export interface PatternFile {
  role:       string   // ex: 'repository', 'service', 'router'
  sourcePath: string   // caminho relativo à raiz do projeto
  content:    string   // conteúdo no momento do save
}

export interface PatternEntry {
  name:        string
  description: string
  savedAt:     string

  // Compatibilidade retroativa: padrão de arquivo único
  sourceFile?: string
  content?:    string

  // Novo: padrão multi-arquivo
  files?:      PatternFile[]
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
// HELPER: retorna todos os arquivos do padrão de forma normalizada
// Lida com padrões antigos (arquivo único) e novos (multi-arquivo)
// ─────────────────────────────────────────────────────────────────────────────

export function getPatternFiles(entry: PatternEntry): PatternFile[] {
  // Padrão novo: tem campo `files`
  if (entry.files && entry.files.length > 0) {
    return entry.files
  }

  // Padrão legado: tem `sourceFile` + `content`
  if (entry.sourceFile && entry.content) {
    return [{
      role:       inferRole(entry.sourceFile),
      sourcePath: entry.sourceFile,
      content:    entry.content,
    }]
  }

  return []
}

// Infere o role pelo nome do arquivo (heurística para padrões legados)
function inferRole(filePath: string): string {
  const name = path.basename(filePath).toLowerCase()
  if (name.includes('repository') || name.includes('repo')) return 'repository'
  if (name.includes('service'))                              return 'service'
  if (name.includes('router') || name.includes('route') || name.includes('controller')) return 'router'
  if (name.includes('model') || name.includes('entity'))    return 'model'
  if (name.includes('schema') || name.includes('dto'))      return 'schema'
  return 'arquivo'
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBCOMANDO: pattern save
// Aceita --file (único) ou --files (múltiplos, separados por vírgula)
// ─────────────────────────────────────────────────────────────────────────────

async function runPatternSave(
  name: string,
  options: { file?: string; files?: string; desc?: string; projectRoot?: string }
) {
  const projectRoot = options.projectRoot || process.cwd()

  if (!hasConfig(projectRoot)) {
    console.log(chalk.red('\n  ❌ Projeto não inicializado. Execute primeiro: agent init\n'))
    process.exit(1)
  }

  // ── Resolve quais arquivos salvar ─────────────────────────────────────────

  let rawPaths: string[] = []

  if (options.files) {
    // --files "path1, path2, path3"
    rawPaths = options.files.split(',').map(p => p.trim()).filter(Boolean)

  } else if (options.file) {
    // --file "path" (compatibilidade com o comportamento antigo)
    rawPaths = [options.file.trim()]

  } else {
    // Sem flag — pergunta interativamente
    console.log(chalk.gray('\n  Você pode salvar um único arquivo ou vários (para padrões que abrangem múltiplas camadas).\n'))

    const { mode } = await inquirer.prompt([{
      type:    'list',
      name:    'mode',
      message: 'Quantos arquivos fazem parte deste padrão?',
      choices: [
        { name: 'Um arquivo (ex: só o service)',            value: 'single' },
        { name: 'Vários arquivos (ex: repository + service + router)', value: 'multi' },
      ]
    }])

    if (mode === 'single') {
      const { filePath } = await inquirer.prompt([{
        type:     'input',
        name:     'filePath',
        message:  'Caminho do arquivo (relativo à raiz do projeto):',
        validate: (v: string) => v.trim().length > 0 || 'Informe o caminho'
      }])
      rawPaths = [filePath.trim()]

    } else {
      console.log(chalk.gray('  Informe os caminhos separados por vírgula.'))
      console.log(chalk.gray('  Ex: apps/backend/app/repositories/problema_repository.py, apps/backend/app/services/problema_service.py\n'))

      const { filesInput } = await inquirer.prompt([{
        type:     'input',
        name:     'filesInput',
        message:  'Caminhos dos arquivos (separados por vírgula):',
        validate: (v: string) => v.trim().length > 0 || 'Informe ao menos um caminho'
      }])
      rawPaths = filesInput.split(',').map((p: string) => p.trim()).filter(Boolean)
    }
  }

  // ── Lê e valida cada arquivo ──────────────────────────────────────────────

  const patternFiles: PatternFile[] = []

  for (const rawPath of rawPaths) {
    const absFile = path.isAbsolute(rawPath)
      ? rawPath
      : path.join(projectRoot, rawPath)

    const readResult = readFile(absFile)
    if (!readResult.success || !readResult.content) {
      console.log(chalk.red(`\n  ❌ Arquivo não encontrado: ${rawPath}\n`))
      process.exit(1)
    }

    // Para multi-arquivo, pergunta o role de cada um interativamente
    // (só se não vier de --files, onde assumimos que o usuário já sabe)
    let role = inferRole(rawPath)

    if (rawPaths.length > 1 && !options.files) {
      const { confirmedRole } = await inquirer.prompt([{
        type:    'input',
        name:    'confirmedRole',
        message: `  Qual o papel de "${path.basename(rawPath)}"? (ex: repository, service, router)`,
        default: role
      }])
      role = confirmedRole.trim() || role
    }

    patternFiles.push({
      role,
      sourcePath: path.relative(projectRoot, absFile),
      content:    readResult.content,
    })
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
    const existingFiles = getPatternFiles(existing)
    console.log(chalk.yellow(`\n  ⚠️  Já existe um padrão chamado "${name}" (salvo em ${existing.savedAt.slice(0, 10)}).`))
    console.log(chalk.gray(`  Arquivos: ${existingFiles.map(f => f.sourcePath).join(', ')}\n`))

    const { overwrite } = await inquirer.prompt([{
      type:    'confirm',
      name:    'overwrite',
      message: 'Sobrescrever?',
      default: false
    }])
    if (!overwrite) { console.log(chalk.gray('\n  Cancelado.\n')); process.exit(0) }
  }

  // ── Monta e salva a entrada ───────────────────────────────────────────────

  const isMulti = patternFiles.length > 1

  const entry: PatternEntry = isMulti
    ? {
        // Formato novo: multi-arquivo
        name,
        description,
        savedAt: new Date().toISOString(),
        files:   patternFiles,
      }
    : {
        // Formato legado: arquivo único (retrocompatível com generate.ts existente)
        name,
        description,
        savedAt:    new Date().toISOString(),
        sourceFile: patternFiles[0].sourcePath,
        content:    patternFiles[0].content,
        files:      patternFiles,   // inclui `files` também para o novo formato
      }

  savePattern(entry, projectRoot)

  // ── Feedback ──────────────────────────────────────────────────────────────

  console.log(chalk.bold.green(`\n  ✅ Padrão "${name}" salvo!\n`))

  if (isMulti) {
    console.log(chalk.gray('  Arquivos salvos:'))
    patternFiles.forEach(f => {
      const lines = f.content.split('\n').length
      console.log(chalk.gray(`    • [${f.role}] ${f.sourcePath} (${lines} linhas)`))
    })
  } else {
    console.log(chalk.gray(`  Arquivo: ${patternFiles[0].sourcePath}`))
    console.log(chalk.gray(`  Linhas: ${patternFiles[0].content.split('\n').length}`))
  }

  if (description) console.log(chalk.gray(`  Descrição: ${description}`))
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
    console.log(chalk.gray('  Use: agent pattern save <nome> --file <arquivo>'))
    console.log(chalk.gray('  Ou:  agent pattern save <nome> --files "<arq1>, <arq2>, <arq3>"\n'))
    return
  }

  for (const p of patterns) {
    const pFiles  = getPatternFiles(p)
    const isMulti = pFiles.length > 1
    const date    = p.savedAt.slice(0, 10)

    console.log(chalk.bold.white(`  ${p.name}`) + (isMulti ? chalk.cyan('  [multi-arquivo]') : ''))
    if (p.description) console.log(chalk.gray(`  Descrição: ${p.description}`))
    console.log(chalk.gray(`  Salvo em: ${date}`))

    if (isMulti) {
      pFiles.forEach(f => {
        const lines = f.content.split('\n').length
        console.log(chalk.gray(`    • [${f.role}] ${f.sourcePath} (${lines} linhas)`))
      })
    } else {
      const lines = pFiles[0]?.content.split('\n').length || 0
      console.log(chalk.gray(`  Arquivo: ${pFiles[0]?.sourcePath} (${lines} linhas)`))
    }

    console.log(chalk.gray(`  Uso: agent generate <tipo> <nome> --use-pattern ${p.name}`))
    console.log('')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBCOMANDO: pattern show
// ─────────────────────────────────────────────────────────────────────────────

function runPatternShow(name: string, options: { projectRoot?: string }) {
  const projectRoot = options.projectRoot || process.cwd()

  const pattern = loadPattern(name, projectRoot)
  if (!pattern) {
    console.log(chalk.red(`\n  ❌ Padrão "${name}" não encontrado.\n`))
    process.exit(1)
  }

  const pFiles = getPatternFiles(pattern)

  console.log(chalk.bold.cyan(`\n  📄 Padrão: ${pattern.name}\n`))
  if (pattern.description) console.log(chalk.gray(`  Descrição: ${pattern.description}`))
  console.log(chalk.gray(`  Salvo em: ${pattern.savedAt.slice(0, 10)}`))
  console.log(chalk.gray(`  Arquivos: ${pFiles.length}\n`))

  for (const f of pFiles) {
    const sep = '─'.repeat(50)
    console.log(chalk.bold.white(`  [${f.role}] ${f.sourcePath}`))
    console.log(chalk.gray('  ' + sep))
    console.log(f.content)
    console.log(chalk.gray('  ' + sep + '\n'))
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
// COMANDO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// HELPER PARA O GENERATE.TS
// Formata todos os arquivos do padrão como bloco de instrução obrigatória
// ─────────────────────────────────────────────────────────────────────────────

export function formatPatternForInstruction(entry: PatternEntry): string {
  const pFiles = getPatternFiles(entry)
  const parts: string[] = []

  parts.push(`⚠️  PADRÃO OBRIGATÓRIO "${entry.name}" — MÁXIMA PRIORIDADE:`)
  if (entry.description) parts.push(`Descrição: ${entry.description}`)
  parts.push(`Este padrão abrange ${pFiles.length} arquivo(s). Copie estrutura, imports e convenções EXATAMENTE.\n`)

  for (const f of pFiles) {
    parts.push(`--- [${f.role.toUpperCase()}] ${f.sourcePath} ---`)
    parts.push('```')
    parts.push(f.content)
    parts.push('```\n')
  }

  parts.push('REGRAS ao usar este padrão:')
  parts.push('- Copie estrutura, imports e convenções de CADA arquivo acima.')
  parts.push(`- Adapte apenas: nomes de classes/funções para o novo contexto.`)
  parts.push('- NÃO substitua bibliotecas, ORMs, frameworks ou estilos vistos acima.')
  parts.push('- NÃO use padrões genéricos do treinamento — use o que está acima.')

  return parts.join('\n')
}

export function patternCommand(): Command {
  const cmd = new Command('pattern')
  cmd.description('Gerencia padrões de código aprovados — referências explícitas para o agent generate')

  // pattern save <nome>
  cmd
    .command('save <nome>')
    .description('Salva um ou mais arquivos como padrão de referência nomeado')
    .option('--file <caminho>',    'Arquivo único (relativo à raiz do projeto)')
    .option('--files <caminhos>',  'Múltiplos arquivos separados por vírgula (ex: "repo.py, service.py, router.py")')
    .option('--desc <descrição>',  'Descrição curta do padrão')
    .action(async (nome: string, opts: any) => {
      await runPatternSave(nome, { file: opts.file, files: opts.files, desc: opts.desc })
    })

  // pattern list
  cmd
    .command('list')
    .description('Lista todos os padrões salvos no projeto')
    .action(() => runPatternList({}))

  // pattern show <nome>
  cmd
    .command('show <nome>')
    .description('Exibe o conteúdo completo de um padrão')
    .action((nome: string) => runPatternShow(nome, {}))

  // pattern delete <nome>
  cmd
    .command('delete <nome>')
    .description('Remove um padrão salvo')
    .action(async (nome: string) => {
      await runPatternDelete(nome, {})
    })

  return cmd
}