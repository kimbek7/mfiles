import { CATEGORIES } from '../core/types'
import type { Category, MoveFailure, SessionStatus, SkipReason } from '../core/types'
import type { FlowEvent, MfilesBridge } from '../shared/api'

declare global {
  interface Window {
    mfiles: MfilesBridge
  }
}

export const api = (): MfilesBridge => window.mfiles

export const CATEGORY_COLORS: Record<Category, number> = {
  documents: 0x6ea8fe,
  spreadsheets: 0x5fcf9a,
  presentations: 0xf2a65a,
  pdf: 0xef6f6c,
  images: 0xc792ea,
  video: 0xf06fb0,
  audio: 0x39c6d6,
  archives: 0xd6b656,
  code: 0x8bd450,
  installers: 0xa0a7b4,
  projects: 0x8b90ff,
  topics: 0xf0ead6,
  other: 0x6b7480,
}

export const colorOfIndex = (index: number): number => CATEGORY_COLORS[CATEGORIES[index]] ?? CATEGORY_COLORS.other

export const cssColor = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`

const countFormat = new Intl.NumberFormat('pl-PL')
const decimalFormat = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })
const dateFormat = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })

export const formatCount = (value: number): string => countFormat.format(value)
export const formatDate = (ms: number): string => dateFormat.format(ms)

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${decimalFormat.format(value)} ${units[unit]}`
}

export const FAILURE_LABELS: Record<MoveFailure, string> = {
  changed: 'zmieniony po zbudowaniu planu',
  missing: 'plik już nie istnieje',
  locked: 'zablokowany przez inny program',
  collision: 'konflikt nazwy',
  protected: 'ścieżka chroniona',
  error: 'błąd',
}

export const SKIP_LABELS: Record<SkipReason, string> = {
  'root-is-project': 'wybrany folder jest projektem, więc nie zostanie rozbity',
  'target-inside-unit': 'folder docelowy leży wewnątrz tego projektu',
  protected: 'ścieżka chroniona',
}

export const STATUS_LABELS: Record<SessionStatus, string> = {
  completed: 'Zakończone',
  cancelled: 'Anulowane',
  interrupted: 'Przerwane',
  undone: 'Cofnięte',
  'partially-undone': 'Cofnięte częściowo',
}

type FlowListener = (event: FlowEvent) => void
const flowListeners = new Set<FlowListener>()

export const flowBus = {
  subscribe(listener: FlowListener): () => void {
    flowListeners.add(listener)
    return () => flowListeners.delete(listener)
  },
  publish(event: FlowEvent): void {
    for (const listener of flowListeners) listener(event)
  },
}
