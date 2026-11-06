import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const FILES = Number(process.env.MFILES_PERF ?? 0)
const EXTS = ['pdf', 'jpg', 'mp3', 'mp4', 'zip', 'docx', 'xlsx', 'ts']

test.skip(FILES === 0, 'Runs only with MFILES_PERF=<file count>')

async function createFiles(root: string): Promise<void> {
  const dirs = Array.from({ length: 60 }, (_, i) => path.join(root, `New folder (${i % 12})`, `Temp (${i})`))
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })))
  const chunk = 200
  for (let start = 0; start < FILES; start += chunk) {
    const writes: Promise<void>[] = []
    for (let i = start; i < Math.min(start + chunk, FILES); i++) {
      writes.push(writeFile(path.join(dirs[i % dirs.length], `p${i}.${EXTS[i % EXTS.length]}`), String(i)))
    }
    await Promise.all(writes)
  }
}

test('scanning and moving many files does not block the interface', async () => {
  test.setTimeout(900000)
  const root = await mkdtemp(path.join(tmpdir(), 'mfiles-perf-'))
  const userData = await mkdtemp(path.join(tmpdir(), 'mfiles-perf-data-'))
  await createFiles(root)
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MFILES_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    await page.getByLabel('Folder path').fill(root)

    const startFrames = (): Promise<void> =>
      page.evaluate(() => {
        const frames: number[] = []
        ;(window as unknown as { frames_: number[] }).frames_ = frames
        const tick = (now: number): void => {
          frames.push(now)
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
    const readFrames = (): Promise<{ fps: number; worstMs: number }> =>
      page.evaluate(() => {
        const frames = (window as unknown as { frames_: number[] }).frames_.splice(0)
        const gaps = frames.slice(1).map((t, i) => t - frames[i])
        const total = frames[frames.length - 1] - frames[0]
        return { fps: Math.round((gaps.length / total) * 1000), worstMs: Math.round(Math.max(...gaps)) }
      })

    await startFrames()
    const scanStart = Date.now()
    await page.getByRole('button', { name: 'Scan', exact: true }).click()
    await expect(page.getByTestId('scan-phase')).toHaveText('Scan finished', { timeout: 300000 })
    const scanMs = Date.now() - scanStart
    const scanFrames = await readFrames()

    await page.getByRole('button', { name: 'Plan the cleanup' }).click()
    await page.getByRole('button', { name: /^Move \d/ }).click()
    await page.getByRole('button', { name: 'Move files' }).click()
    const runStart = Date.now()
    await page.waitForTimeout(1500)
    await readFrames()
    await expect(page.getByTestId('summary-title')).toHaveText('Finished', { timeout: 600000 })
    const runMs = Date.now() - runStart
    const runFrames = await readFrames()

    console.log(JSON.stringify({ files: FILES, scanMs, scanFrames, runMs, runFrames }))
    expect(scanFrames.fps).toBeGreaterThan(30)
    expect(runFrames.fps).toBeGreaterThan(30)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
