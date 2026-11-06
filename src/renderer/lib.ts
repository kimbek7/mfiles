import { CATEGORIES } from '../core/types'
import type { Category } from '../core/types'
import type { FlowEvent, MfilesBridge } from '../shared/api'
import { DEFAULT_LANGUAGE } from '../shared/i18n'
import type { Language } from '../shared/i18n'

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

const LOCALES: Record<Language, string> = { en: 'en-GB', pl: 'pl-PL' }

function createFormats(language: Language) {
  const locale = LOCALES[language]
  return {
    count: new Intl.NumberFormat(locale),
    decimal: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
  }
}

let formats = createFormats(DEFAULT_LANGUAGE)

export function setFormatLanguage(language: Language): void {
  formats = createFormats(language)
}

export const formatCount = (value: number): string => formats.count.format(value)
export const formatDate = (ms: number): string => formats.date.format(ms)

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${formats.decimal.format(value)} ${units[unit]}`
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
