import 'pixi.js/unsafe-eval'
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy'
import { Application, Container, Graphics, Particle, ParticleContainer, Text, Texture } from 'pixi.js'
import type { Category, TreeTile } from '../../core/types'
import { PARTICLE_STRIDE } from '../../shared/api'
import type { PlanView } from '../../shared/api'
import { CATEGORY_COLORS, colorOfIndex, formatBytes, formatCount } from '../lib'

const BACKGROUND = 0x0e1012
const TILE_BASE = 0x1a1e23
const DRAINED = 0x14171b
const TRACK = 0x1f242a
const TEXT = 0xe9e6df
const MUTED = 0x8c939c
const NEUTRAL_BUCKETS = [0xe0a458, 0x6ea8fe, 0x5fcf9a, 0xc792ea, 0xef6f6c, 0x39c6d6, 0xd6b656, 0x8bd450]
const FONT = 'Segoe UI Variable, Segoe UI, sans-serif'

const MAX_LABELS = 48
const MAX_ORIGIN_TILES = 32
const MAX_BUCKET_ROWS = 11
const MAX_PARTICLES = 20000
const PARTICLE_TEXTURE_SIZE = 32
const EASE_MS = 110

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface VisualTile extends Rect {
  tile: TreeTile
  target: Rect
}

interface OriginSlot extends Rect {
  label: string
  total: number
  remaining: number
}

interface BucketRow {
  label: string
  count: number
  bytes: number
  arrived: number
  color: number
  x: number
  y: number
  trackWidth: number
}

interface Flight {
  sprite: Particle
  active: boolean
  elapsed: number
  delay: number
  duration: number
  x0: number
  y0: number
  cx: number
  cy: number
  x1: number
  y1: number
  row: number
  slot: number
  bytes: number
  launched: boolean
  scale: number
}

export interface SceneCallbacks {
  onHover(tile: TreeTile | null, x: number, y: number): void
  onOpen(tile: TreeTile): void
}

function layout(items: { key: string; bytes: number }[], area: Rect, padding: number): Map<string, Rect> {
  const root = hierarchy<{ key: string; bytes: number; children?: { key: string; bytes: number }[] }>({
    key: '',
    bytes: 0,
    children: items,
  }).sum((d) => (d.children ? 0 : Math.max(d.bytes, 1)))
  const computed = treemap<(typeof root)['data']>()
    .tile(treemapSquarify)
    .size([Math.max(area.w, 1), Math.max(area.h, 1)])
    .paddingInner(padding)(root)
  const rects = new Map<string, Rect>()
  for (const leaf of computed.leaves()) {
    rects.set(leaf.data.key, {
      x: area.x + leaf.x0,
      y: area.y + leaf.y0,
      w: leaf.x1 - leaf.x0,
      h: leaf.y1 - leaf.y0,
    })
  }
  return rects
}

function particleTexture(): Texture {
  const size = PARTICLE_TEXTURE_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d') as CanvasRenderingContext2D
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.75)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  return Texture.from(canvas)
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1))}…`
}

/** The WebGL scene runs outside React: thousands of objects updated every frame should not go through state. */
export class SceneController {
  private readonly gfx = new Graphics()
  private readonly labels = new Container()
  private readonly labelPool: Text[] = []
  private readonly particles: ParticleContainer
  private readonly texture: Texture
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private mode: 'map' | 'flow' = 'map'
  private tiles: VisualTile[] = []
  private mapDirty = true
  private plan: PlanView | null = null
  private origins: OriginSlot[] = []
  private rows: BucketRow[] = []
  private originToSlot: number[] = []
  private bucketToRow: number[] = []
  private readonly flights: Flight[] = []
  private readonly idle: Flight[] = []
  private activeFlights = 0
  private preserveProgress = false

  private constructor(
    private readonly app: Application,
    private readonly callbacks: SceneCallbacks,
  ) {
    this.texture = particleTexture()
    this.particles = new ParticleContainer({
      dynamicProperties: { position: true, color: true, vertex: true, rotation: false, uvs: false },
    })
    this.particles.blendMode = 'add'
    app.stage.addChild(this.gfx, this.labels, this.particles)
    app.ticker.add((ticker) => this.tick(ticker.deltaMS))
    app.renderer.on('resize', () => this.handleResize())
    const canvas = app.canvas
    canvas.addEventListener('pointermove', this.handlePointerMove)
    canvas.addEventListener('pointerleave', this.handlePointerLeave)
    canvas.addEventListener('click', this.handleClick)
  }

  static async create(host: HTMLElement, callbacks: SceneCallbacks): Promise<SceneController> {
    const app = new Application()
    await app.init({
      resizeTo: host,
      background: BACKGROUND,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: 'webgl',
    })
    host.appendChild(app.canvas)
    return new SceneController(app, callbacks)
  }

  destroy(): void {
    this.app.destroy(true, { children: true })
  }

  private get width(): number {
    return this.app.screen.width
  }

  private get height(): number {
    return this.app.screen.height
  }

  showTiles(tiles: TreeTile[]): void {
    this.mode = 'map'
    this.plan = null
    this.clearFlights()
    const previous = new Map(this.tiles.map((t) => [t.tile.path, t]))
    const targets = layout(
      tiles.map((t) => ({ key: t.path, bytes: t.bytes })),
      this.mapArea(),
      2,
    )
    this.tiles = tiles.flatMap((tile) => {
      const target = targets.get(tile.path)
      if (!target) return []
      const existing = previous.get(tile.path)
      const start = existing ?? { x: target.x + target.w / 2, y: target.y + target.h / 2, w: 0, h: 0 }
      return [{ tile, x: start.x, y: start.y, w: start.w, h: start.h, target }]
    })
    this.mapDirty = true
  }

  /** The same plan does not reset the scene, so the result screen keeps showing the state after sorting. */
  showFlow(plan: PlanView): void {
    if (this.mode === 'flow' && this.plan === plan) return
    this.mode = 'flow'
    this.plan = plan
    this.resetFlow()
  }

  resetFlow(): void {
    if (this.mode !== 'flow') return
    this.clearFlights()
    this.relayout()
  }

  addParticles(data: number[]): void {
    for (let i = 0; i < data.length; i += PARTICLE_STRIDE) {
      const row = this.bucketToRow[data[i]]
      const slot = this.originToSlot[data[i + 1]]
      const bytes = data[i + 4]
      if (this.rows[row] === undefined || this.origins[slot] === undefined) continue
      if (this.reducedMotion || this.activeFlights >= MAX_PARTICLES) {
        this.origins[slot].remaining -= bytes
        this.rows[row].arrived += bytes
        continue
      }
      this.launch(row, slot, data[i + 2], data[i + 3], bytes)
    }
  }

  private mapArea(): Rect {
    return { x: 0, y: 0, w: this.width, h: this.height }
  }

  private relayout(): void {
    if (this.mode === 'map') {
      const targets = layout(
        this.tiles.map((t) => ({ key: t.tile.path, bytes: t.tile.bytes })),
        this.mapArea(),
        2,
      )
      for (const tile of this.tiles) tile.target = targets.get(tile.tile.path) ?? tile.target
      this.mapDirty = true
      return
    }
    if (this.plan) {
      const origins = this.origins
      const rows = this.rows
      this.layoutFlow(this.plan)
      // Resizing the window keeps progress; the data shape is the same for the same plan.
      if (this.preserveProgress && origins.length === this.origins.length && rows.length === this.rows.length) {
        origins.forEach((o, i) => (this.origins[i].remaining = o.remaining))
        rows.forEach((r, i) => (this.rows[i].arrived = r.arrived))
      }
      this.preserveProgress = false
    }
  }

  private handleResize(): void {
    this.preserveProgress = this.mode === 'flow'
    this.relayout()
  }

  private layoutFlow(plan: PlanView): void {
    const pad = 20
    const originArea: Rect = { x: pad, y: pad, w: this.width * 0.44 - pad, h: this.height - pad * 2 }

    const shownOrigins = plan.origins.slice(0, MAX_ORIGIN_TILES)
    const restOrigins = plan.origins.slice(MAX_ORIGIN_TILES)
    const originItems = shownOrigins.map((o, i) => ({ key: String(i), bytes: o.bytes, label: o.label }))
    if (restOrigins.length > 0) {
      originItems.push({
        key: String(shownOrigins.length),
        bytes: restOrigins.reduce((sum, o) => sum + o.bytes, 0),
        label: `Pozostałe (${restOrigins.length})`,
      })
    }
    const rects = layout(originItems, originArea, 3)
    this.origins = originItems.map((item) => {
      const rect = rects.get(item.key) as Rect
      return { ...rect, label: item.label, total: Math.max(item.bytes, 1), remaining: Math.max(item.bytes, 1) }
    })
    this.originToSlot = plan.origins.map((_, i) => Math.min(i, MAX_ORIGIN_TILES))

    const shownBuckets = plan.buckets.slice(0, MAX_BUCKET_ROWS)
    const restBuckets = plan.buckets.slice(MAX_BUCKET_ROWS)
    const rowItems = shownBuckets.map((b, i) => ({
      label: b.label,
      count: b.count,
      bytes: b.bytes,
      color: b.category ? CATEGORY_COLORS[b.category as Category] : NEUTRAL_BUCKETS[i % NEUTRAL_BUCKETS.length],
    }))
    if (restBuckets.length > 0) {
      rowItems.push({
        label: `Pozostałe (${restBuckets.length})`,
        count: restBuckets.reduce((sum, b) => sum + b.count, 0),
        bytes: restBuckets.reduce((sum, b) => sum + b.bytes, 0),
        color: CATEGORY_COLORS.other,
      })
    }
    const rowX = this.width * 0.6
    const rowWidth = this.width - rowX - pad
    const rowHeight = Math.min(58, (this.height - pad * 2) / Math.max(rowItems.length, 1))
    const top = (this.height - rowHeight * rowItems.length) / 2
    const maxBytes = Math.max(...rowItems.map((r) => r.bytes), 1)
    this.rows = rowItems.map((item, i) => ({
      ...item,
      arrived: 0,
      x: rowX,
      y: top + rowHeight * i + rowHeight / 2,
      trackWidth: rowWidth * (0.22 + 0.78 * Math.sqrt(item.bytes / maxBytes)),
    }))
    this.bucketToRow = plan.buckets.map((_, i) => Math.min(i, MAX_BUCKET_ROWS))
    this.placeFlowLabels()
  }

  private label(index: number): Text {
    let text = this.labelPool[index]
    if (!text) {
      text = new Text({ text: '', style: { fontFamily: FONT, fontSize: 13, fill: TEXT } })
      this.labelPool.push(text)
      this.labels.addChild(text)
    }
    text.visible = true
    return text
  }

  private hideLabelsFrom(index: number): void {
    for (let i = index; i < this.labelPool.length; i++) this.labelPool[i].visible = false
  }

  private placeFlowLabels(): void {
    let used = 0
    for (const origin of this.origins) {
      if (origin.w < 76 || origin.h < 26 || used >= MAX_LABELS) continue
      const text = this.label(used++)
      text.text = truncate(origin.label, Math.floor((origin.w - 16) / 7))
      text.style.fontSize = 13
      text.style.fill = TEXT
      text.position.set(origin.x + 8, origin.y + 6)
    }
    for (const row of this.rows) {
      const title = this.label(used++)
      title.text = row.label
      title.style.fontSize = 14
      title.style.fill = TEXT
      title.position.set(row.x, row.y - 18)
      const detail = this.label(used++)
      detail.text = `${formatCount(row.count)} · ${formatBytes(row.bytes)}`
      detail.style.fontSize = 12
      detail.style.fill = MUTED
      detail.position.set(row.x + title.width + 10, row.y - 16)
    }
    this.hideLabelsFrom(used)
  }

  private acquireFlight(): Flight {
    const free = this.idle.pop()
    if (free) return free
    const sprite = new Particle({ texture: this.texture, anchorX: 0.5, anchorY: 0.5, alpha: 0 })
    const flight: Flight = {
      sprite,
      active: false,
      elapsed: 0,
      delay: 0,
      duration: 0,
      x0: 0,
      y0: 0,
      cx: 0,
      cy: 0,
      x1: 0,
      y1: 0,
      row: 0,
      slot: 0,
      bytes: 0,
      launched: false,
      scale: 1,
    }
    this.flights.push(flight)
    this.particles.addParticle(sprite)
    this.particles.update()
    return flight
  }

  private launch(rowIndex: number, slotIndex: number, category: number, size: number, bytes: number): void {
    const origin = this.origins[slotIndex]
    const row = this.rows[rowIndex]
    const flight = this.acquireFlight()
    flight.active = true
    flight.elapsed = 0
    flight.delay = Math.random() * 100
    flight.duration = 650 + Math.random() * 500
    flight.x0 = origin.x + Math.random() * origin.w
    flight.y0 = origin.y + Math.random() * origin.h
    flight.x1 = row.x - 4
    flight.y1 = row.y + 8 + (Math.random() - 0.5) * 8
    flight.cx = (flight.x0 + flight.x1) / 2 + (Math.random() - 0.5) * 60
    flight.cy = (flight.y0 + flight.y1) / 2 + (Math.random() - 0.5) * this.height * 0.28
    flight.row = rowIndex
    flight.slot = slotIndex
    flight.bytes = bytes
    flight.launched = false
    flight.scale = 0.22 + 0.5 * Math.min(1, Math.log10(size + 1) / 10)
    flight.sprite.tint = colorOfIndex(category)
    flight.sprite.scaleX = flight.scale
    flight.sprite.scaleY = flight.scale
    flight.sprite.x = flight.x0
    flight.sprite.y = flight.y0
    this.activeFlights++
  }

  private clearFlights(): void {
    for (const flight of this.flights) {
      if (flight.active) {
        flight.active = false
        flight.sprite.alpha = 0
        this.idle.push(flight)
      }
    }
    this.activeFlights = 0
  }

  private stepFlights(deltaMs: number): void {
    for (const flight of this.flights) {
      if (!flight.active) continue
      flight.elapsed += deltaMs
      const t = (flight.elapsed - flight.delay) / flight.duration
      if (t < 0) continue
      if (!flight.launched) {
        flight.launched = true
        this.origins[flight.slot].remaining -= flight.bytes
      }
      if (t >= 1) {
        this.rows[flight.row].arrived += flight.bytes
        flight.active = false
        flight.sprite.alpha = 0
        this.idle.push(flight)
        this.activeFlights--
        continue
      }
      const eased = t * t * (3 - 2 * t)
      const inverse = 1 - eased
      flight.sprite.x = inverse * inverse * flight.x0 + 2 * inverse * eased * flight.cx + eased * eased * flight.x1
      flight.sprite.y = inverse * inverse * flight.y0 + 2 * inverse * eased * flight.cy + eased * eased * flight.y1
      flight.sprite.alpha = Math.min(1, t * 6) * Math.min(1, (1 - t) * 8)
    }
  }

  private tick(deltaMs: number): void {
    if (this.mode === 'map') {
      this.stepMap(deltaMs)
    } else {
      this.stepFlights(deltaMs)
      this.drawFlow()
    }
  }

  private stepMap(deltaMs: number): void {
    const k = 1 - Math.exp(-deltaMs / EASE_MS)
    let moving = false
    for (const tile of this.tiles) {
      for (const prop of ['x', 'y', 'w', 'h'] as const) {
        const delta = tile.target[prop] - tile[prop]
        if (Math.abs(delta) > 0.3) {
          tile[prop] += delta * k
          moving = true
        } else {
          tile[prop] = tile.target[prop]
        }
      }
    }
    if (moving || this.mapDirty) this.drawMap()
    this.mapDirty = false
  }

  private drawMap(): void {
    const g = this.gfx
    g.clear()
    let used = 0
    const ranked = [...this.tiles].sort((a, b) => b.w * b.h - a.w * a.h)
    for (const visual of this.tiles) {
      const { x, y, w, h, tile } = visual
      if (w < 1 || h < 1) continue
      g.rect(x, y, w, h).fill(TILE_BASE)
      const parts = Object.entries(tile.byCategory) as [Category, number][]
      parts.sort((a, b) => b[1] - a[1])
      const total = parts.reduce((sum, [, bytes]) => sum + bytes, 0)
      let offset = 0
      for (const [category, bytes] of parts) {
        const share = total > 0 ? (bytes / total) * w : w / parts.length
        g.rect(x + offset, y, share, h).fill({ color: CATEGORY_COLORS[category], alpha: tile.isDir ? 0.62 : 0.8 })
        offset += share
      }
    }
    for (const visual of ranked) {
      if (used >= MAX_LABELS || visual.w < 84 || visual.h < 28) continue
      const text = this.label(used++)
      const size = formatBytes(visual.tile.bytes)
      text.text = truncate(`${visual.tile.label} · ${size}`, Math.floor((visual.w - 14) / 7))
      text.style.fontSize = 13
      text.style.fill = 0x0b0d0f
      text.position.set(visual.x + 7, visual.y + 5)
    }
    this.hideLabelsFrom(used)
  }

  private drawFlow(): void {
    const g = this.gfx
    g.clear()
    for (const origin of this.origins) {
      g.rect(origin.x, origin.y, origin.w, origin.h).fill(DRAINED)
      const share = Math.max(0, origin.remaining) / origin.total
      const height = origin.h * share
      g.rect(origin.x, origin.y + origin.h - height, origin.w, height).fill(0x323a43)
    }
    for (const row of this.rows) {
      g.roundRect(row.x, row.y + 4, row.trackWidth, 8, 4).fill(TRACK)
      const share = Math.min(1, row.arrived / Math.max(row.bytes, 1))
      if (share > 0) g.roundRect(row.x, row.y + 4, Math.max(8, row.trackWidth * share), 8, 4).fill(row.color)
    }
  }

  private tileAt(x: number, y: number): TreeTile | null {
    if (this.mode !== 'map') return null
    for (const visual of this.tiles) {
      if (x >= visual.x && x < visual.x + visual.w && y >= visual.y && y < visual.y + visual.h) return visual.tile
    }
    return null
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.callbacks.onHover(this.tileAt(event.offsetX, event.offsetY), event.offsetX, event.offsetY)
  }

  private readonly handlePointerLeave = (): void => {
    this.callbacks.onHover(null, 0, 0)
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const tile = this.tileAt(event.offsetX, event.offsetY)
    if (tile?.isDir) this.callbacks.onOpen(tile)
  }
}
