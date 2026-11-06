import { mkdir, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeContext, isGenericFolderName } from '../../src/core/context'
import { executePlan, undoSession } from '../../src/core/executor'
import { findDuplicates } from '../../src/core/duplicates'
import { buildPlan } from '../../src/core/planner'
import { outputLabels } from '../../src/shared/i18n'
import { emptyStats, scan } from '../../src/core/scanner'
import type { FileEntry, FolderDecision, Plan } from '../../src/core/types'
import { snapshot, tempDir, writeTree } from './helpers'

const DEFAULT_TARGET_DIR = outputLabels('pl').targetDir

function entry(relative: string, root = 'C:\\r', size = 10): FileEntry {
  const full = path.join(root, relative)
  const name = path.basename(full)
  const ext = path.extname(name).slice(1)
  return { path: full, name, ext, size, mtimeMs: 1_700_000_000_000, kind: 'file', category: 'documents' }
}

function plan(entries: FileEntry[], decisions?: Record<string, FolderDecision>, root = 'C:\\r'): Plan {
  return buildPlan(entries, [], {
    root,
    targetRoot: path.join(root, DEFAULT_TARGET_DIR),
    dimensions: ['type'],
    separateDuplicates: true,
    folderDecisions: decisions,
    language: 'pl',
  })
}

const relativeTo = (p: Plan, move: Plan['moves'][number]): string => path.relative(p.options.targetRoot, move.to)

describe('isGenericFolderName', () => {
  it.each([
    'Pobrane',
    'DOWNLOADS',
    'Nowy folder',
    'New folder (2)',
    'Dokumenty - kopia',
    'Zdjęcia',
    '20240112',
    'DCIM',
  ])('%s is a generic name', (name) => expect(isGenericFolderName(name)).toBe(true))

  it('recognizes generated identifiers', () => {
    expect(isGenericFolderName('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true)
    expect(isGenericFolderName('a94a8fe5ccb19ba61c4c0873d391e987')).toBe(true)
  })

  it.each(['Klienci', 'Wakacje 2023', 'Faktury', 'Sprawa Kowalski', '2023-05 Ślub'])('%s carries context', (name) =>
    expect(isGenericFolderName(name)).toBe(false),
  )
})

describe('analyzeContext', () => {
  it('the topmost meaningful folder becomes a topic and a generic one is split', () => {
    const result = analyzeContext(
      [entry('Klienci\\Kowalski\\umowa.pdf'), entry('Pobrane\\faktura.pdf'), entry('Pobrane\\Sprawa X\\pismo.pdf')],
      'C:\\r',
      'C:\\r\\_S',
    )
    expect(result.wholeFolders.map((e) => e.name).sort()).toEqual(['Klienci', 'Sprawa X'])
    expect(result.loose.map((e) => e.name)).toEqual(['faktura.pdf'])
    expect(result.pinned.has('C:\\r\\Klienci\\Kowalski\\umowa.pdf')).toBe(true)
  })

  it('splitting a topic reveals its subfolders', () => {
    const entries = [
      entry('Klienci\\Kowalski\\umowa.pdf'),
      entry('Klienci\\Nowak\\pismo.pdf'),
      entry('Klienci\\lista.xlsx'),
    ]
    const result = analyzeContext(entries, 'C:\\r', 'C:\\r\\_S', { 'C:\\r\\Klienci': 'split' })
    expect(result.wholeFolders.map((e) => e.name).sort()).toEqual(['Kowalski', 'Nowak'])
    expect(result.loose.map((e) => e.name)).toEqual(['lista.xlsx'])
    const topic = result.topics.find((t) => t.label === 'Klienci')
    expect(topic).toMatchObject({ decision: 'split', auto: 'whole', files: 3 })
  })

  it('the user can mark a generic folder as a topic or keep it in place', () => {
    const entries = [entry('Pobrane\\a.pdf'), entry('Stare\\b.pdf')]
    const result = analyzeContext(entries, 'C:\\r', 'C:\\r\\_S', { 'C:\\r\\Pobrane': 'whole', 'C:\\r\\Stare': 'keep' })
    expect(result.wholeFolders.map((e) => e.name)).toEqual(['Pobrane'])
    expect(result.kept).toBe(1)
    expect(result.loose).toEqual([])
  })

  it('topics stay in place by default for a whole drive', () => {
    const result = analyzeContext([entry('Games\\gra.dat', 'D:\\'), entry('faktura.pdf', 'D:\\')], 'D:\\', 'D:\\_S')
    expect(result.wholeFolders).toEqual([])
    expect(result.kept).toBe(1)
    expect(result.loose.map((e) => e.name)).toEqual(['faktura.pdf'])
  })

  it('user account folders are not topics but their contents are evaluated', () => {
    const result = analyzeContext([entry('Users\\Anna\\Praca\\raport.pdf')], 'C:\\r', 'C:\\r\\_S')
    expect(result.wholeFolders.map((e) => e.name)).toEqual(['Praca'])
  })

  it('a topic containing the target folder is split', () => {
    const result = analyzeContext([entry('Praca\\raport.pdf')], 'C:\\r', 'C:\\r\\Praca\\_S')
    expect(result.wholeFolders).toEqual([])
    expect(result.loose.map((e) => e.name)).toEqual(['raport.pdf'])
  })
})

describe('planner with context', () => {
  it('lays out the target as agreed: topics whole, loose files by type', () => {
    const p = plan([
      entry('Klienci\\Kowalski\\umowa.pdf'),
      entry('Pobrane\\faktura.pdf'),
      entry('Pobrane\\Sprawa X\\pismo.pdf'),
    ])
    expect(p.moves.map((m) => relativeTo(p, m)).sort()).toEqual(
      ['Dokumenty\\faktura.pdf', 'Tematy\\Klienci', 'Tematy\\Sprawa X'].sort(),
    )
    expect(p.buckets.find((b) => b.label === 'Tematy')?.category).toBe('topics')
  })

  it('keep folders create no moves', () => {
    const p = plan([entry('Praca\\raport.pdf'), entry('a.txt')], { 'C:\\r\\Praca': 'keep' })
    expect(p.moves.map((m) => m.from)).toEqual(['C:\\r\\a.txt'])
    expect(p.kept).toBe(1)
  })

  it('subtitles and metadata follow the main file, also after a rename', () => {
    const video = { ...entry('Pobrane\\film.mp4', 'C:\\r', 900), category: 'video' as const }
    const other = { ...entry('Temp\\film.mp4', 'C:\\r', 900), category: 'video' as const }
    const subtitles = entry('Temp\\film.pl.srt')
    const photo = { ...entry('Pobrane\\foto.jpg'), category: 'images' as const }
    const xmp = entry('Pobrane\\foto.jpg.xmp')
    const p = plan([video, subtitles, other, photo, xmp])
    const to = (from: FileEntry): string =>
      relativeTo(p, p.moves.find((m) => m.from === from.path) as Plan['moves'][number])
    expect(to(video)).toBe('Wideo\\film.mp4')
    expect(to(other)).toBe('Wideo\\film (2).mp4')
    expect(to(subtitles)).toBe('Wideo\\film (2).pl.srt')
    expect(to(xmp)).toBe('Zdjęcia\\foto.jpg.xmp')
  })

  it('a page assets folder stays next to its page', () => {
    const page = { ...entry('Pobrane\\strona.html'), ext: 'html', category: 'code' as const }
    const p = plan([page, entry('Pobrane\\strona_files\\styl.css')])
    expect(p.moves.map((m) => relativeTo(p, m)).sort()).toEqual(['Kod\\strona.html', 'Kod\\strona_files'].sort())
  })

  it('a loose duplicate yields to a copy in a topic and the topic loses nothing', () => {
    const inTopic = entry('Sprawa\\umowa.pdf')
    const loose = { ...entry('Pobrane\\umowa.pdf'), mtimeMs: 1 }
    const p = buildPlan(
      [inTopic, loose],
      [{ hash: 'h', size: 10, paths: [inTopic.path, loose.path], keeper: loose.path }],
      { root: 'C:\\r', targetRoot: 'C:\\r\\_S', dimensions: ['type'], separateDuplicates: true },
    )
    expect(p.moves.find((m) => m.from === loose.path)?.duplicate).toBe(true)
    expect(p.moves.find((m) => m.from === 'C:\\r\\Sprawa')?.duplicate).toBe(false)
    expect(p.moves.some((m) => m.from === inTopic.path)).toBe(false)
  })
})

describe('sorting with topics on disk', () => {
  async function prepare(root: string): Promise<Plan> {
    const entries: FileEntry[] = []
    for await (const batch of scan(root, emptyStats())) entries.push(...batch)
    return buildPlan(entries, await findDuplicates(entries), {
      root,
      targetRoot: path.join(root, DEFAULT_TARGET_DIR),
      dimensions: ['type', 'year'],
      separateDuplicates: true,
      language: 'pl',
    })
  }

  const TREE = {
    'Klienci/Kowalski/umowa.pdf': 'umowa',
    'Klienci/Kowalski/skan.jpg': 'skan',
    'Klienci/Nowak/podkatalog/notatka.txt': 'notatka',
    'Pobrane/faktura.pdf': 'faktura',
    'Pobrane/film.mp4': 'film',
    'Pobrane/film.srt': 'napisy',
    'Pulpit/umowa-kopia.pdf': 'umowa',
  }

  it('topic contents are identical before and after, the manifest records origins, undo restores the start', async () => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, TREE)
    await mkdir(path.join(root, 'Klienci', 'Kowalski', 'pusty'))
    const before = await snapshot(root)
    const insideBefore = await snapshot(path.join(root, 'Klienci'))

    const run = await executePlan(await prepare(root), { journalDir })
    expect(run.failed).toEqual([])
    const sorted = path.join(root, DEFAULT_TARGET_DIR)
    expect(await snapshot(path.join(sorted, 'Tematy', 'Klienci'))).toEqual(insideBefore)
    await expect(readFile(path.join(sorted, '_Duplikaty', 'PDF', 'umowa-kopia.pdf'), 'utf8')).resolves.toBe('umowa')
    const year = String(new Date().getFullYear())
    expect((await readdir(path.join(sorted, 'Wideo', year))).sort()).toEqual(['film.mp4', 'film.srt'])

    const csv = await readFile(run.manifest as string, 'utf8')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('"Skąd";"Dokąd"')
    expect(csv).toContain(path.join(root, 'Pulpit', 'umowa-kopia.pdf'))

    const undo = await undoSession(run.sessionId, { journalDir })
    expect(undo.conflicts).toEqual([])
    expect(await snapshot(root)).toEqual(before)
  })
})
