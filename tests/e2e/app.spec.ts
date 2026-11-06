import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const SHOTS = process.env.MFILES_SHOTS ?? path.join('test-results', 'shots')

const FOLDERS = [
  'Pobrane',
  'Pobrane/Stare',
  'Pulpit',
  'Dokumenty/Praca',
  'Dokumenty/Dom',
  'Zdjęcia/Wakacje 2023',
  'Klienci/Kowalski',
  'Muzyka',
]
const KINDS = [
  ['pdf', 900],
  ['docx', 400],
  ['xlsx', 300],
  ['pptx', 800],
  ['jpg', 2400],
  ['png', 700],
  ['mp4', 9000],
  ['mp3', 3500],
  ['zip', 4000],
  ['ts', 60],
  ['exe', 5000],
  ['dat', 120],
] as const

async function buildFixture(root: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const [ext, size] = KINDS[i % KINDS.length]
    const folder = FOLDERS[(i * 7) % FOLDERS.length]
    const dir = path.join(root, folder)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `plik ${i}.${ext}`), Buffer.alloc(size + (i % 97) * 40, i % 251))
  }
  await writeFile(path.join(root, 'Pobrane', 'faktura.pdf'), 'taka sama treść faktury')
  await writeFile(path.join(root, 'Pulpit', 'faktura (kopia).pdf'), 'taka sama treść faktury')
  await mkdir(path.join(root, 'moj-projekt', '.git'), { recursive: true })
  await writeFile(path.join(root, 'moj-projekt', '.git', 'HEAD'), 'ref: main')
  await writeFile(path.join(root, 'moj-projekt', 'index.ts'), 'export {}')
}

async function fingerprint(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const walk = async (relative: string): Promise<void> => {
    for (const dirent of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const child = path.join(relative, dirent.name)
      if (dirent.isDirectory()) await walk(child)
      else
        result[child] = createHash('sha256')
          .update(await readFile(path.join(root, child)))
          .digest('hex')
    }
  }
  await walk('')
  return result
}

let app: ElectronApplication
let page: Page
let root: string
let userData: string
const problems: string[] = []

function launch(): Promise<ElectronApplication> {
  const executable = process.env.MFILES_EXE
  return electron.launch({
    ...(executable ? { executablePath: executable, args: [] } : { args: ['.'] }),
    env: { ...process.env, MFILES_USER_DATA: userData },
  })
}

test.beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mfiles-e2e-'))
  userData = await mkdtemp(path.join(tmpdir(), 'mfiles-e2e-data-'))
  await mkdir(SHOTS, { recursive: true })
  await buildFixture(root, 600)
  app = await launch()
  page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))
})

test.afterAll(async () => {
  await app?.close()
  await rm(root, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true })
})

test('full path: scan, plan, simulation, move, undo', async () => {
  const before = await fingerprint(root)

  await page.getByLabel('Folder path').fill(root)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.screenshot({ path: path.join(SHOTS, '1-start.png') })
  await page.getByRole('button', { name: 'Scan', exact: true }).click()

  await expect(page.getByTestId('scan-phase')).toHaveText('Scan finished', { timeout: 30000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(SHOTS, '2-skan.png') })
  const sceneBox = await page.getByTestId('scene').boundingBox()
  const panelBox = await page.locator('.panel').boundingBox()
  expect(sceneBox?.x).toBe(0)
  expect(sceneBox?.width).toBeGreaterThan((panelBox?.width ?? 0) * 1.5)
  const canvas = await page.locator('.scene canvas').boundingBox()
  expect(canvas?.width).toBeCloseTo(sceneBox?.width ?? 0, 0)
  await page.getByTestId('scene').click({ position: { x: (canvas?.width ?? 0) - 12, y: (canvas?.height ?? 0) - 12 } })
  await expect(page.getByRole('button', { name: '← Up' })).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(SHOTS, '2b-zoom.png') })
  await page.getByRole('button', { name: '← Up' }).click()

  await page.getByRole('button', { name: 'Plan the cleanup' }).click()
  await expect(page.getByTestId('plan-count')).not.toHaveText('0')
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(SHOTS, '3-plan.png') })
  expect(await fingerprint(root)).toEqual(before)

  await page.getByTestId('open-topics').click()
  const topicList = page.getByTestId('topic-list')
  await expect(topicList).toContainText('Klienci')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(SHOTS, '3b-tematy.png') })
  await topicList
    .getByRole('group', { name: 'Decision for Dokumenty\\Dom' })
    .getByRole('button', { name: 'Keep' })
    .click()
  await expect(page.getByTestId('plan-kept')).not.toHaveText('0')
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByTestId('group-list').getByRole('button').first().click()
  await expect(page.locator('.file-row').first()).toContainText('→')
  await page.screenshot({ path: path.join(SHOTS, '4-podglad-grupy.png') })
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'Show simulation' }).click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: path.join(SHOTS, '5-symulacja.png') })
  await expect(page.getByRole('button', { name: 'Show simulation' })).toBeEnabled({ timeout: 20000 })
  expect(await fingerprint(root)).toEqual(before)

  await page.getByRole('button', { name: /^Move \d/ }).click()
  await page.screenshot({ path: path.join(SHOTS, '6-potwierdzenie.png') })
  await page.getByRole('button', { name: 'Move files' }).click()
  await expect(page.getByTestId('summary-title')).toHaveText('Finished', { timeout: 60000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(SHOTS, '7-wynik.png') })

  const sorted = path.join(root, '_Sorted')
  const contents = await readdir(sorted)
  expect(contents).toEqual(expect.arrayContaining(['PDF', 'Video', 'Audio', 'Projects', 'Topics', '_Duplicates']))
  expect(contents.some((name) => name.startsWith('_Changes-') && name.endsWith('.csv'))).toBe(true)
  const year = String(new Date().getFullYear())
  await expect(stat(path.join(sorted, 'Projects', year, 'moj-projekt', '.git', 'HEAD'))).resolves.toBeDefined()

  const topicsDir = path.join(sorted, 'Topics')
  expect((await readdir(topicsDir)).sort()).toEqual(['Klienci', 'Praca', 'Wakacje 2023'])
  const clientFiles = Object.keys(before).filter((p) => p.startsWith(path.join('Klienci', path.sep)))
  expect(clientFiles.length).toBeGreaterThan(0)
  const moved = await fingerprint(path.join(topicsDir, 'Klienci'))
  for (const file of clientFiles) expect(moved[path.relative('Klienci', file)]).toBe(before[file])

  const keptFiles = await readdir(path.join(root, 'Dokumenty', 'Dom'))
  expect(keptFiles.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Undo everything' }).click()
  await expect(page.getByTestId('undo-result')).toContainText('Conflicts: 0', { timeout: 60000 })
  await page.screenshot({ path: path.join(SHOTS, '8-cofniete.png') })
  expect(await fingerprint(root)).toEqual(before)
  await expect(stat(sorted)).rejects.toThrow()

  expect(problems).toEqual([])
})

test('switching to Polish changes the interface and results, and survives a restart', async () => {
  const before = await fingerprint(root)
  await page.getByRole('button', { name: '← Start' }).click()

  await page.getByTestId('language-switch').getByRole('button', { name: 'PL' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl')
  await expect(page.getByRole('button', { name: 'Skanuj', exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(SHOTS, 'pl-1-start.png') })

  await page.getByLabel('Ścieżka folderu').fill(root)
  await page.getByRole('button', { name: 'Skanuj', exact: true }).click()
  await expect(page.getByTestId('scan-phase')).toHaveText('Skan zakończony', { timeout: 30000 })
  await page.getByRole('button', { name: 'Zaplanuj porządek' }).click()
  await expect(page.getByLabel('Folder docelowy')).toHaveValue(path.join(root, '_Posortowane'))
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(SHOTS, 'pl-2-plan.png') })

  await page.getByTestId('language-switch').getByRole('button', { name: 'EN' }).click()
  await expect(page.getByLabel('Target folder')).toHaveValue(path.join(root, '_Sorted'))
  await expect(page.getByTestId('group-list')).toContainText('Topics')
  await page.getByTestId('language-switch').getByRole('button', { name: 'PL' }).click()
  await expect(page.getByTestId('group-list')).toContainText('Tematy')

  await page.getByRole('button', { name: /^Przenieś \d/ }).click()
  await page.getByRole('button', { name: 'Przenieś pliki' }).click()
  await expect(page.getByTestId('summary-title')).toHaveText('Gotowe', { timeout: 60000 })
  const sorted = path.join(root, '_Posortowane')
  const contents = await readdir(sorted)
  expect(contents).toEqual(expect.arrayContaining(['Tematy', 'Wideo', '_Duplikaty']))
  expect(contents.some((name) => name.startsWith('_Spis-'))).toBe(true)

  await page.getByRole('button', { name: 'Cofnij wszystko' }).click()
  await expect(page.getByTestId('undo-result')).toContainText('Konflikty: 0', { timeout: 60000 })
  expect(await fingerprint(root)).toEqual(before)

  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl')
  await expect(page.getByRole('button', { name: 'Skanuj', exact: true })).toBeVisible()

  expect(problems).toEqual([])
})
