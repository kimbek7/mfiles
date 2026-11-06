import type { Language } from '../shared/i18n'

export const CATEGORIES = [
  'documents',
  'spreadsheets',
  'presentations',
  'pdf',
  'images',
  'video',
  'audio',
  'archives',
  'code',
  'installers',
  'projects',
  'topics',
  'other',
] as const

export type Category = (typeof CATEGORIES)[number]

export type EntryKind = 'file' | 'unit'

/** A file, or a folder treated as one indivisible item (project, portable app). */
export interface FileEntry {
  path: string
  name: string
  ext: string
  size: number
  mtimeMs: number
  kind: EntryKind
  category: Category
  takenAtMs?: number
  extMismatch?: boolean
  /** Saved page assets folder (`X_files`) that must end up next to its `X.html`. */
  companionOf?: string
}

export interface ScanStats {
  files: number
  units: number
  dirs: number
  bytes: number
  errors: number
  skippedLinks: number
  skippedExcluded: number
}

export interface DuplicateGroup {
  hash: string
  size: number
  paths: string[]
  keeper: string
}

export type Dimension = 'type' | 'year' | 'month' | 'size'

/** `whole`: the folder moves intact; `keep`: it stays in place; `split`: files are grouped and subfolders evaluated separately. */
export type FolderDecision = 'whole' | 'keep' | 'split'

export interface PlanOptions {
  root: string
  targetRoot: string
  dimensions: Dimension[]
  separateDuplicates: boolean
  folderDecisions?: Record<string, FolderDecision>
  language?: Language
}

export interface TopicInfo {
  path: string
  label: string
  relative: string
  files: number
  bytes: number
  categories: Category[]
  decision: FolderDecision
  auto: FolderDecision
}

export interface Move {
  id: number
  from: string
  to: string
  kind: EntryKind
  size: number
  mtimeMs: number
  category: Category
  group: string
  bucket: number
  origin: number
  duplicate: boolean
}

export type SkipReason = 'root-is-project' | 'target-inside-unit' | 'protected'

export interface PlanSkip {
  path: string
  reason: SkipReason
}

export interface GroupSummary {
  key: string
  count: number
  bytes: number
}

export interface BucketSummary {
  label: string
  count: number
  bytes: number
  category: Category | null
}

export interface OriginSummary {
  label: string
  count: number
  bytes: number
}

export interface Plan {
  id: string
  options: PlanOptions
  moves: Move[]
  groups: GroupSummary[]
  buckets: BucketSummary[]
  origins: OriginSummary[]
  skipped: PlanSkip[]
  alreadySorted: number
  totalBytes: number
  topics: TopicInfo[]
  kept: number
}

export type MoveFailure = 'changed' | 'missing' | 'locked' | 'collision' | 'protected' | 'error'

export interface RunResult {
  sessionId: string
  moved: number
  failed: { path: string; reason: MoveFailure; detail?: string }[]
  cancelled: boolean
  manifest?: string
}

export type SessionStatus = 'completed' | 'cancelled' | 'interrupted' | 'undone' | 'partially-undone'

export interface SessionSummary {
  id: string
  root: string
  targetRoot: string
  startedAt: number
  moved: number
  pending: number
  status: SessionStatus
}

export interface UndoResult {
  restored: number
  conflicts: { from: string; to: string; reason: string }[]
  lost: string[]
}

export interface TreeTile {
  path: string
  /** Real name of a folder or project; `loose` and `rest` tiles get theirs from the UI language. */
  label: string
  kind: 'dir' | 'unit' | 'loose' | 'rest'
  category?: Category
  restCount?: number
  bytes: number
  files: number
  isDir: boolean
  byCategory: Partial<Record<Category, number>>
}
