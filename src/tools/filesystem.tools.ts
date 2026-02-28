import fs from 'fs'
import path from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// Cada ferramenta retorna um objeto com success: true/false
// Se success for false, o campo error explica o que aconteceu
// Isso evita que um erro em uma ferramenta quebre o agente inteiro
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadFileResult {
  success: boolean
  content?: string
  error?: string
}

export interface WriteFileResult {
  success: boolean
  path?: string
  error?: string
}

export interface ListDirResult {
  success: boolean
  items?: DirItem[]
  error?: string
}

export interface DirItem {
  name: string
  type: 'file' | 'directory'
  path: string
  extension?: string
}

export interface SearchResult {
  success: boolean
  matches?: SearchMatch[]
  total?: number
  error?: string
}

export interface SearchMatch {
  file: string
  line: number
  content: string
}

// ─────────────────────────────────────────────────────────────────────────────
// READFILE
// Lê o conteúdo de um arquivo e retorna como string.
// Uso: readFile('./src/index.ts')
// ─────────────────────────────────────────────────────────────────────────────

export function readFile(filePath: string): ReadFileResult {
  try {
    // path.resolve transforma qualquer caminho (relativo ou absoluto)
    // em um caminho absoluto baseado na pasta onde o agente está rodando
    const absolutePath = path.resolve(filePath)

    // Verifica se o arquivo existe antes de tentar ler
    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: `Arquivo não encontrado: ${absolutePath}`
      }
    }

    // Verifica se é realmente um arquivo e não uma pasta
    const stat = fs.statSync(absolutePath)
    if (stat.isDirectory()) {
      return {
        success: false,
        error: `O caminho informado é uma pasta, não um arquivo: ${absolutePath}`
      }
    }

    // Lê o arquivo como texto em UTF-8
    const content = fs.readFileSync(absolutePath, 'utf-8')

    return {
      success: true,
      content
    }
  } catch (err) {
    return {
      success: false,
      error: `Erro ao ler arquivo: ${(err as Error).message}`
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITEFILE
// Cria ou sobrescreve um arquivo com o conteúdo fornecido.
// Se as pastas do caminho não existirem, cria automaticamente.
// Uso: writeFile('./src/modules/payments/payments.module.ts', conteudo)
// ─────────────────────────────────────────────────────────────────────────────

export function writeFile(filePath: string, content: string): WriteFileResult {
  try {
    const absolutePath = path.resolve(filePath)

    // Pega só a parte do caminho sem o nome do arquivo
    // Ex: '/home/user/projeto/src/modules' a partir de '/home/user/projeto/src/modules/payments.ts'
    const dir = path.dirname(absolutePath)

    // Cria todas as pastas do caminho se não existirem
    // { recursive: true } faz com que não dê erro se a pasta já existir
    // e cria todas as pastas intermediárias necessárias de uma vez
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Escreve o arquivo — se já existir, sobrescreve
    fs.writeFileSync(absolutePath, content, 'utf-8')

    return {
      success: true,
      path: absolutePath
    }
  } catch (err) {
    return {
      success: false,
      error: `Erro ao escrever arquivo: ${(err as Error).message}`
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTDIR
// Lista o conteúdo de uma pasta.
// Retorna nome, tipo (file/directory), caminho completo e extensão.
// Uso: listDir('./src') ou listDir('./src', true) para listar recursivamente
// ─────────────────────────────────────────────────────────────────────────────

export function listDir(dirPath: string, recursive = false): ListDirResult {
  try {
    const absolutePath = path.resolve(dirPath)

    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: `Pasta não encontrada: ${absolutePath}`
      }
    }

    const stat = fs.statSync(absolutePath)
    if (!stat.isDirectory()) {
      return {
        success: false,
        error: `O caminho informado é um arquivo, não uma pasta: ${absolutePath}`
      }
    }

    const items: DirItem[] = []

    // Pastas que não fazem sentido listar — geradas automaticamente
    // ou que não contêm código do projeto
    const ignoredDirs = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
      '.turbo',
      'coverage',
      '.cache'
    ])

    function scan(currentPath: string) {
      const entries = fs.readdirSync(currentPath)

      for (const entry of entries) {
        // Ignora arquivos e pastas ocultos (começam com ponto)
        // exceto o .agent que é a pasta de configuração do agente
        if (entry.startsWith('.') && entry !== '.agent') continue

        // Ignora pastas que não são código do projeto
        if (ignoredDirs.has(entry)) continue

        const fullPath = path.join(currentPath, entry)
        const entryStat = fs.statSync(fullPath)
        const isDirectory = entryStat.isDirectory()

        items.push({
          name: entry,
          type: isDirectory ? 'directory' : 'file',
          path: fullPath,
          // Extensão só faz sentido para arquivos
          extension: isDirectory ? undefined : path.extname(entry).slice(1) || undefined
        })

        // Se modo recursivo, entra nas subpastas
        if (recursive && isDirectory) {
          scan(fullPath)
        }
      }
    }

    scan(absolutePath)

    return {
      success: true,
      items
    }
  } catch (err) {
    return {
      success: false,
      error: `Erro ao listar pasta: ${(err as Error).message}`
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSÕES POR LINGUAGEM
// Mapa de preset de extensões por stack/linguagem.
// Permite passar 'python', 'laravel', 'node' em vez de listar extensões manualmente.
// Uso: searchCode('./src', 'def ', LANGUAGE_EXTENSIONS.python)
//      searchCode('.', 'Route::', [...LANGUAGE_EXTENSIONS.php, ...LANGUAGE_EXTENSIONS.config])
// ─────────────────────────────────────────────────────────────────────────────

export const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  // JavaScript / TypeScript — projetos Node, React, Next, Nest, Expo
  node:       ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],

  // Python — scripts, Django, FastAPI, scripts de ML
  python:     ['py', 'pyw', 'pyi'],

  // PHP — Laravel, Symfony, WordPress
  php:        ['php', 'blade.php'],

  // Ruby — Rails, scripts
  ruby:       ['rb', 'rake', 'gemspec'],

  // Go
  go:         ['go'],

  // Rust
  rust:       ['rs'],

  // Java / Kotlin — Spring Boot, Android
  java:       ['java', 'kt', 'kts'],

  // C# — .NET, Unity
  csharp:     ['cs', 'csx'],

  // Configuração — arquivos de config comuns a qualquer stack
  config:     ['json', 'yaml', 'yml', 'toml', 'env', 'ini', 'conf'],

  // Documentação
  docs:       ['md', 'mdx', 'txt', 'rst'],

  // Estilos — projetos frontend
  styles:     ['css', 'scss', 'sass', 'less', 'styl'],

  // Templates / Views
  templates:  ['html', 'htm', 'ejs', 'hbs', 'pug', 'twig', 'vue', 'svelte'],

  // Banco de dados / ORM
  database:   ['sql', 'prisma', 'graphql', 'gql'],

  // Shell scripts
  shell:      ['sh', 'bash', 'zsh', 'fish', 'ps1'],
}

// Extensão padrão quando nenhuma é informada:
// cobre a maioria dos projetos sem ser excessivo
const DEFAULT_EXTENSIONS = [
  ...LANGUAGE_EXTENSIONS.node,
  ...LANGUAGE_EXTENSIONS.config,
  ...LANGUAGE_EXTENSIONS.docs,
]

// ─────────────────────────────────────────────────────────────────────────────
// SEARCHCODE
// Busca um termo dentro dos arquivos de um projeto.
// Retorna cada ocorrência com o caminho do arquivo, número da linha e conteúdo.
//
// Uso básico (extensões padrão — node + config + docs):
//   searchCode('./src', 'PrismaClient')
//
// Uso com preset de linguagem:
//   searchCode('./src', 'def ', LANGUAGE_EXTENSIONS.python)
//   searchCode('.', 'Route::', LANGUAGE_EXTENSIONS.php)
//
// Uso combinando linguagens:
//   searchCode('.', 'DATABASE_URL', [
//     ...LANGUAGE_EXTENSIONS.python,
//     ...LANGUAGE_EXTENSIONS.config
//   ])
//
// Uso com extensões customizadas:
//   searchCode('./src', 'MyClass', ['ts', 'py', 'java'])
// ─────────────────────────────────────────────────────────────────────────────

export function searchCode(
  dirPath: string,
  term: string,
  extensions: string[] = DEFAULT_EXTENSIONS,
  // Limite de resultados para não sobrecarregar o contexto do LLM
  maxResults = 50
): SearchResult {
  try {
    const absolutePath = path.resolve(dirPath)

    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: `Pasta não encontrada: ${absolutePath}`
      }
    }

    if (!term || term.trim() === '') {
      return {
        success: false,
        error: 'Termo de busca não pode ser vazio'
      }
    }

    const matches: SearchMatch[] = []

    const ignoredDirs = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
      '.turbo',
      'coverage',
      '.cache'
    ])

    function scanForTerm(currentPath: string) {
      // Para de buscar quando atingir o limite
      if (matches.length >= maxResults) return

      const entries = fs.readdirSync(currentPath)

      for (const entry of entries) {
        if (matches.length >= maxResults) return
        if (entry.startsWith('.') && entry !== '.agent') continue
        if (ignoredDirs.has(entry)) continue

        const fullPath = path.join(currentPath, entry)
        const entryStat = fs.statSync(fullPath)

        if (entryStat.isDirectory()) {
          // Entra recursivamente nas subpastas
          scanForTerm(fullPath)
        } else {
          // Verifica se a extensão do arquivo está na lista de extensões permitidas
          const ext = path.extname(entry).slice(1)
          if (!extensions.includes(ext)) continue

          // Lê o arquivo e busca o termo linha por linha
          const content = fs.readFileSync(fullPath, 'utf-8')
          const lines = content.split('\n')

          lines.forEach((line, index) => {
            if (matches.length >= maxResults) return

            // Busca case-insensitive para não perder resultados por diferença de maiúsculas
            if (line.toLowerCase().includes(term.toLowerCase())) {
              matches.push({
                file: fullPath,
                line: index + 1, // +1 porque arrays começam em 0 mas linhas começam em 1
                content: line.trim()
              })
            }
          })
        }
      }
    }

    scanForTerm(absolutePath)

    return {
      success: true,
      matches,
      total: matches.length
    }
  } catch (err) {
    return {
      success: false,
      error: `Erro ao buscar no código: ${(err as Error).message}`
    }
  }
}