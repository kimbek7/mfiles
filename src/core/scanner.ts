import type { Dirent } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { categoryFromExt } from './classifier'
import { isAtomicFolder, isExcludedDir, isSystemFile } from './safety'
import type { FileEntry, ScanStats } from './types'
import { forEachLimit } from './util'

export function emptyStats(): ScanStats {
  return { files: 0, units: 0, dirs: 0, bytes: 0, errors: 0, skippedLinks: 0, skippedExcluded: 0 }
}

/**
 * Returns `link` only for real symlinks and junctions. Windows marks every reparse
 * point as a link, including plain cloud placeholder files.
 */
async function resolveDirent(fullPath: string, dirent: Dirent): Promise<'link' | 'dir' | 'file' | 'other'> {
  if (dirent.isSymbolicLink()) {
    const stat = await lstat(fullPath)
    if (stat.isSymbolicLink()) return 'link'
    return stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other'
  }
  return dirent.isDirectory() ? 'dir' : dirent.isFile() ? 'file' : 'other'
}

async function measureUnit(dir: string, signal?: AbortSignal): Promise<number> {
  let bytes = 0
  const stack = [dir]
  while (stack.length > 0 && !signal?.aborted) {
    const current = stack.pop() as string
    let dirents: Dirent[]
    try {
      dirents = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    await forEachLimit(dirents, 32, async (dirent) => {
      const full = path.join(current, dirent.name)
      try {
        const stat = await lstat(full)
        if (stat.isDirectory()) stack.push(full)
        else if (stat.isFile()) bytes += stat.size
      } catch {
        // An inaccessible file does not change the decision to move the whole folder.
      }
    })
  }
  return bytes
}

async function unitEntry(dir: string, signal?: AbortSignal): Promise<FileEntry> {
  const stat = await lstat(dir)
  return {
    path: dir,
    name: path.basename(dir) || dir,
    ext: '',
    size: await measureUnit(dir, signal),
    mtimeMs: stat.mtimeMs,
    kind: 'unit',
    category: 'projects',
  }
}

export interface ScanOptions {
  signal?: AbortSignal
  batchSize?: number
}

/** Streaming scan: follows no links and does not enter atomic units. */
export async function* scan(
  root: string,
  stats: ScanStats,
  options: ScanOptions = {},
): AsyncGenerator<FileEntry[], void, void> {
  const { signal, batchSize = 500 } = options
  const stack = [path.resolve(root)]
  let batch: FileEntry[] = []

  while (stack.length > 0) {
    if (signal?.aborted) return
    const dir = stack.pop() as string
    let dirents: Dirent[]
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      stats.errors++
      continue
    }
    stats.dirs++

    if (isAtomicFolder(dirents.map((d) => d.name))) {
      try {
        const unit = await unitEntry(dir, signal)
        stats.units++
        stats.bytes += unit.size
        batch.push(unit)
      } catch {
        stats.errors++
      }
    } else {
      await forEachLimit(
        dirents,
        32,
        async (dirent) => {
          const full = path.join(dir, dirent.name)
          try {
            const type = await resolveDirent(full, dirent)
            if (type === 'link') {
              stats.skippedLinks++
            } else if (type === 'dir') {
              if (isExcludedDir(full)) stats.skippedExcluded++
              else stack.push(full)
            } else if (type === 'file') {
              if (isSystemFile(dirent.name)) {
                stats.skippedExcluded++
                return
              }
              const stat = await lstat(full)
              const ext = path.extname(dirent.name).slice(1).toLowerCase()
              stats.files++
              stats.bytes += stat.size
              batch.push({
                path: full,
                name: dirent.name,
                ext,
                size: stat.size,
                mtimeMs: stat.mtimeMs,
                kind: 'file',
                category: categoryFromExt(ext),
              })
            }
          } catch {
            stats.errors++
          }
        },
        signal,
      )
    }

    if (batch.length >= batchSize) {
      yield batch
      batch = []
    }
  }
  if (batch.length > 0) yield batch
}
