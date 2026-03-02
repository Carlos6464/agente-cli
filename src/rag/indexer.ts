const path = require('path')
import { embedBatch, isEmbeddingModelAvailable, EMBEDDING_MODEL } from './embeddings'
import { VectorStore, VectorEntry } from './vector-store'
import { listDir, readFile } from '../tools/filesystem.tools'
import { LANGUAGE_EXTENSIONS } from '../tools/filesystem.tools'

const CHUNK_SIZE    = 50
const CHUNK_OVERLAP = 10

const IGNORED_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'vectors.json',
  '.env',
  '.env.local',
  '.env.production',
])

export interface IndexResult {
  success:       boolean
  filesIndexed:  number
  chunksCreated: number
  skipped:       number
  error?:        string
}

export interface IndexOptions {
  projectRoot?:  string
  baseUrl?:      string
  model?:        string
  forceReindex?: boolean
  onProgress?:   (msg: string) => void
}

export async function indexProject(options: IndexOptions = {}): Promise<IndexResult> {
  const {
    projectRoot  = process.cwd(),
    baseUrl      = 'http://localhost:11434',
    model        = EMBEDDING_MODEL,
    forceReindex = false,
    onProgress
  } = options

  const store = new VectorStore(projectRoot)
  const log   = (msg: string) => onProgress?.(msg)

  // 🔴 VERIFICAÇÃO PRÉVIA DE SAÚDE DA IA
  const healthCheck = await isEmbeddingModelAvailable(baseUrl, model)
  if (!healthCheck.available) {
     return { success: false, filesIndexed: 0, chunksCreated: 0, skipped: 0, error: healthCheck.message }
  }

  let filesIndexed  = 0
  let chunksCreated = 0
  let skipped       = 0

  try {
    const codeExtensions = [
      ...LANGUAGE_EXTENSIONS.node,
      ...LANGUAGE_EXTENSIONS.python,
      ...LANGUAGE_EXTENSIONS.php,
      ...LANGUAGE_EXTENSIONS.ruby,
      ...LANGUAGE_EXTENSIONS.java,
      ...LANGUAGE_EXTENSIONS.config,
      ...LANGUAGE_EXTENSIONS.docs,
      ...LANGUAGE_EXTENSIONS.database,
    ]

    log('A listar arquivos do projeto...')
    const allFiles = listDir(projectRoot, true)

    if (!allFiles.success || !allFiles.items) {
      return { success: false, filesIndexed: 0, chunksCreated: 0, skipped: 0, error: allFiles.error }
    }

    const filesToIndex = allFiles.items.filter(item =>
      item.type === 'file' &&
      item.extension &&
      codeExtensions.includes(item.extension)
    )

    for (const fileItem of filesToIndex) {
      // Ignora pastas que causam peso no RAG
      const unixPath = fileItem.path.replace(/\\/g, '/')
      if (unixPath.includes('/node_modules/') || unixPath.includes('/__pycache__/') || unixPath.includes('/.venv/') || unixPath.includes('/venv/')) {
        skipped++
        continue
      }

      if (!forceReindex && store.hasFile(fileItem.path)) {
        skipped++
        continue
      }

      const fileName = path.basename(fileItem.path)
      if (IGNORED_FILES.has(fileName)) {
        skipped++
        continue
      }

      const fileContent = readFile(fileItem.path)
      if (!fileContent.success || !fileContent.content) {
        skipped++
        continue
      }

      const chunks = chunkText(fileContent.content, fileItem.path, fileItem.extension || 'txt')

      if (chunks.length === 0) {
        skipped++
        continue
      }

      log(`A indexar ${fileItem.path.replace(projectRoot + '/', '')} (${chunks.length} chunks)`)

      const texts  = chunks.map(c => c.content)
      const result = await embedBatch(texts, baseUrl, model)

      if (!result.success || !result.vectors) {
         // Lança erro fatal se a IA falhar a meio do processo
         return { success: false, filesIndexed, chunksCreated, skipped, error: result.error }
      }

      const entries: VectorEntry[] = chunks.map((chunk, i) => ({
        id:      `${fileItem.path}:${chunk.startLine}`,
        vector:  result.vectors![i],
        content: chunk.content,
        metadata: {
          filePath:  fileItem.path,
          startLine: chunk.startLine,
          endLine:   chunk.endLine,
          type:      classifyFileType(fileItem.extension || ''),
          language:  detectLanguageFromExtension(fileItem.extension || '')
        }
      }))

      store.addBatch(entries)
      filesIndexed++
      chunksCreated += chunks.length
    }

    return { success: true, filesIndexed, chunksCreated, skipped }

  } catch (err) {
    return {
      success:      false,
      filesIndexed,
      chunksCreated,
      skipped,
      error: `Erro fatal na indexação: ${(err as Error).message}`
    }
  }
}

export async function indexFile(
  filePath:    string,
  projectRoot: string = process.cwd(),
  baseUrl:     string = 'http://localhost:11434',
  model:       string = EMBEDDING_MODEL
): Promise<{ success: boolean; chunksCreated: number; error?: string }> {
  try {
    const healthCheck = await isEmbeddingModelAvailable(baseUrl, model)
    if (!healthCheck.available) {
       return { success: false, chunksCreated: 0, error: healthCheck.message }
    }

    const store       = new VectorStore(projectRoot)
    const fileContent = readFile(filePath)

    if (!fileContent.success || !fileContent.content) {
      return { success: false, chunksCreated: 0, error: fileContent.error }
    }

    const ext    = path.extname(filePath).slice(1)
    const chunks = chunkText(fileContent.content, filePath, ext)

    if (chunks.length === 0) return { success: true, chunksCreated: 0 }

    const texts  = chunks.map(c => c.content)
    const result = await embedBatch(texts, baseUrl, model)

    if (!result.success || !result.vectors) {
      return { success: false, chunksCreated: 0, error: result.error }
    }

    const entries: VectorEntry[] = chunks.map((chunk, i) => ({
      id:      `${filePath}:${chunk.startLine}`,
      vector:  result.vectors![i],
      content: chunk.content,
      metadata: {
        filePath,
        startLine: chunk.startLine,
        endLine:   chunk.endLine,
        type:      classifyFileType(ext),
        language:  detectLanguageFromExtension(ext)
      }
    }))

    store.addBatch(entries)
    return { success: true, chunksCreated: chunks.length }

  } catch (err) {
    return { success: false, chunksCreated: 0, error: (err as Error).message }
  }
}

interface TextChunk {
  content:   string
  startLine: number
  endLine:   number
}

function chunkText(content: string, filePath: string, ext: string): TextChunk[] {
  const lines  = content.split('\n')
  const chunks: TextChunk[] = []

  if (lines.length <= CHUNK_SIZE) {
    const clean = content.trim()
    if (clean.length > 10) {
      chunks.push({ content: clean, startLine: 1, endLine: lines.length })
    }
    return chunks
  }

  let start = 0
  while (start < lines.length) {
    const end          = Math.min(start + CHUNK_SIZE, lines.length)
    const chunkContent = lines.slice(start, end).join('\n').trim()

    if (chunkContent.length > 10) {
      chunks.push({
        content:   `// Arquivo: ${filePath}\n${chunkContent}`,
        startLine: start + 1,
        endLine:   end
      })
    }

    start += CHUNK_SIZE - CHUNK_OVERLAP
  }

  return chunks
}

function classifyFileType(ext: string): 'code' | 'config' | 'doc' {
  if (LANGUAGE_EXTENSIONS.config.includes(ext)) return 'config'
  if (LANGUAGE_EXTENSIONS.docs.includes(ext))   return 'doc'
  return 'code'
}

function detectLanguageFromExtension(ext: string): string {
  for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
    if (exts.includes(ext)) return lang
  }
  return 'unknown'
}