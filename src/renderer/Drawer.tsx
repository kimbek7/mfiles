import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CATEGORY_LABELS } from '../core/types'
import type { DuplicateGroup, FolderDecision } from '../core/types'
import type { PlanFile } from '../shared/api'
import type { DrawerTarget } from './App'
import { api, formatBytes, formatCount } from './lib'
import { useApp } from './store'

const PAGE_SIZE = 200

const DECISIONS: { id: FolderDecision; label: string; hint: string }[] = [
  { id: 'whole', label: 'W całości', hint: 'Folder trafi do Tematy bez zmian w środku' },
  { id: 'keep', label: 'Zostaw', hint: 'Folder pozostanie tam, gdzie jest' },
  { id: 'split', label: 'Rozbij', hint: 'Pliki zostaną pogrupowane, a podfoldery ocenione osobno' },
]

function Topics(): React.JSX.Element {
  const topics = useApp((s) => s.plan?.topics ?? [])
  const setFolderDecision = useApp((s) => s.setFolderDecision)
  const scroller = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: topics.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 62,
    overscan: 10,
    getItemKey: (index) => topics[index].path,
  })

  return (
    <div className="drawer-list" ref={scroller} data-testid="topic-list">
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((row) => {
          const topic = topics[row.index]
          return (
            <div className="topic-row" key={topic.path} style={{ top: row.start, height: row.size }}>
              <div className="topic-text">
                <strong title={topic.path}>{topic.relative}</strong>
                <small>
                  {formatCount(topic.files)} · {formatBytes(topic.bytes)} ·{' '}
                  {topic.categories.map((c) => CATEGORY_LABELS[c]).join(', ')}
                </small>
              </div>
              <div className="seg" role="group" aria-label={`Decyzja dla ${topic.relative}`}>
                {DECISIONS.map(({ id, label, hint }) => (
                  <button
                    key={id}
                    title={hint}
                    aria-pressed={topic.decision === id}
                    onClick={() => void setFolderDecision(topic.path, id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GroupFiles({ planId, group }: { planId: string; group: string | null }): React.JSX.Element {
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<(PlanFile | undefined)[]>([])
  const loaded = useRef(new Set<number>())
  const scroller = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: total,
    getScrollElement: () => scroller.current,
    estimateSize: () => 50,
    overscan: 12,
  })

  const loadPage = useCallback(
    async (page: number) => {
      if (loaded.current.has(page)) return
      loaded.current.add(page)
      const result = await api().call('planFiles', planId, group, page * PAGE_SIZE, PAGE_SIZE)
      setTotal(result.total)
      setItems((current) => {
        const next = [...current]
        result.items.forEach((item, i) => {
          next[page * PAGE_SIZE + i] = item
        })
        return next
      })
    },
    [planId, group],
  )

  useEffect(() => {
    loaded.current.clear()
    setItems([])
    void loadPage(0)
  }, [loadPage])

  const visible = virtual.getVirtualItems()
  const firstPage = visible.length > 0 ? Math.floor(visible[0].index / PAGE_SIZE) : 0
  const lastPage = visible.length > 0 ? Math.floor(visible[visible.length - 1].index / PAGE_SIZE) : 0
  useEffect(() => {
    for (let page = firstPage; page <= lastPage; page++) void loadPage(page)
  }, [firstPage, lastPage, loadPage])

  return (
    <div className="drawer-list" ref={scroller}>
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {visible.map((row) => {
          const item = items[row.index]
          return (
            <div className="file-row" key={row.index} style={{ top: row.start, height: row.size }}>
              <div className="mono" title={item?.from}>
                {item?.from ?? '…'}
              </div>
              <div className="to mono" title={item?.to}>
                → {item?.to ?? ''} {item ? `(${formatBytes(item.size)})` : ''}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Duplicates(): React.JSX.Element {
  const rebuildPlan = useApp((s) => s.rebuildPlan)
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [total, setTotal] = useState(0)

  const loadMore = useCallback(async (offset: number) => {
    const page = await api().call('duplicates', offset, PAGE_SIZE)
    setTotal(page.total)
    setGroups((current) => [...current.slice(0, offset), ...page.groups])
  }, [])

  useEffect(() => {
    void loadMore(0)
  }, [loadMore])

  const choose = async (group: DuplicateGroup, keeper: string): Promise<void> => {
    await api().call('setKeeper', group.hash, keeper)
    setGroups((current) => current.map((g) => (g.hash === group.hash ? { ...g, keeper } : g)))
    await rebuildPlan()
  }

  return (
    <div className="drawer-list">
      {groups.map((group) => (
        <fieldset className="dup-group" key={group.hash} style={{ border: 0, margin: 0 }}>
          <legend className="num" style={{ float: 'left', width: '100%', marginBottom: 6 }}>
            {formatCount(group.paths.length)} × {formatBytes(group.size)}
          </legend>
          {group.paths.map((path) => (
            <label className="mono" key={path}>
              <input
                type="radio"
                name={group.hash}
                checked={group.keeper === path}
                onChange={() => void choose(group, path)}
              />
              {path}
            </label>
          ))}
        </fieldset>
      ))}
      {groups.length < total && (
        <button className="btn ghost" onClick={() => void loadMore(groups.length)}>
          Pokaż kolejne
        </button>
      )}
    </div>
  )
}

export function Drawer({ target, onClose }: { target: DrawerTarget; onClose: () => void }): React.JSX.Element {
  const plan = useApp((s) => s.plan)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!target || !plan) return <></>
  const title =
    target.kind === 'group'
      ? (target.group ?? 'Wszystkie pliki')
      : target.kind === 'topics'
        ? 'Foldery tematyczne: co zrobić z każdym z nich?'
        : 'Który egzemplarz zostaje?'
  return (
    <section className="drawer" aria-label="Szczegóły">
      <header>
        <strong>{title}</strong>
        <button className="btn ghost" onClick={onClose}>
          Zamknij
        </button>
      </header>
      {target.kind === 'group' && <GroupFiles planId={plan.id} group={target.group} />}
      {target.kind === 'duplicates' && <Duplicates />}
      {target.kind === 'topics' && <Topics />}
    </section>
  )
}
