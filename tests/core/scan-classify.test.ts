import { symlink, utimes } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { categoryFromExt, enrichEntries } from '../../src/core/classifier'
import { findDuplicates } from '../../src/core/duplicates'
import { isAtomicFolder, isCloudPath, isExcludedDir, isProtectedPath, isWithin } from '../../src/core/safety'
import { emptyStats, scan } from '../../src/core/scanner'
import { TreeIndex } from '../../src/core/tree'
import type { FileEntry } from '../../src/core/types'
import { tempDir, writeTree } from './helpers'

async function scanAll(root: string): Promise<{ entries: FileEntry[]; stats: ReturnType<typeof emptyStats> }> {
  const stats = emptyStats()
  const entries: FileEntry[] = []
  for await (const batch of scan(root, stats, { batchSize: 2 })) entries.push(...batch)
  return { entries, stats }
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'latin1')

/** Minimal JPEG with an EXIF block holding only DateTimeOriginal. */
function jpegWithExif(date: string): Buffer {
  const value = Buffer.from(`${date}\0`, 'ascii')
  const tiff = Buffer.alloc(44)
  tiff.write('II', 0, 'ascii')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4)
  tiff.writeUInt16LE(1, 8)
  tiff.writeUInt16LE(0x8769, 10)
  tiff.writeUInt16LE(4, 12)
  tiff.writeUInt32LE(1, 14)
  tiff.writeUInt32LE(26, 18)
  tiff.writeUInt32LE(0, 22)
  tiff.writeUInt16LE(1, 26)
  tiff.writeUInt16LE(0x9003, 28)
  tiff.writeUInt16LE(2, 30)
  tiff.writeUInt32LE(value.length, 32)
  tiff.writeUInt32LE(44, 36)
  tiff.writeUInt32LE(0, 40)
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, value])
  const header = Buffer.alloc(4)
  header.writeUInt16BE(0xffe1, 0)
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), header, payload, Buffer.from([0xff, 0xd9])])
}

describe('safety', () => {
  it('detects path containment without false prefix matches', () => {
    expect(isWithin('C:\\a\\b', 'c:\\A\\B\\c.txt')).toBe(true)
    expect(isWithin('C:\\a\\b', 'C:\\a\\bc\\d.txt')).toBe(false)
    expect(isWithin('C:\\', 'C:\\x')).toBe(true)
  })

  it('protects system folders but not a same-named folder deeper down', () => {
    expect(isProtectedPath('C:\\Windows\\System32\\a.dll')).toBe(true)
    expect(isProtectedPath('C:\\Program Files\\App\\a.exe')).toBe(true)
    expect(isProtectedPath('D:\\$Recycle.Bin\\x')).toBe(true)
    expect(isProtectedPath('C:\\Users\\a\\Windows\\x.txt')).toBe(false)
    expect(isExcludedDir('C:\\Windows')).toBe(true)
    expect(isExcludedDir('D:\\zdjecia\\Windows')).toBe(false)
    expect(isExcludedDir('C:\\Users\\a\\AppData')).toBe(true)
  })

  it('detects atomic units', () => {
    expect(isAtomicFolder(['src', '.git'])).toBe(true)
    expect(isAtomicFolder(['Program.cs', 'App.csproj'])).toBe(true)
    expect(isAtomicFolder(['app.exe', 'lib.dll'])).toBe(true)
    expect(isAtomicFolder(['setup.exe', 'notatki.txt'])).toBe(false)
  })

  it('detects OneDrive paths', () => {
    expect(isCloudPath('C:\\Users\\a\\OneDrive\\x.txt', {})).toBe(true)
    expect(isCloudPath('C:\\Users\\a\\OneDrive - Firma\\x.txt', {})).toBe(true)
    expect(isCloudPath('D:\\Sync\\x.txt', { OneDrive: 'D:\\Sync' })).toBe(true)
    expect(isCloudPath('C:\\Users\\a\\Pulpit\\x.txt', {})).toBe(false)
  })
})

describe('scan', () => {
  it('returns files, unicode names and long paths', async () => {
    const root = await tempDir()
    const long = Array.from({ length: 8 }, () => 'd'.repeat(40)).join('/')
    await writeTree(root, {
      'zażółć gęślą jaźń.txt': 'a',
      'folder ze spacją/plik 1.pdf': 'bb',
      [`${long}/głęboki.mp3`]: 'ccc',
      'bez-rozszerzenia': 'd',
    })
    const { entries, stats } = await scanAll(root)
    expect(entries.map((e) => e.name).sort()).toEqual(
      ['bez-rozszerzenia', 'głęboki.mp3', 'plik 1.pdf', 'zażółć gęślą jaźń.txt'].sort(),
    )
    expect(stats.bytes).toBe(7)
    expect(entries.find((e) => e.name === 'głęboki.mp3')?.path.length).toBeGreaterThan(260)
  })

  it('treats a project as a whole and does not enter it', async () => {
    const root = await tempDir()
    await writeTree(root, { 'app/.git/HEAD': 'ref', 'app/src/main.ts': 'x'.repeat(10), 'a.txt': 'a' })
    const { entries } = await scanAll(root)
    const unit = entries.find((e) => e.kind === 'unit')
    expect(unit?.name).toBe('app')
    expect(unit?.category).toBe('projects')
    expect(unit?.size).toBe(13)
    expect(entries).toHaveLength(2)
  })

  it('does not follow junctions and symlinks', async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await writeTree(outside, { 'tajny.txt': 'x' })
    await writeTree(root, { 'a.txt': 'a' })
    await symlink(outside, path.join(root, 'junction'), 'junction')
    const { entries, stats } = await scanAll(root)
    expect(entries.map((e) => e.name)).toEqual(['a.txt'])
    expect(stats.skippedLinks).toBe(1)
  })

  it('skips system files and AppData', async () => {
    const root = await tempDir()
    await writeTree(root, { 'desktop.ini': 'x', 'Thumbs.db': 'x', 'AppData/x.txt': 'x', 'a.txt': 'a' })
    const { entries } = await scanAll(root)
    expect(entries.map((e) => e.name)).toEqual(['a.txt'])
  })
})

describe('classifier', () => {
  it('classifies by extension regardless of case', () => {
    expect(categoryFromExt('PDF')).toBe('pdf')
    expect(categoryFromExt('docx')).toBe('documents')
    expect(categoryFromExt('xyz')).toBe('other')
  })

  it('detects a false extension and a file without one', async () => {
    const root = await tempDir()
    await writeTree(root, { 'to-nie-tekst.txt': PNG, faktura: PDF })
    const { entries } = await scanAll(root)
    await enrichEntries(entries)
    const fake = entries.find((e) => e.name === 'to-nie-tekst.txt')
    expect(fake?.category).toBe('images')
    expect(fake?.extMismatch).toBe(true)
    expect(entries.find((e) => e.name === 'faktura')?.category).toBe('pdf')
  })

  it('does not mistake docx for a zip archive', async () => {
    const root = await tempDir()
    await writeTree(root, { 'a.docx': Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(100)]) })
    const { entries } = await scanAll(root)
    await enrichEntries(entries)
    expect(entries[0].category).toBe('documents')
  })

  it('reads the capture date from EXIF', async () => {
    const root = await tempDir()
    await writeTree(root, { 'foto.jpg': jpegWithExif('2019:07:21 10:30:00') })
    const { entries } = await scanAll(root)
    await enrichEntries(entries)
    expect(new Date(entries[0].takenAtMs as number).getFullYear()).toBe(2019)
  })
})

describe('duplicates', () => {
  it('tells apart files differing only past the first 64 KB', async () => {
    const root = await tempDir()
    const base = Buffer.alloc(100 * 1024, 7)
    const other = Buffer.from(base)
    other[90 * 1024] = 8
    await writeTree(root, { 'a.bin': base, 'b.bin': base, 'c.bin': other, 'd.txt': 'x', 'e.txt': 'y' })
    const { entries } = await scanAll(root)
    const groups = await findDuplicates(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0].paths.map((p) => path.basename(p)).sort()).toEqual(['a.bin', 'b.bin'])
  })

  it('keeps the oldest copy and ignores empty files', async () => {
    const root = await tempDir()
    await writeTree(root, { 'nowy.txt': 'tresc', 'stary.txt': 'tresc', 'p1.txt': '', 'p2.txt': '' })
    await utimes(path.join(root, 'stary.txt'), new Date(2001, 0, 1), new Date(2001, 0, 1))
    const { entries } = await scanAll(root)
    const groups = await findDuplicates(entries)
    expect(groups).toHaveLength(1)
    expect(path.basename(groups[0].keeper)).toBe('stary.txt')
  })

  it('does not read files excluded by skipContent', async () => {
    const root = await tempDir()
    await writeTree(root, { 'a.txt': 'tresc', 'b.txt': 'tresc' })
    const { entries } = await scanAll(root)
    expect(await findDuplicates(entries, { skipContent: () => true })).toEqual([])
  })
})

describe('TreeIndex', () => {
  it('sums folders and merges excess tiles', async () => {
    const root = await tempDir()
    await writeTree(root, { 'a/b/1.pdf': '123', 'a/2.txt': '1', '3.mp3': '12' })
    const { entries } = await scanAll(root)
    const index = new TreeIndex(root)
    entries.forEach((e) => index.add(e))
    const tiles = index.tiles()
    expect(tiles.find((t) => t.label === 'a')).toMatchObject({ bytes: 4, files: 2, isDir: true })
    expect(tiles.find((t) => t.category === 'audio')).toMatchObject({ bytes: 2, isDir: false, kind: 'loose' })
    expect(
      index
        .tiles(path.join(root, 'a'))
        .map((t) => t.kind)
        .sort(),
    ).toEqual(['dir', 'loose'])
    expect(index.tiles(root, 1)[0]).toMatchObject({ kind: 'rest', restCount: 2 })
  })
})
