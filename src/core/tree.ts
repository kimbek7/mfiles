import path from 'node:path'
import { CATEGORY_LABELS } from './types'
import type { Category, FileEntry, TreeTile } from './types'

interface DirNode {
  path: string
  parent: DirNode | null
  bytes: number
  files: number
  byCategory: Partial<Record<Category, number>>
  children: Map<string, DirNode>
  looseBytes: Partial<Record<Category, number>>
  looseFiles: Partial<Record<Category, number>>
  units: FileEntry[]
}

function bump(map: Partial<Record<Category, number>>, category: Category, amount: number): void {
  map[category] = (map[category] ?? 0) + amount
}

/** Aggregated folder tree for the map: the renderer gets tiles, never the full file list. */
export class TreeIndex {
  private readonly rootNode: DirNode
  private readonly nodes = new Map<string, DirNode>()

  constructor(root: string) {
    this.rootNode = this.createNode(path.resolve(root), null)
  }

  private createNode(dir: string, parent: DirNode | null): DirNode {
    const node: DirNode = {
      path: dir,
      parent,
      bytes: 0,
      files: 0,
      byCategory: {},
      children: new Map(),
      looseBytes: {},
      looseFiles: {},
      units: [],
    }
    this.nodes.set(dir, node)
    return node
  }

  private nodeFor(dir: string): DirNode {
    const existing = this.nodes.get(dir)
    if (existing) return existing
    const parent = this.nodeFor(path.dirname(dir))
    const node = this.createNode(dir, parent)
    parent.children.set(dir, node)
    return node
  }

  add(entry: FileEntry): void {
    const isRootUnit = entry.kind === 'unit' && entry.path === this.rootNode.path
    const leaf = isRootUnit ? this.rootNode : this.nodeFor(path.dirname(entry.path))
    if (entry.kind === 'unit') leaf.units.push(entry)
    else {
      bump(leaf.looseBytes, entry.category, entry.size)
      bump(leaf.looseFiles, entry.category, 1)
    }
    for (let node: DirNode | null = leaf; node; node = node.parent) {
      node.bytes += entry.size
      node.files += 1
      bump(node.byCategory, entry.category, entry.size)
    }
  }

  tiles(focus: string = this.rootNode.path, limit = 240): TreeTile[] {
    const node = this.nodes.get(path.resolve(focus)) ?? this.rootNode
    const tiles: TreeTile[] = []
    for (const child of node.children.values()) {
      tiles.push({
        path: child.path,
        label: path.basename(child.path),
        bytes: child.bytes,
        files: child.files,
        isDir: true,
        byCategory: child.byCategory,
      })
    }
    for (const unit of node.units) {
      tiles.push({
        path: unit.path,
        label: unit.name,
        bytes: unit.size,
        files: 1,
        isDir: false,
        byCategory: { projects: unit.size },
      })
    }
    for (const [category, bytes] of Object.entries(node.looseBytes) as [Category, number][]) {
      tiles.push({
        path: `${node.path}${path.sep}*${category}`,
        label: CATEGORY_LABELS[category],
        bytes,
        files: node.looseFiles[category] ?? 0,
        isDir: false,
        byCategory: { [category]: bytes },
      })
    }
    tiles.sort((a, b) => b.bytes - a.bytes)
    if (tiles.length <= limit) return tiles

    const rest = tiles.slice(limit - 1)
    const merged: TreeTile = {
      path: `${node.path}${path.sep}*rest`,
      label: `Pozostałe (${rest.length})`,
      bytes: 0,
      files: 0,
      isDir: false,
      byCategory: {},
    }
    for (const tile of rest) {
      merged.bytes += tile.bytes
      merged.files += tile.files
      for (const [category, bytes] of Object.entries(tile.byCategory) as [Category, number][]) {
        bump(merged.byCategory, category, bytes)
      }
    }
    return [...tiles.slice(0, limit - 1), merged]
  }

  parentOf(focus: string): string | null {
    return this.nodes.get(path.resolve(focus))?.parent?.path ?? null
  }
}
