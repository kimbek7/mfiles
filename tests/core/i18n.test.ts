import { readdirSync, readFileSync, statSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { executePlan, undoSession } from '../../src/core/executor'
import { buildPlan } from '../../src/core/planner'
import { emptyStats, scan } from '../../src/core/scanner'
import { CATEGORIES } from '../../src/core/types'
import type { FileEntry, Plan } from '../../src/core/types'
import {
  AppError,
  dictionaries,
  localizeError,
  outputLabels,
  pluralDictionaries,
  pluralize,
  translate,
} from '../../src/shared/i18n'
import type { Language } from '../../src/shared/i18n'
import { snapshot, tempDir, writeTree } from './helpers'

const params = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort()

async function prepare(root: string, language: Language): Promise<Plan> {
  const entries: FileEntry[] = []
  for await (const batch of scan(root, emptyStats())) entries.push(...batch)
  return buildPlan(entries, [], {
    root,
    targetRoot: path.join(root, outputLabels(language).targetDir),
    dimensions: ['type'],
    separateDuplicates: true,
    language,
  })
}

describe('dictionaries', () => {
  it('have the same keys and placeholders in both languages', () => {
    expect(Object.keys(dictionaries.pl).sort()).toEqual(Object.keys(dictionaries.en).sort())
    for (const key of Object.keys(dictionaries.en) as (keyof typeof dictionaries.en)[]) {
      expect(dictionaries.pl[key].length, key).toBeGreaterThan(0)
      expect(params(dictionaries.pl[key]), key).toEqual(params(dictionaries.en[key]))
    }
  })

  it('cover every category in output labels', () => {
    for (const language of ['en', 'pl'] as const) {
      for (const category of CATEGORIES) expect(outputLabels(language).categories[category]).toBeTruthy()
    }
  })

  it('include {count} in every plural form', () => {
    for (const forms of Object.values(pluralDictionaries.pl)) {
      for (const form of Object.values(forms)) expect(form).toContain('{count}')
    }
  })
})

describe('translate', () => {
  it('fills parameters', () => {
    expect(translate('en', 'start.driveFree', { free: '1 GB', total: '2 GB' })).toBe('1 GB free of 2 GB')
  })

  it.each([
    [1, '1 plik'],
    [2, '2 pliki'],
    [5, '5 plików'],
    [12, '12 plików'],
    [22, '22 pliki'],
    [25, '25 plików'],
  ])('uses the right Polish plural for %i', (count, expected) => {
    expect(pluralize('pl', 'files', count)).toBe(expected)
  })

  it('uses English plurals', () => {
    expect(pluralize('en', 'files', 1)).toBe('1 file')
    expect(pluralize('en', 'files', 2)).toBe('2 files')
  })
})

describe('localizeError', () => {
  it('translates error codes, also when wrapped by Electron IPC', () => {
    const wrapped = `Error invoking remote method 'mfiles:call': Error: ${new AppError('folderMissing', 'C:\\x').message}`
    expect(localizeError(wrapped, 'en')).toBe('Folder does not exist: C:\\x')
    expect(localizeError(wrapped, 'pl')).toBe('Folder nie istnieje: C:\\x')
  })

  it('passes other messages through without the IPC prefix', () => {
    expect(localizeError("Error invoking remote method 'x': Error: EACCES", 'en')).toBe('EACCES')
  })
})

describe('language of the results', () => {
  const TREE = { 'Klienci/umowa.pdf': 'a', 'Pobrane/faktura.pdf': 'b', 'Pobrane/kopia.pdf': 'b' }

  it('names folders in the chosen language', async () => {
    const root = await tempDir()
    await writeTree(root, { 'Temp/a.mp4': 'x' })
    const english = (await prepare(root, 'en')).moves[0].to
    const polish = (await prepare(root, 'pl')).moves[0].to
    expect(path.relative(root, english)).toMatch(/^_Sorted[\\/]Video/)
    expect(path.relative(root, polish)).toMatch(/^_Posortowane[\\/]Wideo/)
  })

  it.each([
    ['en', 'pl'],
    ['pl', 'en'],
  ] as const)('leaves %s results alone when planning in %s', async (first, second) => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, TREE)
    await executePlan(await prepare(root, first), { journalDir })

    const next = await prepare(root, second)
    expect(next.moves).toEqual([])
    expect(next.alreadySorted).toBeGreaterThan(0)
    expect(next.topics).toEqual([])
  })

  it.each([
    ['en', '_Changes-', '"From";"To"'],
    ['pl', '_Spis-', '"Skąd";"Dokąd"'],
  ] as const)('writes the %s change list and undo removes it', async (language, prefix, header) => {
    const root = await tempDir()
    const journalDir = await tempDir()
    await writeTree(root, TREE)
    const before = await snapshot(root)

    const run = await executePlan(await prepare(root, language), { journalDir })
    expect(path.basename(run.manifest as string).startsWith(prefix)).toBe(true)
    await expect(readFile(run.manifest as string, 'utf8')).resolves.toContain(header)

    await undoSession(run.sessionId, { journalDir })
    await expect(stat(run.manifest as string)).rejects.toThrow()
    expect(await snapshot(root)).toEqual(before)
    expect(await readdir(root)).not.toContain(outputLabels(language).targetDir)
  })
})

describe('hardcoded text', () => {
  const POLISH_LETTERS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/
  const NAME_LISTS = new Set(['context.ts'])

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) return sourceFiles(full)
      return /\.tsx?$/.test(name) && !NAME_LISTS.has(name) ? [full] : []
    })
  }

  it('keeps Polish out of the code outside the dictionary', () => {
    const offenders = ['src/core', 'src/main', 'src/preload', 'src/renderer']
      .flatMap(sourceFiles)
      .filter((file) => POLISH_LETTERS.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
