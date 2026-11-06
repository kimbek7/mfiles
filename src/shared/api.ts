import type {
  Category,
  Dimension,
  DuplicateGroup,
  FolderDecision,
  Plan,
  RunResult,
  ScanStats,
  SessionSummary,
  TreeTile,
  UndoResult,
} from '../core/types'

export type ScanPhase = 'walk' | 'enrich' | 'duplicates' | 'done' | 'cancelled'

export interface ScanProgress {
  phase: ScanPhase
  stats: ScanStats
  done: number
  total: number
  tiles: TreeTile[]
  duplicateGroups: number
  duplicateBytes: number
  mismatched: number
  cloud: boolean
}

export interface TileView {
  focus: string
  parent: string | null
  tiles: TreeTile[]
}

export type PlanView = Omit<Plan, 'moves'> & { moveCount: number; duplicateCount: number }

export interface PlanRequest {
  targetRoot: string
  dimensions: Dimension[]
  separateDuplicates: boolean
  folderDecisions: Record<string, FolderDecision>
}

export interface PlanFile {
  from: string
  to: string
  size: number
  category: Category
  duplicate: boolean
}

export interface PlanFilesPage {
  total: number
  items: PlanFile[]
}

export interface DuplicatesPage {
  total: number
  groups: DuplicateGroup[]
}

export const PARTICLE_STRIDE = 5

export interface FlowEvent {
  mode: 'real' | 'simulated'
  done: number
  total: number
  failed: number
  bytes: number
  /** Flat array: bucket, origin, category index, file size, bytes of the group the particle stands for. */
  particles: number[]
  finished: boolean
}

export interface UndoProgress {
  done: number
  total: number
}

export type WorkerEvents = {
  scan: ScanProgress
  flow: FlowEvent
  undo: UndoProgress
}

export type WorkerEvent = { [K in keyof WorkerEvents]: { event: K; payload: WorkerEvents[K] } }[keyof WorkerEvents]

export interface WorkerApi {
  scan(root: string): Promise<void>
  cancel(): Promise<void>
  tiles(focus?: string): Promise<TileView>
  plan(request: PlanRequest): Promise<PlanView>
  planFiles(planId: string, group: string | null, offset: number, limit: number): Promise<PlanFilesPage>
  duplicates(offset: number, limit: number): Promise<DuplicatesPage>
  setKeeper(hash: string, path: string): Promise<void>
  execute(planId: string): Promise<RunResult>
  simulate(planId: string): Promise<void>
  undo(sessionId: string): Promise<UndoResult>
  sessions(): Promise<SessionSummary[]>
}

export const WORKER_METHODS: (keyof WorkerApi)[] = [
  'scan',
  'cancel',
  'tiles',
  'plan',
  'planFiles',
  'duplicates',
  'setKeeper',
  'execute',
  'simulate',
  'undo',
  'sessions',
]

export interface DriveInfo {
  path: string
  totalBytes: number
  freeBytes: number
}

export interface MfilesBridge {
  call<M extends keyof WorkerApi>(method: M, ...args: Parameters<WorkerApi[M]>): ReturnType<WorkerApi[M]>
  pickFolder(): Promise<string | null>
  drives(): Promise<DriveInfo[]>
  reveal(path: string): Promise<void>
  onEvent(listener: (event: WorkerEvent) => void): () => void
}

export interface WorkerRequest {
  id: number
  method: keyof WorkerApi
  args: unknown[]
}

export type WorkerReply = { id: number; result?: unknown; error?: string }
