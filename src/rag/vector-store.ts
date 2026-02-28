const fs   = require('fs')
const path = require('path')

// ─────────────────────────────────────────────────────────────────────────────
// VECTOR STORE
//
// Armazena vetores (embeddings) e busca por similaridade.
// Implementação simples em JSON — sem servidor, sem dependências nativas.
// Os dados ficam em .agent/index/ na raiz do projeto.
//
// Cada entrada no índice tem:
//   - id:        identificador único (geralmente o caminho do arquivo)
//   - vector:    o embedding numérico do conteúdo
//   - content:   o texto original (trecho do arquivo)
//   - metadata:  informações extras (arquivo, linha, tipo)
// ─────────────────────────────────────────────────────────────────────────────

export interface VectorEntry {
  id:       string
  vector:   number[]
  content:  string
  metadata: {
    filePath:  string
    startLine: number
    endLine:   number
    type:      'code' | 'config' | 'doc'
    language?: string
  }
}

export interface SearchResult {
  entry:      VectorEntry
  similarity: number   // 0 a 1 — quanto mais próximo de 1, mais relevante
}

export interface VectorStoreStats {
  totalEntries: number
  indexPath:    string
  sizeInKb:     number
}

// ─────────────────────────────────────────────────────────────────────────────
// VECTOR STORE CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class VectorStore {
  private entries:   VectorEntry[] = []
  private indexPath: string
  private loaded:    boolean = false

  constructor(projectRoot: string = process.cwd()) {
    // O índice fica em .agent/index/vectors.json dentro do projeto
    this.indexPath = path.join(projectRoot, '.agent', 'index', 'vectors.json')
  }

  // ── load ───────────────────────────────────────────────────────────────────
  // Carrega o índice do disco para a memória
  // Chamado automaticamente antes de qualquer operação

  load(): void {
    if (this.loaded) return

    try {
      if (fs.existsSync(this.indexPath)) {
        const raw = fs.readFileSync(this.indexPath, 'utf-8')
        this.entries = JSON.parse(raw)
      } else {
        this.entries = []
      }
      this.loaded = true
    } catch {
      // Índice corrompido — começa do zero
      this.entries = []
      this.loaded  = true
    }
  }

  // ── save ───────────────────────────────────────────────────────────────────
  // Persiste o índice em disco

  save(): void {
    const dir = path.dirname(this.indexPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.indexPath, JSON.stringify(this.entries, null, 2), 'utf-8')
  }

  // ── add ────────────────────────────────────────────────────────────────────
  // Adiciona ou atualiza uma entrada no índice

  add(entry: VectorEntry): void {
    this.load()

    // Se já existe uma entrada com esse id, substitui
    const existingIndex = this.entries.findIndex(e => e.id === entry.id)

    if (existingIndex >= 0) {
      this.entries[existingIndex] = entry
    } else {
      this.entries.push(entry)
    }
  }

  // ── addBatch ───────────────────────────────────────────────────────────────
  // Adiciona múltiplas entradas e salva uma única vez
  // Mais eficiente que chamar add() em loop

  addBatch(entries: VectorEntry[]): void {
    this.load()
    for (const entry of entries) {
      const existingIndex = this.entries.findIndex(e => e.id === entry.id)
      if (existingIndex >= 0) {
        this.entries[existingIndex] = entry
      } else {
        this.entries.push(entry)
      }
    }
    this.save()
  }

  // ── remove ─────────────────────────────────────────────────────────────────
  // Remove entradas pelo filePath (para quando um arquivo é deletado)

  removeByFile(filePath: string): void {
    this.load()
    this.entries = this.entries.filter(e => e.metadata.filePath !== filePath)
    this.save()
  }

  // ── search ─────────────────────────────────────────────────────────────────
  // Busca as entradas mais similares a um vetor de query
  // Retorna os topK resultados ordenados por similaridade decrescente

  search(queryVector: number[], topK: number = 5): SearchResult[] {
    this.load()

    if (this.entries.length === 0) return []

    // Calcula similaridade de cosseno entre a query e cada entrada
    const results = this.entries.map(entry => ({
      entry,
      similarity: cosineSimilarity(queryVector, entry.vector)
    }))

    // Ordena por similaridade decrescente e retorna os topK
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
      .filter(r => r.similarity > 0.3) // Ignora resultados muito distantes
  }

  // ── clear ──────────────────────────────────────────────────────────────────
  // Limpa todo o índice (usado no agent init para reindexar do zero)

  clear(): void {
    this.entries = []
    this.loaded  = true
    this.save()
  }

  // ── stats ──────────────────────────────────────────────────────────────────
  // Retorna estatísticas do índice

  stats(): VectorStoreStats {
    this.load()

    let sizeInKb = 0
    try {
      if (fs.existsSync(this.indexPath)) {
        const stat = fs.statSync(this.indexPath)
        sizeInKb   = Math.round(stat.size / 1024)
      }
    } catch {}

    return {
      totalEntries: this.entries.length,
      indexPath:    this.indexPath,
      sizeInKb
    }
  }

  // ── hasFile ────────────────────────────────────────────────────────────────
  // Verifica se um arquivo já foi indexado

  hasFile(filePath: string): boolean {
    this.load()
    return this.entries.some(e => e.metadata.filePath === filePath)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMILARIDADE DE COSSENO
//
// Mede o ângulo entre dois vetores — quanto menor o ângulo, mais similares.
// Retorna um valor entre -1 e 1:
//   1  = vetores idênticos (mesmo significado)
//   0  = vetores perpendiculares (sem relação)
//  -1  = vetores opostos (significados contrários)
//
// Para embeddings de texto, os valores ficam geralmente entre 0.3 e 1.0
// ─────────────────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct  = 0  // produto escalar — soma de a[i] * b[i]
  let magnitudeA  = 0  // magnitude (comprimento) do vetor a
  let magnitudeB  = 0  // magnitude (comprimento) do vetor b

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    magnitudeA += a[i] * a[i]
    magnitudeB += b[i] * b[i]
  }

  magnitudeA = Math.sqrt(magnitudeA)
  magnitudeB = Math.sqrt(magnitudeB)

  // Evita divisão por zero
  if (magnitudeA === 0 || magnitudeB === 0) return 0

  return dotProduct / (magnitudeA * magnitudeB)
}