import path from 'node:path'
import { isDriveRoot, isWithin } from './safety'
import type { Category, FileEntry, FolderDecision, TopicInfo } from './types'

const GENERIC_NAMES = new Set([
  'pobrane', 'downloads', 'download', 'pulpit', 'desktop', 'dokumenty', 'documents', 'moje dokumenty', 'my documents',
  'zdjęcia', 'zdjecia', 'obrazy', 'pictures', 'images', 'photos', 'fotki', 'muzyka', 'music', 'wideo', 'video',
  'videos', 'filmy', 'nowy folder', 'new folder', 'inne', 'other', 'others', 'różne', 'rozne', 'misc', 'stuff',
  'stare', 'old', 'kopia', 'copy', 'kopie', 'backup', 'backups', 'kopia zapasowa', 'temp', 'tmp', 'dcim', 'camera',
  '100media', '100apple', 'screenshots', 'zrzuty ekranu', 'nieposortowane', 'unsorted', 'users', 'public', 'publiczny',
])

const COPY_SUFFIX = /(\s*\(\d+\)|\s*-\s*(kopia|copy))+$/i
const AUTOMATIC_NAME = [/^\d+$/, /^[0-9a-f]{16,}$/i, /^\{?[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\}?$/i]
const WEB_ASSETS = /^(.+)_(files|pliki)$/i

export const TOPICS_DIR = 'Tematy'

/** Folders with no meaning of their own: the name says nothing about the contents. */
export function isGenericFolderName(name: string): boolean {
  const normalized = name.trim().replace(COPY_SUFFIX, '').toLowerCase()
  return GENERIC_NAMES.has(normalized) || AUTOMATIC_NAME.some((pattern) => pattern.test(normalized))
}

interface FolderNode {
  path: string
  name: string
  children: Map<string, FolderNode>
  entries: FileEntry[]
  files: number
  bytes: number
  mtimeMs: number
  categories: Map<Category, number>
}

function createNode(folder: string): FolderNode {
  return {
    path: folder,
    name: path.basename(folder),
    children: new Map(),
    entries: [],
    files: 0,
    bytes: 0,
    mtimeMs: 0,
    categories: new Map(),
  }
}

function relativeDirs(root: string, entry: FileEntry): string[] {
  const relative = path.relative(root, path.dirname(entry.path))
  if (!relative || relative.startsWith('..')) return []
  return relative.split(path.sep)
}

function folderChain(rootNode: FolderNode, root: string, entry: FileEntry): FolderNode[] {
  let node = rootNode
  const chain = [rootNode]
  for (const segment of relativeDirs(root, entry)) {
    let child = node.children.get(segment)
    if (!child) {
      child = createNode(path.join(node.path, segment))
      node.children.set(segment, child)
    }
    node = child
    chain.push(node)
  }
  return chain
}

function buildTree(entries: FileEntry[], root: string): FolderNode {
  const rootNode = createNode(root)
  const chains = new Map<string, FolderNode[]>()
  for (const entry of entries) {
    const dir = entry.path.slice(0, entry.path.lastIndexOf(path.sep))
    let visited = chains.get(dir)
    if (!visited) {
      visited = folderChain(rootNode, root, entry)
      chains.set(dir, visited)
    }
    visited[visited.length - 1].entries.push(entry)
    for (const folder of visited) {
      folder.files++
      folder.bytes += entry.size
      folder.mtimeMs = Math.max(folder.mtimeMs, entry.mtimeMs)
      folder.categories.set(entry.category, (folder.categories.get(entry.category) ?? 0) + entry.size)
    }
  }
  return rootNode
}

function collect(node: FolderNode, into: Set<string>): void {
  for (const entry of node.entries) into.add(entry.path)
  for (const child of node.children.values()) collect(child, into)
}

function topCategories(node: FolderNode): Category[] {
  return [...node.categories.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category]) => category)
}

function findPageFor(parent: FolderNode, folderName: string): FileEntry | undefined {
  const page = WEB_ASSETS.exec(folderName)?.[1].toLowerCase()
  if (!page) return undefined
  return parent.entries.find((e) => (e.ext === 'html' || e.ext === 'htm') && e.name.slice(0, -e.ext.length - 1).toLowerCase() === page)
}

export interface ContextResult {
  /** Loose files and units that go through regular grouping. */
  loose: FileEntry[]
  /** Folders moved as a whole, as `unit` entries. */
  wholeFolders: FileEntry[]
  /** Files in `whole` and `keep` folders: these contents must not be separated. */
  pinned: Set<string>
  topics: TopicInfo[]
  kept: number
}

/** Decides which folders carry context. Pure function: decisions come only from paths and names. */
export function analyzeContext(
  entries: FileEntry[],
  root: string,
  targetRoot: string,
  decisions: Record<string, FolderDecision> = {},
): ContextResult {
  const result: ContextResult = { loose: [], wholeFolders: [], pinned: new Set(), topics: [], kept: 0 }
  const defaultForTopic: FolderDecision = isDriveRoot(root) ? 'keep' : 'whole'

  const visit = (node: FolderNode): void => {
    for (const entry of node.entries) result.loose.push(entry)
    const childrenAreAccounts = node.name.toLowerCase() === 'users'
    for (const child of node.children.values()) {
      const page = findPageFor(node, child.name)
      const generic = !page && (childrenAreAccounts || isGenericFolderName(child.name))
      const auto: FolderDecision = page ? 'whole' : generic ? 'split' : defaultForTopic
      let decision = decisions[child.path] ?? auto
      if (decision === 'whole' && isWithin(child.path, targetRoot)) decision = 'split'

      result.topics.push({
        path: child.path,
        label: child.name,
        relative: path.relative(root, child.path),
        files: child.files,
        bytes: child.bytes,
        categories: topCategories(child),
        decision,
        auto,
      })

      if (decision === 'split') {
        visit(child)
      } else {
        collect(child, result.pinned)
        if (decision === 'keep') {
          result.kept += child.files
        } else {
          result.wholeFolders.push({
            path: child.path,
            name: child.name,
            ext: '',
            size: child.bytes,
            mtimeMs: child.mtimeMs,
            kind: 'unit',
            category: page ? page.category : 'topics',
            companionOf: page?.path,
          })
        }
      }
    }
  }

  visit(buildTree(entries, root))
  result.topics.sort((a, b) => b.bytes - a.bytes)
  return result
}
