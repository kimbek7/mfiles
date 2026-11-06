import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

// Regenerates docs/screenshots. MFILES_DEMO_ROOT should be a neutral path, because it is visible in the images.
const OUTPUT = process.env.MFILES_SCREENSHOTS
const ROOT = process.env.MFILES_DEMO_ROOT

test.skip(!OUTPUT || !ROOT, 'Runs only with MFILES_SCREENSHOTS and MFILES_DEMO_ROOT')

const KB = 1024
const FOLDERS: [string, string, number, number][] = [
  ['Downloads', 'mp4', 12, 90 * KB],
  ['Downloads', 'zip', 9, 60 * KB],
  ['Downloads', 'pdf', 14, 12 * KB],
  ['Downloads', 'exe', 6, 70 * KB],
  ['Downloads', 'jpg', 18, 14 * KB],
  ['Desktop', 'docx', 10, 9 * KB],
  ['Desktop', 'xlsx', 8, 11 * KB],
  ['Desktop', 'png', 12, 16 * KB],
  ['Desktop', 'mp3', 9, 24 * KB],
  ['New folder', 'pptx', 6, 30 * KB],
  ['New folder', 'txt', 12, 3 * KB],
  ['New folder', 'ts', 14, 2 * KB],
  ['Clients/Smith', 'pdf', 10, 16 * KB],
  ['Clients/Smith', 'docx', 6, 12 * KB],
  ['Clients/Baker', 'pdf', 7, 14 * KB],
  ['Holiday 2025', 'jpg', 40, 28 * KB],
  ['Holiday 2025', 'mp4', 4, 120 * KB],
  ['Invoices', 'pdf', 26, 6 * KB],
]

async function buildDemo(root: string): Promise<void> {
  let index = 0
  for (const [folder, ext, count, size] of FOLDERS) {
    await mkdir(path.join(root, folder), { recursive: true })
    for (let i = 0; i < count; i++) {
      const name = `${folder.split('/').pop()} ${++index}.${ext}`
      await writeFile(path.join(root, folder, name), Buffer.alloc(size + (index % 13) * 512, index % 251))
    }
  }
}

test('captures the README screenshots', async () => {
  const root = ROOT as string
  const output = OUTPUT as string
  const userData = path.join(tmpdir(), `mfiles-screenshots-${process.pid}`)
  await rm(root, { recursive: true, force: true })
  await buildDemo(root)
  await mkdir(output, { recursive: true })
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MFILES_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    await page.getByLabel('Folder path').fill(root)
    await page.getByRole('button', { name: 'Scan', exact: true }).click()
    await expect(page.getByTestId('scan-phase')).toHaveText('Scan finished', { timeout: 60000 })
    await page.waitForTimeout(900)
    await page.screenshot({ path: path.join(output, 'scan.png') })

    await page.getByRole('button', { name: 'Plan the cleanup' }).click()
    await expect(page.getByTestId('plan-count')).not.toHaveText('0')
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(output, 'plan.png') })

    await page.getByTestId('open-topics').click()
    await expect(page.getByTestId('topic-list')).toContainText('Clients')
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(output, 'topics.png') })
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: 'Show simulation' }).click()
    await page.waitForTimeout(3500)
    await page.screenshot({ path: path.join(output, 'sorting.png') })
    await expect(page.getByRole('button', { name: 'Show simulation' })).toBeEnabled({ timeout: 20000 })
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
