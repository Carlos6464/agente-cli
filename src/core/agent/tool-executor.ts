const { exec } = require('child_process')
const util      = require('util')
const execAsync = util.promisify(exec)

import { ToolCall, ToolResult } from './tool-definitions'
import { readFile, writeFile, listDir, searchCode } from '../../tools/filesystem.tools'

// ─────────────────────────────────────────────────────────────────────────────
// TOOL EXECUTOR
//
// Recebe uma ToolCall decidida pelo LLM e executa a ferramenta real.
// É a ponte entre a intenção do LLM e as ações no sistema de arquivos.
// ─────────────────────────────────────────────────────────────────────────────

export async function executeTool(
  call:        ToolCall,
  projectRoot: string = process.cwd()
): Promise<ToolResult> {

  try {
    switch (call.tool) {

      // ── read_file ──────────────────────────────────────────────────────────
      case 'read_file': {
        const filePath = resolvePath(call.params.path, projectRoot)
        const result   = readFile(filePath)

        if (!result.success) {
          return { tool: call.tool, success: false, output: '', error: result.error }
        }

        // Limita o conteúdo para não explodir o contexto do LLM
        const content = result.content!
        const truncated = content.length > 6000
          ? content.slice(0, 6000) + '\n... [arquivo truncado]'
          : content

        return { tool: call.tool, success: true, output: truncated }
      }

      // ── write_file ─────────────────────────────────────────────────────────
      case 'write_file': {
        const filePath = resolvePath(call.params.path, projectRoot)
        const result   = writeFile(filePath, call.params.content)

        if (!result.success) {
          return { tool: call.tool, success: false, output: '', error: result.error }
        }

        return {
          tool:    call.tool,
          success: true,
          output:  `Arquivo criado: ${call.params.path}`
        }
      }

      // ── list_dir ───────────────────────────────────────────────────────────
      case 'list_dir': {
        const dirPath   = resolvePath(call.params.path || '.', projectRoot)
        const recursive = call.params.recursive === true
        const result    = listDir(dirPath, recursive)

        if (!result.success) {
          return { tool: call.tool, success: false, output: '', error: result.error }
        }

        // Formata a lista de forma legível para o LLM
        const lines = result.items!.map(item => {
          const icon = item.type === 'directory' ? 'DIR' : 'FILE'
          const rel  = item.path.replace(projectRoot + '/', '')
          return `[${icon}] ${rel}`
        })

        return { tool: call.tool, success: true, output: lines.join('\n') }
      }

      // ── search_code ────────────────────────────────────────────────────────
      case 'search_code': {
        const searchPath = resolvePath(call.params.path || '.', projectRoot)
        const result     = searchCode(searchPath, call.params.term)

        if (!result.success) {
          return { tool: call.tool, success: false, output: '', error: result.error }
        }

        if (result.total === 0) {
          return { tool: call.tool, success: true, output: 'Nenhuma ocorrência encontrada.' }
        }

        const lines = result.matches!.map(m => {
          const rel = m.file.replace(projectRoot + '/', '')
          return `${rel}:${m.line} → ${m.content}`
        })

        return {
          tool:    call.tool,
          success: true,
          output:  `${result.total} ocorrência(s):\n${lines.join('\n')}`
        }
      }

      // ── run_command ────────────────────────────────────────────────────────
      case 'run_command': {
        try {
          const { stdout, stderr } = await execAsync(call.params.command, {
            cwd:     projectRoot,
            timeout: 30000 // 30 segundos máximo
          })

          const output = [
            stdout ? `STDOUT:\n${stdout}` : '',
            stderr ? `STDERR:\n${stderr}` : ''
          ].filter(Boolean).join('\n')

          return {
            tool:    call.tool,
            success: true,
            output:  output || '(comando executado sem output)'
          }
        } catch (err: any) {
          return {
            tool:    call.tool,
            success: false,
            output:  err.stdout || '',
            error:   err.stderr || err.message
          }
        }
      }

      // ── finish ─────────────────────────────────────────────────────────────
      case 'finish': {
        return {
          tool:    call.tool,
          success: true,
          output:  call.params.summary || 'Tarefa concluída.'
        }
      }

      // ── ferramenta desconhecida ────────────────────────────────────────────
      default: {
        return {
          tool:    call.tool,
          success: false,
          output:  '',
          error:   `Ferramenta desconhecida: "${call.tool}"`
        }
      }
    }

  } catch (err) {
    return {
      tool:    call.tool,
      success: false,
      output:  '',
      error:   `Erro ao executar ferramenta: ${(err as Error).message}`
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function resolvePath(inputPath: string, projectRoot: string): string {
  const path = require('path')
  // Se o caminho já é absoluto, usa direto
  if (path.isAbsolute(inputPath)) return inputPath
  // Caso contrário, resolve relativo à raiz do projeto
  return path.join(projectRoot, inputPath)
}