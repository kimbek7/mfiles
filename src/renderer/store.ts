import { create } from 'zustand'
import type { Dimension, FolderDecision, RunResult, SessionSummary, TreeTile, UndoResult } from '../core/types'
import type { DriveInfo, FlowEvent, PlanView, ScanProgress, TileView, UndoProgress, WorkerEvent } from '../shared/api'
import { api, flowBus } from './lib'

export type Stage = 'start' | 'scan' | 'plan' | 'run' | 'summary'

interface PlanSettings {
  targetRoot: string
  dimensions: Dimension[]
  separateDuplicates: boolean
  folderDecisions: Record<string, FolderDecision>
}

interface AppState {
  stage: Stage
  root: string
  error: string | null
  drives: DriveInfo[]
  sessions: SessionSummary[]
  scan: ScanProgress | null
  focus: TileView | null
  plan: PlanView | null
  settings: PlanSettings
  flow: FlowEvent | null
  simulating: boolean
  run: RunResult | null
  undoing: UndoProgress | null
  undoResult: UndoResult | null
  init(): Promise<void>
  loadSessions(): Promise<void>
  startScan(root: string): Promise<void>
  cancel(): Promise<void>
  openTile(tile: TreeTile): Promise<void>
  focusUp(): Promise<void>
  goToPlan(): Promise<void>
  updateSettings(patch: Partial<PlanSettings>): Promise<void>
  setFolderDecision(path: string, decision: FolderDecision): Promise<void>
  rebuildPlan(): Promise<void>
  simulate(): Promise<void>
  execute(): Promise<void>
  undo(sessionId: string): Promise<void>
  backToStart(): void
  dismissError(): void
}

const TARGET_DIR = '_Posortowane'

function joinPath(root: string, name: string): string {
  return root.endsWith('\\') ? `${root}${name}` : `${root}\\${name}`
}

export const useApp = create<AppState>((set, get) => {
  const guard = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work()
    } catch (err) {
      set({ error: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  const handleEvent = (message: WorkerEvent): void => {
    if (message.event === 'scan') set({ scan: message.payload, focus: null })
    else if (message.event === 'undo') set({ undoing: message.payload })
    else {
      flowBus.publish(message.payload)
      set({ flow: message.payload })
    }
  }

  return {
    stage: 'start',
    root: '',
    error: null,
    drives: [],
    sessions: [],
    scan: null,
    focus: null,
    plan: null,
    settings: { targetRoot: '', dimensions: ['type', 'year'], separateDuplicates: true, folderDecisions: {} },
    flow: null,
    simulating: false,
    run: null,
    undoing: null,
    undoResult: null,

    init: () =>
      guard(async () => {
        api().onEvent(handleEvent)
        set({ drives: await api().drives() })
        await get().loadSessions()
      }),

    loadSessions: () =>
      guard(async () => {
        set({ sessions: await api().call('sessions') })
      }),

    startScan: (root) =>
      guard(async () => {
        const trimmed = root.trim().replace(/^"|"$/g, '')
        if (!trimmed) return
        set({
          stage: 'scan',
          root: trimmed,
          scan: null,
          focus: null,
          plan: null,
          flow: null,
          run: null,
          undoResult: null,
          settings: { ...get().settings, targetRoot: joinPath(trimmed, TARGET_DIR), folderDecisions: {} },
        })
        try {
          await api().call('scan', trimmed)
        } catch (err) {
          set({ stage: 'start' })
          throw err
        }
      }),

    cancel: () => guard(() => api().call('cancel')),

    openTile: (tile) =>
      guard(async () => {
        if (get().scan?.phase === 'done') set({ focus: await api().call('tiles', tile.path) })
      }),

    focusUp: () =>
      guard(async () => {
        const parent = get().focus?.parent
        if (parent) set({ focus: await api().call('tiles', parent) })
      }),

    goToPlan: () =>
      guard(async () => {
        await get().rebuildPlan()
        set({ stage: 'plan' })
      }),

    updateSettings: async (patch) => {
      set({ settings: { ...get().settings, ...patch } })
      await get().rebuildPlan()
    },

    setFolderDecision: (path, decision) =>
      get().updateSettings({ folderDecisions: { ...get().settings.folderDecisions, [path]: decision } }),

    rebuildPlan: () =>
      guard(async () => {
        set({ plan: await api().call('plan', get().settings) })
      }),

    simulate: () =>
      guard(async () => {
        const plan = get().plan
        if (!plan) return
        set({ simulating: true, flow: null })
        try {
          await api().call('simulate', plan.id)
        } finally {
          set({ simulating: false })
        }
      }),

    execute: () =>
      guard(async () => {
        const plan = get().plan
        if (!plan) return
        set({ stage: 'run', flow: null })
        try {
          const run = await api().call('execute', plan.id)
          set({ run, stage: 'summary' })
        } catch (err) {
          set({ stage: 'plan' })
          throw err
        } finally {
          await get().loadSessions()
        }
      }),

    undo: (sessionId) =>
      guard(async () => {
        set({ undoing: { done: 0, total: 0 }, undoResult: null })
        try {
          set({ undoResult: await api().call('undo', sessionId) })
        } finally {
          set({ undoing: null })
          await get().loadSessions()
        }
      }),

    backToStart: () => set({ stage: 'start', scan: null, plan: null, flow: null, run: null, undoResult: null }),
    dismissError: () => set({ error: null }),
  }
})
