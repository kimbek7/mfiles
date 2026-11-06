import { useState } from 'react'
import { PlanPanel, RunPanel, ScanPanel, SummaryPanel } from './Panels'
import { Drawer } from './Drawer'
import { Scene } from './Scene'
import { CATEGORIES, CATEGORY_LABELS } from '../core/types'
import { api, CATEGORY_COLORS, cssColor, formatBytes, formatCount, formatDate, STATUS_LABELS } from './lib'
import { useApp } from './store'
import type { Stage } from './store'

export type DrawerTarget = { kind: 'group'; group: string | null } | { kind: 'duplicates' } | { kind: 'topics' } | null

function StartScreen(): React.JSX.Element {
  const [path, setPath] = useState('')
  const drives = useApp((s) => s.drives)
  const sessions = useApp((s) => s.sessions)
  const startScan = useApp((s) => s.startScan)
  const undo = useApp((s) => s.undo)
  const undoing = useApp((s) => s.undoing)
  const undoResult = useApp((s) => s.undoResult)

  const pick = async (): Promise<void> => {
    const folder = await api().pickFolder()
    if (folder) {
      setPath(folder)
      await startScan(folder)
    }
  }

  const interrupted = sessions.filter((s) => s.status === 'interrupted' && s.pending > 0)

  return (
    <main className="start">
      <header>
        <h1>Zrób porządek w plikach i zobacz, jak to się dzieje</h1>
        <p className="lead">Najpierw podgląd zmian. Pliki ruszają się dopiero po Twojej zgodzie, a każdy ruch można cofnąć.</p>
      </header>

      {interrupted.map((session) => (
        <p className="note bad" key={session.id}>
          Sortowanie folderu {session.root} zostało przerwane przed końcem.{' '}
          <button className="btn" disabled={undoing !== null} onClick={() => void undo(session.id)}>
            Dokończ cofanie ({formatCount(session.pending)})
          </button>
        </p>
      ))}

      <form
        className="picker"
        onSubmit={(event) => {
          event.preventDefault()
          void startScan(path)
        }}
      >
        <input
          className="input mono"
          aria-label="Ścieżka folderu"
          placeholder="C:\Users\...\Pobrane"
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <button className="btn" type="button" onClick={() => void pick()}>
          Wybierz…
        </button>
        <button className="btn primary" type="submit" disabled={!path.trim()}>
          Skanuj
        </button>
      </form>

      {drives.length > 0 && (
        <section>
          <h2 className="section-title">Dyski</h2>
          <div className="drives">
            {drives.map((drive) => {
              const used = drive.totalBytes - drive.freeBytes
              return (
                <button className="drive" key={drive.path} onClick={() => void startScan(drive.path)}>
                  <strong>{drive.path}</strong>
                  <div className="meter">
                    <i style={{ width: `${(used / Math.max(drive.totalBytes, 1)) * 100}%` }} />
                  </div>
                  <small>
                    {formatBytes(drive.freeBytes)} wolne z {formatBytes(drive.totalBytes)}
                  </small>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {undoing && (
        <p className="note">
          Cofanie: {formatCount(undoing.done)} z {formatCount(undoing.total)}
        </p>
      )}
      {undoResult && (
        <p className="note">
          Cofnięto {formatCount(undoResult.restored)}. Konflikty: {formatCount(undoResult.conflicts.length)}, brakujące:{' '}
          {formatCount(undoResult.lost.length)}.
        </p>
      )}

      {sessions.length > 0 && (
        <section>
          <h2 className="section-title">Historia</h2>
          {sessions.slice(0, 8).map((session) => (
            <div className="session" key={session.id}>
              <span className="path mono">{session.root}</span>
              <small>
                {formatDate(session.startedAt)} · {formatCount(session.moved)} plików · {STATUS_LABELS[session.status]}
              </small>
              <button
                className="btn"
                disabled={session.pending === 0 || undoing !== null}
                onClick={() => void undo(session.id)}
              >
                Cofnij
              </button>
            </div>
          ))}
        </section>
      )}
    </main>
  )
}

const STEPS: { stage: Stage; label: string }[] = [
  { stage: 'scan', label: 'Skan' },
  { stage: 'plan', label: 'Plan' },
  { stage: 'run', label: 'Sortowanie' },
  { stage: 'summary', label: 'Wynik' },
]

function Workspace(): React.JSX.Element {
  const stage = useApp((s) => s.stage)
  const root = useApp((s) => s.root)
  const scan = useApp((s) => s.scan)
  const focus = useApp((s) => s.focus)
  const focusUp = useApp((s) => s.focusUp)
  const simulating = useApp((s) => s.simulating)
  const backToStart = useApp((s) => s.backToStart)
  const [drawer, setDrawer] = useState<DrawerTarget>(null)
  const busy = stage === 'run' || simulating || (stage === 'scan' && scan?.phase !== 'done' && scan?.phase !== 'cancelled')

  return (
    <div className="workspace">
      <div className="topbar">
        <button className="btn ghost" disabled={busy} onClick={backToStart}>
          ← Start
        </button>
        <span className="root-path mono">{root}</span>
        <div className="steps">
          {STEPS.map((step) => (
            <span key={step.stage}>{step.stage === stage ? <b>{step.label}</b> : step.label}</span>
          ))}
        </div>
      </div>

      <div className="canvas-wrap">
        <Scene />
        {stage === 'scan' && !scan && <div className="empty-scene">Zaczynam skan…</div>}
        {stage === 'scan' && focus?.parent && (
          <button className="btn crumb" onClick={() => void focusUp()}>
            ← Wyżej
          </button>
        )}
        {simulating && <div className="banner">Symulacja: żaden plik nie jest przenoszony</div>}
        {drawer && <Drawer target={drawer} onClose={() => setDrawer(null)} />}
      </div>

      <aside className="panel">
        {stage === 'scan' && <ScanPanel />}
        {stage === 'plan' && <PlanPanel onOpen={setDrawer} />}
        {stage === 'run' && <RunPanel />}
        {stage === 'summary' && <SummaryPanel />}
      </aside>

      <div className="legend" aria-label="Legenda kategorii">
        {CATEGORIES.map((category) => (
          <span key={category}>
            <i style={{ background: cssColor(CATEGORY_COLORS[category]) }} />
            {CATEGORY_LABELS[category]}
          </span>
        ))}
      </div>
    </div>
  )
}

export function App(): React.JSX.Element {
  const stage = useApp((s) => s.stage)
  const error = useApp((s) => s.error)
  const dismissError = useApp((s) => s.dismissError)
  return (
    <>
      {stage === 'start' ? <StartScreen /> : <Workspace />}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="btn ghost" onClick={dismissError}>
            Zamknij
          </button>
        </div>
      )}
    </>
  )
}
