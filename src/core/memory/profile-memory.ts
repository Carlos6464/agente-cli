const fs   = require('fs')
const path = require('path')
const os   = require('os')
import { StackProfile } from '../detector/stack-detector'

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE MEMORY
//
// Salva e carrega perfis de stack em ~/.agent/profiles/
// Permite reusar configurações em projetos futuros.
//
// Exemplo:
//   agent new meu-projeto --profile nestjs-prisma-ddd
//   → carrega o perfil salvo e pula o wizard
//
// Os perfis ficam em ~/.agent/profiles/ (global, não por projeto)
// ─────────────────────────────────────────────────────────────────────────────

const PROFILES_DIR = path.join(os.homedir(), '.agent', 'profiles')

export interface SavedProfile {
  name:      string
  createdAt: string
  profile:   StackProfile
}

// ─────────────────────────────────────────────────────────────────────────────
// SALVA UM PERFIL
// ─────────────────────────────────────────────────────────────────────────────

export function saveProfile(name: string, profile: StackProfile): void {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true })
  }

  const saved: SavedProfile = {
    name,
    createdAt: new Date().toISOString(),
    profile
  }

  const filePath = path.join(PROFILES_DIR, `${sanitizeName(name)}.json`)
  fs.writeFileSync(filePath, JSON.stringify(saved, null, 2), 'utf-8')
}

// ─────────────────────────────────────────────────────────────────────────────
// CARREGA UM PERFIL
// ─────────────────────────────────────────────────────────────────────────────

export function loadProfile(name: string): SavedProfile | null {
  const filePath = path.join(PROFILES_DIR, `${sanitizeName(name)}.json`)

  if (!fs.existsSync(filePath)) return null

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SavedProfile
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTA TODOS OS PERFIS SALVOS
// ─────────────────────────────────────────────────────────────────────────────

export function listProfiles(): SavedProfile[] {
  if (!fs.existsSync(PROFILES_DIR)) return []

  try {
    const files = fs.readdirSync(PROFILES_DIR) as string[]

    return files
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(PROFILES_DIR, f), 'utf-8')
          ) as SavedProfile
        } catch {
          return null
        }
      })
      .filter(Boolean) as SavedProfile[]
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REMOVE UM PERFIL
// ─────────────────────────────────────────────────────────────────────────────

export function deleteProfile(name: string): boolean {
  const filePath = path.join(PROFILES_DIR, `${sanitizeName(name)}.json`)

  if (!fs.existsSync(filePath)) return false

  try {
    fs.unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeName(name: string): string {
  // Remove caracteres inválidos para nome de arquivo
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, '-')
}