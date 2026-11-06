import { useMemo } from 'react'
import { outputLabels, pluralize, translate } from '../shared/i18n'
import type { Language, OutputLabels, PluralKey, TextKey } from '../shared/i18n'
import { formatCount } from './lib'
import { useApp } from './store'

export interface Translator {
  language: Language
  labels: OutputLabels
  t(key: TextKey, params?: Record<string, string | number>): string
  plural(key: PluralKey, count: number): string
}

export function useT(): Translator {
  const language = useApp((s) => s.language)
  return useMemo(
    () => ({
      language,
      labels: outputLabels(language),
      t: (key, params) => translate(language, key, params),
      plural: (key, count) => pluralize(language, key, count, formatCount(count)),
    }),
    [language],
  )
}
