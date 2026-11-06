import path from 'node:path'

/** Folders skipped at every scan level. */
const EXCLUDED_ANYWHERE = new Set(['$recycle.bin', 'system volume information'])

/** AppData is skipped only below the selected root, because the user may deliberately pick a folder inside it. */
const EXCLUDED_BELOW_ROOT = new Set(['appdata'])

/** System folders located directly in the drive root. */
const SYSTEM_DIRS_AT_DRIVE_ROOT = new Set([
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'recovery',
  'perflogs',
  'config.msi',
  'msocache',
  '$windows.~bt',
  '$windows.~ws',
  '$winreagent',
])

const SYSTEM_FILES = new Set([
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'dumpstack.log',
  'dumpstack.log.tmp',
  'desktop.ini',
  'thumbs.db',
  'ntuser.dat',
])

const MARKER_NAMES = new Set([
  '.git',
  'package.json',
  'node_modules',
  'pyproject.toml',
  'cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  '.venv',
])

const MARKER_EXTS = new Set(['.sln', '.slnx', '.csproj'])

function key(p: string): string {
  const resolved = path.resolve(p)
  const trimmed = resolved.length > path.parse(resolved).root.length ? resolved.replace(/[\\/]+$/, '') : resolved
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

export function samePath(a: string, b: string): boolean {
  return key(a) === key(b)
}

export function isWithin(parent: string, child: string): boolean {
  const p = key(parent)
  const c = key(child)
  if (p === c) return true
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep)
}

export function isDriveRoot(p: string): boolean {
  const resolved = path.resolve(p)
  return resolved === path.parse(resolved).root
}

function segments(p: string): string[] {
  const resolved = path.resolve(p)
  return resolved.slice(path.parse(resolved).root.length).split(path.sep).filter(Boolean)
}

export function isExcludedDir(fullPath: string): boolean {
  const name = path.basename(fullPath).toLowerCase()
  if (EXCLUDED_ANYWHERE.has(name) || EXCLUDED_BELOW_ROOT.has(name)) return true
  return isDriveRoot(path.dirname(fullPath)) && SYSTEM_DIRS_AT_DRIVE_ROOT.has(name)
}

export function isSystemFile(name: string): boolean {
  return SYSTEM_FILES.has(name.toLowerCase())
}

/** Paths the app never moves anything from or to. */
export function isProtectedPath(p: string): boolean {
  const parts = segments(p).map((s) => s.toLowerCase())
  if (parts.length > 0 && SYSTEM_DIRS_AT_DRIVE_ROOT.has(parts[0])) return true
  return parts.some((s) => EXCLUDED_ANYWHERE.has(s))
}

/** A folder whose contents must not be separated: a project or a portable app. */
export function isAtomicFolder(entryNames: string[]): boolean {
  let hasExe = false
  let hasDll = false
  for (const raw of entryNames) {
    const name = raw.toLowerCase()
    if (MARKER_NAMES.has(name)) return true
    const ext = path.extname(name)
    if (MARKER_EXTS.has(ext)) return true
    if (ext === '.exe') hasExe = true
    else if (ext === '.dll') hasDll = true
  }
  return hasExe && hasDll
}

/** Reading file contents under OneDrive would download them from the cloud. */
export function isCloudPath(p: string, env: NodeJS.ProcessEnv = process.env): boolean {
  for (const name of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const value = env[name]
    if (value && isWithin(value, p)) return true
  }
  return segments(p).some((s) => /^onedrive( - .+)?$/i.test(s))
}
