import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'

const created: string[] = []

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mfiles-test-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

export async function writeTree(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content)
  }
}

/** Full picture of a tree: folder paths, file hashes and modification times. */
export async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const walk = async (relative: string): Promise<void> => {
    for (const dirent of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const child = path.join(relative, dirent.name)
      if (dirent.isDirectory()) {
        result[`${child}/`] = 'dir'
        await walk(child)
      } else {
        const full = path.join(root, child)
        const hash = createHash('sha256')
          .update(await readFile(full))
          .digest('hex')
        result[child] = `${hash}:${Math.round((await stat(full)).mtimeMs)}`
      }
    }
  }
  await walk('')
  return result
}
