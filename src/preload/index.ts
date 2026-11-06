import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { MfilesBridge, WorkerEvent } from '../shared/api'

const bridge: MfilesBridge = {
  call: ((method: string, ...args: unknown[]) => ipcRenderer.invoke('mfiles:call', method, args)) as MfilesBridge['call'],
  pickFolder: () => ipcRenderer.invoke('mfiles:pickFolder'),
  drives: () => ipcRenderer.invoke('mfiles:drives'),
  reveal: (target) => ipcRenderer.invoke('mfiles:reveal', target),
  onEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, message: WorkerEvent): void => listener(message)
    ipcRenderer.on('mfiles:event', handler)
    return () => ipcRenderer.removeListener('mfiles:event', handler)
  },
}

contextBridge.exposeInMainWorld('mfiles', bridge)
