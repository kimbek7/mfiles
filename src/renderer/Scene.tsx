import { useEffect, useMemo, useRef, useState } from 'react'
import type { TreeTile } from '../core/types'
import { translate } from '../shared/i18n'
import { flowBus, formatBytes } from './lib'
import { SceneController } from './scene/SceneController'
import { useApp } from './store'
import { useT } from './useT'

interface Hover {
  tile: TreeTile
  x: number
  y: number
}

const SIMULATION_RESET_MS = 1800

export function Scene(): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [scene, setScene] = useState<SceneController | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const stage = useApp((s) => s.stage)
  const rawTiles = useApp((s) => s.focus?.tiles ?? s.scan?.tiles)
  const { t, plural, labels, language } = useT()
  const tiles = useMemo(
    () =>
      rawTiles?.map((tile) => {
        if (tile.kind === 'loose' && tile.category) return { ...tile, label: labels.categories[tile.category] }
        if (tile.kind === 'rest') return { ...tile, label: t('scene.rest', { count: tile.restCount ?? 0 }) }
        return tile
      }),
    [rawTiles, labels, t],
  )
  const plan = useApp((s) => s.plan)
  const openTile = useApp((s) => s.openTile)
  const undoResult = useApp((s) => s.undoResult)
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    let created: SceneController | null = null
    let disposed = false
    void SceneController.create(host.current as HTMLDivElement, {
      onHover: (tile, x, y) => setHover(tile ? { tile, x, y } : null),
      onOpen: (tile) => void openTile(tile),
      restLabel: (count) => translate(useApp.getState().language, 'scene.rest', { count }),
    }).then((controller) => {
      if (disposed) {
        controller.destroy()
        return
      }
      created = controller
      setScene(controller)
    })
    return () => {
      disposed = true
      created?.destroy()
    }
  }, [openTile])

  useEffect(() => {
    if (!scene) return
    if (stage === 'scan' && tiles) scene.showTiles(tiles)
    else if (stage !== 'scan' && plan) scene.showFlow(plan)
  }, [scene, stage, tiles, plan, language])

  useEffect(() => {
    if (!scene) return undefined
    return flowBus.subscribe((event) => {
      scene.addParticles(event.particles)
      if (event.mode === 'simulated' && event.finished) {
        resetTimer.current = setTimeout(() => scene.resetFlow(), SIMULATION_RESET_MS)
      }
    })
  }, [scene])

  useEffect(() => {
    if (stage !== 'run') return
    clearTimeout(resetTimer.current)
    scene?.resetFlow()
  }, [scene, stage])

  useEffect(() => {
    if (undoResult) scene?.resetFlow()
  }, [scene, undoResult])

  return (
    <div className="scene" ref={host} data-testid="scene">
      {hover && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hover.tile.label}</strong>
          <span>
            {formatBytes(hover.tile.bytes)} · {plural('files', hover.tile.files)}
          </span>
          {hover.tile.isDir && <em>{t('scene.open')}</em>}
        </div>
      )}
    </div>
  )
}
