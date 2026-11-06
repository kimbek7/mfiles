import { statfs } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { WORKER_METHODS } from '../shared/api'
import { AppError } from '../shared/i18n'
import type { DriveInfo, WorkerApi, WorkerEvent, WorkerReply, WorkerRequest } from '../shared/api'

if (process.env.MFILES_USER_DATA) app.setPath('userData', process.env.MFILES_USER_DATA)

let window: BrowserWindow | null = null
let worker: Worker
let nextId = 1
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>()

function startWorker(): void {
  worker = new Worker(path.join(__dirname, 'worker.js'), {
    workerData: { journalDir: path.join(app.getPath('userData'), 'journal') },
  })
  worker.on('message', (message: WorkerReply | WorkerEvent) => {
    if ('event' in message) {
      window?.webContents.send('mfiles:event', message)
      return
    }
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    if (message.error !== undefined) call.reject(new Error(message.error))
    else call.resolve(message.result)
  })
  worker.on('error', (err) => {
    for (const call of pending.values()) call.reject(err)
    pending.clear()
    startWorker()
  })
}

function callWorker(method: keyof WorkerApi, args: unknown[]): Promise<unknown> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const request: WorkerRequest = { id, method, args }
    worker.postMessage(request)
  })
}

async function listDrives(): Promise<DriveInfo[]> {
  const drives: DriveInfo[] = []
  for (let code = 'C'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
    const drive = `${String.fromCharCode(code)}:\\`
    try {
      const info = await statfs(drive)
      drives.push({ path: drive, totalBytes: info.blocks * info.bsize, freeBytes: info.bavail * info.bsize })
    } catch {
      // No drive under this letter.
    }
  }
  return drives
}

function registerIpc(): void {
  ipcMain.handle('mfiles:call', (_event, method: keyof WorkerApi, args: unknown[]) => {
    if (!WORKER_METHODS.includes(method) || !Array.isArray(args)) throw new AppError('unknownOperation')
    return callWorker(method, args)
  })
  ipcMain.handle('mfiles:pickFolder', async (_event, title: unknown) => {
    const options = { title: String(title), properties: ['openDirectory' as const] }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('mfiles:drives', listDrives)
  ipcMain.handle('mfiles:reveal', (_event, target: unknown) => {
    if (typeof target === 'string' && path.isAbsolute(target)) shell.showItemInFolder(target)
  })
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1040,
    minHeight: 640,
    backgroundColor: '#0e1012',
    title: 'Mfiles',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.on('closed', () => {
    window = null
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(() => {
  startWorker()
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
