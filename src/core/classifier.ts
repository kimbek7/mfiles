import { open } from 'node:fs/promises'
import exifr from 'exifr'
import { fileTypeFromBuffer } from 'file-type'
import type { Category, FileEntry } from './types'
import { forEachLimit } from './util'

const EXTENSIONS: Record<Exclude<Category, 'projects' | 'topics' | 'other'>, string[]> = {
  documents: ['doc', 'docx', 'docm', 'dot', 'dotx', 'odt', 'rtf', 'txt', 'md', 'tex', 'epub', 'mobi', 'pages'],
  spreadsheets: ['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv', 'numbers'],
  presentations: ['ppt', 'pptx', 'pptm', 'odp', 'key'],
  pdf: ['pdf'],
  images: [
    'jpg',
    'jpeg',
    'jfif',
    'png',
    'gif',
    'bmp',
    'webp',
    'tif',
    'tiff',
    'heic',
    'heif',
    'avif',
    'svg',
    'ico',
    'raw',
    'cr2',
    'cr3',
    'nef',
    'arw',
    'dng',
    'orf',
    'rw2',
    'psd',
    'ai',
    'xcf',
  ],
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'm4v', 'mpg', 'mpeg', '3gp', 'mts', 'm2ts', 'vob'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'opus', 'm4a', 'wma', 'aiff', 'aif', 'mid', 'midi'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'cab'],
  code: [
    'js',
    'mjs',
    'cjs',
    'ts',
    'tsx',
    'jsx',
    'py',
    'java',
    'kt',
    'cs',
    'c',
    'h',
    'cpp',
    'hpp',
    'go',
    'rs',
    'rb',
    'php',
    'swift',
    'html',
    'htm',
    'css',
    'scss',
    'json',
    'xml',
    'yml',
    'yaml',
    'toml',
    'sql',
    'sh',
    'ps1',
    'bat',
    'cmd',
    'lua',
    'r',
    'dart',
    'vue',
  ],
  installers: ['exe', 'msi', 'msix', 'appx', 'msixbundle', 'apk', 'deb', 'rpm', 'dmg', 'pkg'],
}

const EXT_TO_CATEGORY = new Map<string, Category>(
  Object.entries(EXTENSIONS).flatMap(([category, exts]) => exts.map((e) => [e, category as Category] as const)),
)

const EXIF_EXTS = new Set([
  'jpg',
  'jpeg',
  'jfif',
  'tif',
  'tiff',
  'heic',
  'heif',
  'avif',
  'webp',
  'png',
  'cr2',
  'cr3',
  'nef',
  'arw',
  'dng',
  'orf',
  'rw2',
])

/** Formats detected with high confidence. Containers (zip, cfb) are left out because docx, jar and apk are containers too. */
const STRONG_MIME_PREFIXES: [string, Category][] = [
  ['image/', 'images'],
  ['video/', 'video'],
  ['audio/', 'audio'],
  ['application/pdf', 'pdf'],
]

const WEAK_MIME_CATEGORIES: [RegExp, Category][] = [
  [/zip|x-rar|x-7z|gzip|x-tar|x-bzip2|x-xz|zstd|x-iso9660/, 'archives'],
  [/msword|wordprocessingml|opendocument\.text|epub/, 'documents'],
  [/spreadsheetml|ms-excel|opendocument\.spreadsheet/, 'spreadsheets'],
  [/presentationml|ms-powerpoint|opendocument\.presentation/, 'presentations'],
  [/x-msdownload|x-msi|x-dosexec|vnd\.microsoft\.portable-executable/, 'installers'],
]

const HEADER_BYTES = 4100

export function categoryFromExt(ext: string): Category {
  return EXT_TO_CATEGORY.get(ext.toLowerCase()) ?? 'other'
}

export function categoryFromMime(mime: string, extKnown: boolean): Category | null {
  for (const [prefix, category] of STRONG_MIME_PREFIXES) {
    if (mime.startsWith(prefix)) return category
  }
  if (extKnown) return null
  for (const [pattern, category] of WEAK_MIME_CATEGORIES) {
    if (pattern.test(mime)) return category
  }
  return null
}

async function readHeader(filePath: string): Promise<Uint8Array> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(HEADER_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function readTakenAt(filePath: string): Promise<number | undefined> {
  const tags = await exifr.parse(filePath, { pick: ['DateTimeOriginal', 'CreateDate'] })
  const date: unknown = tags?.DateTimeOriginal ?? tags?.CreateDate
  if (!(date instanceof Date)) return undefined
  const ms = date.getTime()
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

/** Enriches an entry with data from file contents. An unreadable file keeps its extension-based category. */
export async function enrichEntry(entry: FileEntry): Promise<void> {
  if (entry.kind !== 'file' || entry.size === 0) return
  try {
    const detected = await fileTypeFromBuffer(await readHeader(entry.path))
    if (detected) {
      const extKnown = entry.category !== 'other'
      const category = categoryFromMime(detected.mime, extKnown)
      if (category && category !== entry.category) {
        entry.extMismatch = extKnown
        entry.category = category
      }
    }
  } catch {
    return
  }
  if (entry.category === 'images' && EXIF_EXTS.has(entry.ext)) {
    try {
      entry.takenAtMs = await readTakenAt(entry.path)
    } catch {
      entry.takenAtMs = undefined
    }
  }
}

export async function enrichEntries(
  entries: FileEntry[],
  options: { signal?: AbortSignal; onProgress?: (done: number) => void } = {},
): Promise<void> {
  let done = 0
  await forEachLimit(
    entries,
    16,
    async (entry) => {
      await enrichEntry(entry)
      options.onProgress?.(++done)
    },
    options.signal,
  )
}
