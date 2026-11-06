import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useState } from 'react'
import type { Dimension } from '../core/types'
import type { DrawerTarget } from './App'
import { api, FAILURE_LABELS, formatBytes, formatCount, SKIP_LABELS } from './lib'
import { useApp } from './store'

const PHASE_LABELS = {
  walk: 'Czytam strukturę folderów',
  enrich: 'Rozpoznaję zawartość plików',
  duplicates: 'Szukam duplikatów',
  done: 'Skan zakończony',
  cancelled: 'Skan przerwany',
} as const

const DIMENSIONS: { id: Dimension; label: string }[] = [
  { id: 'type', label: 'Typ' },
  { id: 'year', label: 'Rok' },
  { id: 'month', label: 'Miesiąc' },
  { id: 'size', label: 'Rozmiar' },
]

const isDriveRoot = (p: string): boolean => /^[A-Za-z]:\\?$/.test(p.trim())

function Meter({ value, total }: { value: number; total: number }): React.JSX.Element {
  return (
    <div
      className="meter"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={Math.max(total, 1)}
    >
      <i style={{ width: `${total > 0 ? Math.min(100, (value / total) * 100) : 0}%` }} />
    </div>
  )
}

export function ScanPanel(): React.JSX.Element {
  const scan = useApp((s) => s.scan)
  const cancel = useApp((s) => s.cancel)
  const goToPlan = useApp((s) => s.goToPlan)
  const backToStart = useApp((s) => s.backToStart)
  const phase = scan?.phase ?? 'walk'
  const finished = phase === 'done' || phase === 'cancelled'

  return (
    <>
      <div className="panel-body">
        <h2 data-testid="scan-phase">{PHASE_LABELS[phase]}</h2>
        {scan && scan.total > 0 && phase !== 'done' && <Meter value={scan.done} total={scan.total} />}
        <dl className="stats">
          <div>
            <dt>Pliki</dt>
            <dd>{formatCount(scan?.stats.files ?? 0)}</dd>
          </div>
          <div>
            <dt>Rozmiar</dt>
            <dd>{formatBytes(scan?.stats.bytes ?? 0)}</dd>
          </div>
          <div>
            <dt>Foldery</dt>
            <dd>{formatCount(scan?.stats.dirs ?? 0)}</dd>
          </div>
          <div>
            <dt>Projekty</dt>
            <dd>{formatCount(scan?.stats.units ?? 0)}</dd>
          </div>
        </dl>
        {scan?.cloud && (
          <p className="note warn">Ten folder leży w OneDrive. Pomijam czytanie zawartości, żeby nie pobierać plików z chmury.</p>
        )}
        {scan && scan.duplicateGroups > 0 && (
          <p className="note">
            Duplikaty: {formatCount(scan.duplicateGroups)} grup, do odzyskania {formatBytes(scan.duplicateBytes)}.
          </p>
        )}
        {scan && scan.mismatched > 0 && (
          <p className="note">Pliki z rozszerzeniem niezgodnym z zawartością: {formatCount(scan.mismatched)}.</p>
        )}
        {scan && scan.stats.errors > 0 && (
          <p className="note warn">Pominięto niedostępne elementy: {formatCount(scan.stats.errors)}.</p>
        )}
        {scan && scan.stats.skippedLinks > 0 && (
          <p className="note">Pominięte dowiązania: {formatCount(scan.stats.skippedLinks)}.</p>
        )}
      </div>
      <div className="panel-foot">
        {!finished && (
          <button className="btn" onClick={() => void cancel()}>
            Przerwij skan
          </button>
        )}
        {phase === 'done' && (
          <button className="btn primary" onClick={() => void goToPlan()}>
            Zaplanuj porządek
          </button>
        )}
        {phase === 'cancelled' && (
          <button className="btn" onClick={backToStart}>
            Wróć
          </button>
        )}
      </div>
    </>
  )
}

function GroupList({ onOpen }: { onOpen: (target: DrawerTarget) => void }): React.JSX.Element {
  const groups = useApp((s) => s.plan?.groups ?? [])
  const scroller = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 35,
    overscan: 10,
  })
  return (
    <div className="group-list" ref={scroller} data-testid="group-list">
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => {
          const group = groups[item.index]
          return (
            <button
              className="group-row"
              key={group.key}
              style={{ top: item.start, height: item.size }}
              onClick={() => onOpen({ kind: 'group', group: group.key })}
            >
              <span className="name" title={group.key}>
                {group.key}
              </span>
              <span className="size num">
                {formatCount(group.count)} · {formatBytes(group.bytes)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ConfirmDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const plan = useApp((s) => s.plan)
  const root = useApp((s) => s.root)
  const execute = useApp((s) => s.execute)
  const [accepted, setAccepted] = useState(false)
  const wholeDrive = isDriveRoot(root)
  if (!plan) return <></>
  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">Przenieść {formatCount(plan.moveCount)} elementów?</h2>
        <p>
          {formatBytes(plan.totalBytes)} trafi do <span className="mono">{plan.options.targetRoot}</span>. Żaden plik nie
          zostanie usunięty ani nadpisany, a całość można cofnąć.
        </p>
        {wholeDrive && (
          <label className="check">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            Rozumiem, że porządkuję cały dysk {root}
          </label>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Anuluj
          </button>
          <button
            className="btn primary"
            disabled={wholeDrive && !accepted}
            onClick={() => {
              onClose()
              void execute()
            }}
          >
            Przenieś pliki
          </button>
        </div>
      </div>
    </div>
  )
}

export function PlanPanel({ onOpen }: { onOpen: (target: DrawerTarget) => void }): React.JSX.Element {
  const plan = useApp((s) => s.plan)
  const scan = useApp((s) => s.scan)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const simulate = useApp((s) => s.simulate)
  const simulating = useApp((s) => s.simulating)
  const [confirming, setConfirming] = useState(false)

  const toggle = (dimension: Dimension): void => {
    const { dimensions } = settings
    const next = dimensions.includes(dimension)
      ? dimensions.filter((d) => d !== dimension)
      : [...dimensions, dimension]
    if (next.length > 0) void updateSettings({ dimensions: next })
  }

  const pickTarget = async (): Promise<void> => {
    const folder = await api().pickFolder()
    if (folder) void updateSettings({ targetRoot: folder })
  }

  return (
    <>
      <div className="panel-body">
        <div>
          <h3 className="section-title">Grupuj wg (kolejność ma znaczenie)</h3>
          <div className="chips">
            {DIMENSIONS.map(({ id, label }) => {
              const position = settings.dimensions.indexOf(id)
              return (
                <button className="chip" key={id} aria-pressed={position >= 0} onClick={() => toggle(id)}>
                  {position >= 0 && <i>{position + 1}</i>}
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <h3 className="section-title">Folder docelowy</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="input mono"
              aria-label="Folder docelowy"
              value={settings.targetRoot}
              onChange={(event) => void updateSettings({ targetRoot: event.target.value })}
            />
            <button className="btn" onClick={() => void pickTarget()}>
              Zmień
            </button>
          </div>
        </div>

        {plan && plan.topics.length > 0 && (
          <div>
            <h3 className="section-title">Kontekst</h3>
            <p className="note">
              W całości: {formatCount(plan.topics.filter((t) => t.decision === 'whole').length)}, zostaje:{' '}
              {formatCount(plan.topics.filter((t) => t.decision === 'keep').length)}, rozbite:{' '}
              {formatCount(plan.topics.filter((t) => t.decision === 'split').length)}.
            </p>
            <button
              className="btn ghost"
              style={{ paddingLeft: 0 }}
              data-testid="open-topics"
              onClick={() => onOpen({ kind: 'topics' })}
            >
              Foldery tematyczne ({formatCount(plan.topics.length)})
            </button>
          </div>
        )}

        {scan && scan.duplicateGroups > 0 && (
          <div>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.separateDuplicates}
                onChange={(event) => void updateSettings({ separateDuplicates: event.target.checked })}
              />
              Odłóż kopie do _Duplikaty ({formatCount(plan?.duplicateCount ?? 0)})
            </label>
            <button className="btn ghost" style={{ paddingLeft: 0 }} onClick={() => onOpen({ kind: 'duplicates' })}>
              Wybierz, który egzemplarz zostaje
            </button>
          </div>
        )}

        {plan && (
          <dl className="stats">
            <div>
              <dt>Do przeniesienia</dt>
              <dd data-testid="plan-count">{formatCount(plan.moveCount)}</dd>
            </div>
            <div>
              <dt>Rozmiar</dt>
              <dd>{formatBytes(plan.totalBytes)}</dd>
            </div>
            {plan.kept > 0 && (
              <div>
                <dt>Zostaje na miejscu</dt>
                <dd data-testid="plan-kept">{formatCount(plan.kept)}</dd>
              </div>
            )}
          </dl>
        )}

        {plan && plan.alreadySorted > 0 && (
          <p className="note">Już posortowane i pozostawione bez zmian: {formatCount(plan.alreadySorted)}.</p>
        )}
        {plan && plan.skipped.length > 0 && (
          <p className="note warn">
            Pominięte: {formatCount(plan.skipped.length)}. Pierwszy powód: {SKIP_LABELS[plan.skipped[0].reason]}.
          </p>
        )}
        <GroupList onOpen={onOpen} />
      </div>
      <div className="panel-foot">
        <button className="btn" disabled={!plan || plan.moveCount === 0 || simulating} onClick={() => void simulate()}>
          {simulating ? 'Symulacja trwa…' : 'Pokaż symulację'}
        </button>
        <button
          className="btn primary"
          disabled={!plan || plan.moveCount === 0 || simulating}
          onClick={() => setConfirming(true)}
        >
          Przenieś {formatCount(plan?.moveCount ?? 0)} elementów
        </button>
      </div>
      {confirming && <ConfirmDialog onClose={() => setConfirming(false)} />}
    </>
  )
}

export function RunPanel(): React.JSX.Element {
  const flow = useApp((s) => s.flow)
  const plan = useApp((s) => s.plan)
  const cancel = useApp((s) => s.cancel)
  const total = flow?.total ?? plan?.moveCount ?? 0
  return (
    <>
      <div className="panel-body">
        <h2>Przenoszę pliki</h2>
        <Meter value={flow?.done ?? 0} total={total} />
        <dl className="stats">
          <div>
            <dt>Gotowe</dt>
            <dd>
              {formatCount(flow?.done ?? 0)} / {formatCount(total)}
            </dd>
          </div>
          <div>
            <dt>Przeniesiono</dt>
            <dd>{formatBytes(flow?.bytes ?? 0)}</dd>
          </div>
          <div>
            <dt>Pominięte</dt>
            <dd>{formatCount(flow?.failed ?? 0)}</dd>
          </div>
        </dl>
      </div>
      <div className="panel-foot">
        <button className="btn" onClick={() => void cancel()}>
          Zatrzymaj
        </button>
      </div>
    </>
  )
}

export function SummaryPanel(): React.JSX.Element {
  const run = useApp((s) => s.run)
  const plan = useApp((s) => s.plan)
  const root = useApp((s) => s.root)
  const undo = useApp((s) => s.undo)
  const undoing = useApp((s) => s.undoing)
  const undoResult = useApp((s) => s.undoResult)
  const startScan = useApp((s) => s.startScan)
  if (!run) return <></>

  return (
    <>
      <div className="panel-body">
        <h2 data-testid="summary-title">{run.cancelled ? 'Sortowanie zatrzymane' : 'Gotowe'}</h2>
        <dl className="stats">
          <div>
            <dt>Przeniesiono</dt>
            <dd data-testid="summary-moved">{formatCount(run.moved)}</dd>
          </div>
          <div>
            <dt>Pominięte</dt>
            <dd>{formatCount(run.failed.length)}</dd>
          </div>
        </dl>
        {undoing && (
          <>
            <p className="note">
              Cofanie: {formatCount(undoing.done)} z {formatCount(undoing.total)}
            </p>
            <Meter value={undoing.done} total={undoing.total} />
          </>
        )}
        {undoResult && (
          <p className="note" data-testid="undo-result">
            Cofnięto {formatCount(undoResult.restored)}. Konflikty: {formatCount(undoResult.conflicts.length)}, brakujące:{' '}
            {formatCount(undoResult.lost.length)}.
          </p>
        )}
        {undoResult?.conflicts.length ? (
          <ul className="fail-list">
            {undoResult.conflicts.slice(0, 50).map((conflict) => (
              <li key={conflict.to}>
                {conflict.reason}
                <span className="mono">{conflict.to}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {run.failed.length > 0 && (
          <div>
            <h3 className="section-title">Pominięte pliki</h3>
            <ul className="fail-list">
              {run.failed.slice(0, 100).map((failure) => (
                <li key={failure.path}>
                  {FAILURE_LABELS[failure.reason]}
                  <span className="mono">{failure.path}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="panel-foot">
        {run.manifest && undoResult === null && (
          <button className="btn" onClick={() => void api().reveal(run.manifest as string)}>
            Pokaż spis zmian (CSV)
          </button>
        )}
        {plan && (
          <button className="btn" onClick={() => void api().reveal(plan.options.targetRoot)}>
            Pokaż w Eksploratorze
          </button>
        )}
        <button
          className="btn"
          disabled={undoing !== null || undoResult !== null || run.moved === 0}
          onClick={() => void undo(run.sessionId)}
        >
          Cofnij wszystko
        </button>
        <button className="btn primary" disabled={undoing !== null} onClick={() => void startScan(root)}>
          Skanuj ponownie
        </button>
      </div>
    </>
  )
}
