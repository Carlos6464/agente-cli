import chalk from 'chalk'
const fs = require('fs')
import { readFile, writeFile, listDir, searchCode, LANGUAGE_EXTENSIONS } from './tools/filesystem.tools'

function separator(title: string) {
  console.log('\n' + chalk.bgBlue.white(` ${title} `) + '\n')
}
function ok(msg: string) { console.log(chalk.green('  ✅ ' + msg)) }
function fail(msg: string) { console.log(chalk.red('  ❌ ' + msg)) }
function info(msg: string) { console.log(chalk.gray('  → ' + msg)) }

separator('TESTE 1 — readFile: arquivo que existe')
const r1 = readFile('./package.json')
if (r1.success) { ok('Leitura bem sucedida'); info(`Início: ${r1.content?.slice(0, 80)}...`) }
else { fail(r1.error!) }

separator('TESTE 2 — readFile: arquivo que não existe')
const r2 = readFile('./nao-existe.ts')
if (!r2.success) { ok(`Erro retornado corretamente: ${r2.error}`) }
else { fail('Deveria ter dado erro') }

separator('TESTE 3 — writeFile: cria arquivo e pastas')
const r3 = writeFile('./teste-agente/sub/exemplo.ts', `export const msg = 'funcionou!'`)
if (r3.success) { ok(`Criado em: ${r3.path}`) }
else { fail(r3.error!) }

separator('TESTE 4 — readFile: lê arquivo recém criado')
const r4 = readFile('./teste-agente/sub/exemplo.ts')
if (r4.success) { ok('Lido com sucesso'); info(`Conteúdo: ${r4.content}`) }
else { fail(r4.error!) }

separator('TESTE 5 — listDir: pasta src (não recursivo)')
const r5 = listDir('./src')
if (r5.success) {
  ok(`${r5.items?.length} itens encontrados`)
  r5.items?.forEach(i => info(`${i.type === 'directory' ? '📁' : '📄'} ${i.name}`))
} else { fail(r5.error!) }

separator('TESTE 6 — listDir: src recursivo')
const r6 = listDir('./src', true)
if (r6.success) {
  ok(`${r6.items?.length} itens no total`)
  r6.items?.forEach(i => {
    const rel = i.path.replace(process.cwd() + '/', '')
    info(`${i.type === 'directory' ? '📁' : '📄'} ${rel}`)
  })
} else { fail(r6.error!) }

separator('TESTE 7 — searchCode: busca "Command" (extensões padrão)')
const r7 = searchCode('./src', 'Command')
if (r7.success) {
  ok(`${r7.total} ocorrências encontradas`)
  r7.matches?.slice(0, 5).forEach(m => {
    info(`${m.file.replace(process.cwd() + '/', '')}:${m.line} → ${m.content}`)
  })
  if ((r7.total ?? 0) > 5) info(`... e mais ${(r7.total ?? 0) - 5} ocorrências`)
} else { fail(r7.error!) }

separator('TESTE 8 — searchCode: preset LANGUAGE_EXTENSIONS.node')
const r8 = searchCode('./src', 'import', LANGUAGE_EXTENSIONS.node)
if (r8.success) {
  ok(`${r8.total} ocorrências de "import" em arquivos node (${LANGUAGE_EXTENSIONS.node.join(', ')})`)
} else { fail(r8.error!) }

separator('TESTE 9 — searchCode: combinando node + config + docs')
const r9 = searchCode('.', 'agent', [
  ...LANGUAGE_EXTENSIONS.node,
  ...LANGUAGE_EXTENSIONS.config,
  ...LANGUAGE_EXTENSIONS.docs,
])
if (r9.success) {
  ok(`${r9.total} ocorrências de "agent" em node + config + docs`)
} else { fail(r9.error!) }

separator('TESTE 10 — searchCode: extensões customizadas ["ts"]')
const r10 = searchCode('./src', 'export', ['ts'])
if (r10.success) {
  ok(`${r10.total} ocorrências de "export" apenas em .ts`)
} else { fail(r10.error!) }

separator('TESTE 11 — searchCode: termo inexistente')
const r11 = searchCode('./src', 'XYZTermoInexistente123')
if (r11.success) {
  ok(`${r11.total} resultado(s) — esperado 0 ou 1`)
} else { fail(r11.error!) }

separator('PRESETS DISPONÍVEIS — LANGUAGE_EXTENSIONS')
Object.entries(LANGUAGE_EXTENSIONS).forEach(([lang, exts]) => {
  info(`${lang.padEnd(12)} → ${exts.join(', ')}`)
})

separator('LIMPEZA')
try {
  fs.rmSync('./teste-agente', { recursive: true, force: true })
  ok('Pasta de teste removida')
} catch (e) { fail((e as Error).message) }

separator('TODOS OS TESTES CONCLUÍDOS')