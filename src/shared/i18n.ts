import type { Category } from '../core/types'

export type Language = 'en' | 'pl'

export const LANGUAGES: Language[] = ['en', 'pl']
export const DEFAULT_LANGUAGE: Language = 'en'

const en = {
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'language.label': 'Language',

  'start.title': 'Tidy up your files and watch it happen',
  'start.lead': 'You see a preview first. Files move only after you approve, and every move can be undone.',
  'start.pathLabel': 'Folder path',
  'start.pathPlaceholder': 'C:\\Users\\...\\Downloads',
  'start.pick': 'Browse…',
  'start.pickTitle': 'Choose a folder to organize',
  'start.scan': 'Scan',
  'start.drives': 'Drives',
  'start.driveFree': '{free} free of {total}',
  'start.interrupted': 'Sorting of {root} was interrupted before it finished.',
  'start.finishUndo': 'Finish undoing ({count})',
  'start.history': 'History',
  'start.undo': 'Undo',

  'undo.progress': 'Undoing: {done} of {total}',
  'undo.summary': 'Undone: {restored}. Conflicts: {conflicts}, missing: {lost}.',
  'undo.differs': 'Both files exist and they differ',

  'nav.back': '← Start',
  'nav.up': '← Up',
  'step.scan': 'Scan',
  'step.plan': 'Plan',
  'step.run': 'Sorting',
  'step.summary': 'Result',

  'scene.starting': 'Starting scan…',
  'scene.simulation': 'Simulation: no files are being moved',
  'scene.legend': 'Category legend',
  'scene.open': 'Click to open',
  'scene.rest': 'Other ({count})',

  'scan.walk': 'Reading the folder structure',
  'scan.enrich': 'Recognizing file contents',
  'scan.duplicates': 'Looking for duplicates',
  'scan.done': 'Scan finished',
  'scan.cancelled': 'Scan stopped',
  'scan.files': 'Files',
  'scan.size': 'Size',
  'scan.folders': 'Folders',
  'scan.projects': 'Projects',
  'scan.cloud': 'This folder is in OneDrive. File contents are not read, so nothing is downloaded from the cloud.',
  'scan.duplicatesFound': 'Duplicates: {groups} groups, {bytes} to reclaim.',
  'scan.mismatched': 'Files whose extension does not match the contents: {count}.',
  'scan.errors': 'Inaccessible items skipped: {count}.',
  'scan.links': 'Links skipped: {count}.',
  'scan.stop': 'Stop scan',
  'scan.toPlan': 'Plan the cleanup',
  'scan.back': 'Back',

  'dimension.type': 'Type',
  'dimension.year': 'Year',
  'dimension.month': 'Month',
  'dimension.size': 'Size',

  'plan.groupBy': 'Group by (order matters)',
  'plan.target': 'Target folder',
  'plan.change': 'Change',
  'plan.context': 'Context',
  'plan.contextSummary': 'Whole: {whole}, kept: {keep}, split: {split}.',
  'plan.topicFolders': 'Topic folders ({count})',
  'plan.separateDuplicates': 'Set copies aside in {folder} ({count})',
  'plan.chooseKeeper': 'Choose which copy stays',
  'plan.toMove': 'To move',
  'plan.size': 'Size',
  'plan.kept': 'Staying in place',
  'plan.alreadySorted': 'Already sorted and left alone: {count}.',
  'plan.skipped': 'Skipped: {count}. First reason: {reason}.',
  'plan.simulating': 'Simulation running…',
  'plan.simulate': 'Show simulation',
  'plan.move': 'Move {items}',

  'confirm.title': 'Move {items}?',
  'confirm.body': '{bytes} will go to {target}. No file is deleted or overwritten, and everything can be undone.',
  'confirm.drive': 'I understand I am organizing the whole drive {root}',
  'confirm.action': 'Move files',

  'run.title': 'Moving files',
  'run.done': 'Done',
  'run.moved': 'Moved',
  'run.skipped': 'Skipped',
  'run.stop': 'Stop',

  'summary.done': 'Finished',
  'summary.stopped': 'Sorting stopped',
  'summary.skippedFiles': 'Skipped files',
  'summary.showManifest': 'Show change list (CSV)',
  'summary.showFolder': 'Show in Explorer',
  'summary.undoAll': 'Undo everything',
  'summary.rescan': 'Scan again',

  'drawer.details': 'Details',
  'drawer.allFiles': 'All files',
  'drawer.topics': 'Topic folders: what should happen to each one?',
  'drawer.duplicates': 'Which copy stays?',
  'drawer.more': 'Show more',
  'decision.group': 'Decision for {folder}',
  'decision.whole': 'Whole',
  'decision.whole.hint': 'The folder goes to {folder} with its contents unchanged',
  'decision.keep': 'Keep',
  'decision.keep.hint': 'The folder stays where it is',
  'decision.split': 'Split',
  'decision.split.hint': 'Files get grouped and subfolders are evaluated separately',

  'failure.changed': 'changed after the plan was built',
  'failure.missing': 'file no longer exists',
  'failure.locked': 'locked by another program',
  'failure.collision': 'name conflict',
  'failure.protected': 'protected path',
  'failure.error': 'error',

  'skip.root-is-project': 'the selected folder is a project, so it will not be split',
  'skip.target-inside-unit': 'the target folder is inside this project',
  'skip.protected': 'protected path',

  'status.completed': 'Completed',
  'status.cancelled': 'Cancelled',
  'status.interrupted': 'Interrupted',
  'status.undone': 'Undone',
  'status.partially-undone': 'Partly undone',

  'error.busy': 'Another operation is in progress',
  'error.planStale': 'The plan is out of date, build it again',
  'error.folderMissing': 'Folder does not exist: {param}',
  'error.noScan': 'No scan results yet',
  'error.unknownDuplicate': 'Unknown duplicate copy',
  'error.unknownOperation': 'Unknown operation',
}

export type TextKey = keyof typeof en

const pl: typeof en = {
  'common.close': 'Zamknij',
  'common.cancel': 'Anuluj',
  'language.label': 'Język',

  'start.title': 'Zrób porządek w plikach i zobacz, jak to się dzieje',
  'start.lead': 'Najpierw podgląd zmian. Pliki ruszają się dopiero po Twojej zgodzie, a każdy ruch można cofnąć.',
  'start.pathLabel': 'Ścieżka folderu',
  'start.pathPlaceholder': 'C:\\Users\\...\\Pobrane',
  'start.pick': 'Wybierz…',
  'start.pickTitle': 'Wybierz folder do uporządkowania',
  'start.scan': 'Skanuj',
  'start.drives': 'Dyski',
  'start.driveFree': '{free} wolne z {total}',
  'start.interrupted': 'Sortowanie folderu {root} zostało przerwane przed końcem.',
  'start.finishUndo': 'Dokończ cofanie ({count})',
  'start.history': 'Historia',
  'start.undo': 'Cofnij',

  'undo.progress': 'Cofanie: {done} z {total}',
  'undo.summary': 'Cofnięto: {restored}. Konflikty: {conflicts}, brakujące: {lost}.',
  'undo.differs': 'Oba pliki istnieją i się różnią',

  'nav.back': '← Start',
  'nav.up': '← Wyżej',
  'step.scan': 'Skan',
  'step.plan': 'Plan',
  'step.run': 'Sortowanie',
  'step.summary': 'Wynik',

  'scene.starting': 'Zaczynam skan…',
  'scene.simulation': 'Symulacja: żaden plik nie jest przenoszony',
  'scene.legend': 'Legenda kategorii',
  'scene.open': 'Kliknij, aby wejść',
  'scene.rest': 'Pozostałe ({count})',

  'scan.walk': 'Czytam strukturę folderów',
  'scan.enrich': 'Rozpoznaję zawartość plików',
  'scan.duplicates': 'Szukam duplikatów',
  'scan.done': 'Skan zakończony',
  'scan.cancelled': 'Skan przerwany',
  'scan.files': 'Pliki',
  'scan.size': 'Rozmiar',
  'scan.folders': 'Foldery',
  'scan.projects': 'Projekty',
  'scan.cloud': 'Ten folder leży w OneDrive. Pomijam czytanie zawartości, żeby nie pobierać plików z chmury.',
  'scan.duplicatesFound': 'Duplikaty: grupy {groups}, do odzyskania {bytes}.',
  'scan.mismatched': 'Pliki z rozszerzeniem niezgodnym z zawartością: {count}.',
  'scan.errors': 'Pominięto niedostępne elementy: {count}.',
  'scan.links': 'Pominięte dowiązania: {count}.',
  'scan.stop': 'Przerwij skan',
  'scan.toPlan': 'Zaplanuj porządek',
  'scan.back': 'Wróć',

  'dimension.type': 'Typ',
  'dimension.year': 'Rok',
  'dimension.month': 'Miesiąc',
  'dimension.size': 'Rozmiar',

  'plan.groupBy': 'Grupuj wg (kolejność ma znaczenie)',
  'plan.target': 'Folder docelowy',
  'plan.change': 'Zmień',
  'plan.context': 'Kontekst',
  'plan.contextSummary': 'W całości: {whole}, zostaje: {keep}, rozbite: {split}.',
  'plan.topicFolders': 'Foldery tematyczne ({count})',
  'plan.separateDuplicates': 'Odłóż kopie do {folder} ({count})',
  'plan.chooseKeeper': 'Wybierz, który egzemplarz zostaje',
  'plan.toMove': 'Do przeniesienia',
  'plan.size': 'Rozmiar',
  'plan.kept': 'Zostaje na miejscu',
  'plan.alreadySorted': 'Już posortowane i pozostawione bez zmian: {count}.',
  'plan.skipped': 'Pominięte: {count}. Pierwszy powód: {reason}.',
  'plan.simulating': 'Symulacja trwa…',
  'plan.simulate': 'Pokaż symulację',
  'plan.move': 'Przenieś {items}',

  'confirm.title': 'Przenieść {items}?',
  'confirm.body': '{bytes} trafi do {target}. Żaden plik nie zostanie usunięty ani nadpisany, a całość można cofnąć.',
  'confirm.drive': 'Rozumiem, że porządkuję cały dysk {root}',
  'confirm.action': 'Przenieś pliki',

  'run.title': 'Przenoszę pliki',
  'run.done': 'Gotowe',
  'run.moved': 'Przeniesiono',
  'run.skipped': 'Pominięte',
  'run.stop': 'Zatrzymaj',

  'summary.done': 'Gotowe',
  'summary.stopped': 'Sortowanie zatrzymane',
  'summary.skippedFiles': 'Pominięte pliki',
  'summary.showManifest': 'Pokaż spis zmian (CSV)',
  'summary.showFolder': 'Pokaż w Eksploratorze',
  'summary.undoAll': 'Cofnij wszystko',
  'summary.rescan': 'Skanuj ponownie',

  'drawer.details': 'Szczegóły',
  'drawer.allFiles': 'Wszystkie pliki',
  'drawer.topics': 'Foldery tematyczne: co zrobić z każdym z nich?',
  'drawer.duplicates': 'Który egzemplarz zostaje?',
  'drawer.more': 'Pokaż kolejne',
  'decision.group': 'Decyzja dla {folder}',
  'decision.whole': 'W całości',
  'decision.whole.hint': 'Folder trafi do {folder} bez zmian w środku',
  'decision.keep': 'Zostaw',
  'decision.keep.hint': 'Folder pozostanie tam, gdzie jest',
  'decision.split': 'Rozbij',
  'decision.split.hint': 'Pliki zostaną pogrupowane, a podfoldery ocenione osobno',

  'failure.changed': 'zmieniony po zbudowaniu planu',
  'failure.missing': 'plik już nie istnieje',
  'failure.locked': 'zablokowany przez inny program',
  'failure.collision': 'konflikt nazwy',
  'failure.protected': 'ścieżka chroniona',
  'failure.error': 'błąd',

  'skip.root-is-project': 'wybrany folder jest projektem, więc nie zostanie rozbity',
  'skip.target-inside-unit': 'folder docelowy leży wewnątrz tego projektu',
  'skip.protected': 'ścieżka chroniona',

  'status.completed': 'Zakończone',
  'status.cancelled': 'Anulowane',
  'status.interrupted': 'Przerwane',
  'status.undone': 'Cofnięte',
  'status.partially-undone': 'Cofnięte częściowo',

  'error.busy': 'Trwa inna operacja',
  'error.planStale': 'Plan jest nieaktualny, zbuduj go ponownie',
  'error.folderMissing': 'Folder nie istnieje: {param}',
  'error.noScan': 'Brak wyników skanu',
  'error.unknownDuplicate': 'Nieznany egzemplarz duplikatu',
  'error.unknownOperation': 'Nieznana operacja',
}

export const dictionaries: Record<Language, typeof en> = { en, pl }

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }

const pluralEn = {
  files: { one: '{count} file', other: '{count} files' },
  items: { one: '{count} item', other: '{count} items' },
} satisfies Record<string, PluralForms>

export type PluralKey = keyof typeof pluralEn

export const pluralDictionaries: Record<Language, Record<PluralKey, PluralForms>> = {
  en: pluralEn,
  pl: {
    files: { one: '{count} plik', few: '{count} pliki', many: '{count} plików', other: '{count} pliku' },
    items: { one: '{count} element', few: '{count} elementy', many: '{count} elementów', other: '{count} elementu' },
  },
}

export function translate(
  language: Language,
  key: TextKey,
  params: Record<string, string | number> = {},
): string {
  return dictionaries[language][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** `shown` is the number as displayed, so the caller controls locale formatting. */
export function pluralize(language: Language, key: PluralKey, count: number, shown: string = String(count)): string {
  const forms = pluralDictionaries[language][key]
  const form = new Intl.PluralRules(language).select(count)
  return (forms[form] ?? forms.other).replace('{count}', shown)
}

export interface OutputLabels {
  categories: Record<Category, string>
  sizes: [string, string, string, string]
  noDate: string
  duplicates: string
  looseOrigin: string
  targetDir: string
  manifestPrefix: string
  manifestHeader: string[]
}

const OUTPUT_LABELS: Record<Language, OutputLabels> = {
  en: {
    categories: {
      documents: 'Documents',
      spreadsheets: 'Spreadsheets',
      presentations: 'Presentations',
      pdf: 'PDF',
      images: 'Images',
      video: 'Video',
      audio: 'Audio',
      archives: 'Archives',
      code: 'Code',
      installers: 'Installers',
      projects: 'Projects',
      topics: 'Topics',
      other: 'Other',
    },
    sizes: ['Under 1 MB', '1–100 MB', '100 MB–1 GB', 'Over 1 GB'],
    noDate: 'No date',
    duplicates: '_Duplicates',
    looseOrigin: '(loose files)',
    targetDir: '_Sorted',
    manifestPrefix: '_Changes-',
    manifestHeader: ['From', 'To', 'Group', 'Size (bytes)', 'Modified'],
  },
  pl: {
    categories: {
      documents: 'Dokumenty',
      spreadsheets: 'Arkusze',
      presentations: 'Prezentacje',
      pdf: 'PDF',
      images: 'Zdjęcia',
      video: 'Wideo',
      audio: 'Audio',
      archives: 'Archiwa',
      code: 'Kod',
      installers: 'Instalatory',
      projects: 'Projekty',
      topics: 'Tematy',
      other: 'Inne',
    },
    sizes: ['Poniżej 1 MB', '1–100 MB', '100 MB–1 GB', 'Powyżej 1 GB'],
    noDate: 'Bez daty',
    duplicates: '_Duplikaty',
    looseOrigin: '(luźne pliki)',
    targetDir: '_Posortowane',
    manifestPrefix: '_Spis-',
    manifestHeader: ['Skąd', 'Dokąd', 'Grupa', 'Rozmiar (bajty)', 'Data modyfikacji'],
  },
}

export function outputLabels(language: Language = DEFAULT_LANGUAGE): OutputLabels {
  return OUTPUT_LABELS[language]
}

/** Results of earlier runs must stay recognizable after the language changes. */
export const SORTED_DIR_NAMES = LANGUAGES.map((language) => OUTPUT_LABELS[language].targetDir)
export const MANIFEST_PREFIXES = LANGUAGES.map((language) => OUTPUT_LABELS[language].manifestPrefix)

/** Stable code; other undo conflicts carry the raw system message. */
export const UNDO_CONFLICT_DIFFERS = 'differs'

export type ErrorCode = 'busy' | 'planStale' | 'folderMissing' | 'noScan' | 'unknownDuplicate' | 'unknownOperation'

const ERROR_PATTERN = /mfiles:(\w+):(.*)$/s

/** Errors travel as codes, so the worker stays free of language state. */
export class AppError extends Error {
  constructor(code: ErrorCode, param = '') {
    super(`mfiles:${code}:${param}`)
  }
}

export function localizeError(message: string, language: Language): string {
  const match = ERROR_PATTERN.exec(message)
  if (!match) return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  return translate(language, `error.${match[1] as ErrorCode}`, { param: match[2] })
}
