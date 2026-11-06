import { useState } from 'react'
import { PlanPanel, RunPanel, ScanPanel, SummaryPanel } from './Panels'
import { Drawer } from './Drawer'
import { Scene } from './Scene'
import { CATEGORIES } from '../core/types'
import { LANGUAGES } from '../shared/i18n'
import { api, CATEGORY_COLORS, cssColor, formatBytes, formatCount, formatDate } from './lib'
import { useApp } from './store'
import type { Stage } from './store'
import { useT } from './useT'

export type DrawerTarget = { kind: 'group'; group: string | null } | { kind: 'duplicates' } | { kind: 'topics' } | null

function LanguageSwitch({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  const { language, t } = useT()
  const setLanguage = useApp((s) => s.setLanguage)
  return (
    <div className="seg" role="group" aria-label={t('language.label')} data-testid="language-switch">
      {LANGUAGES.map((option) => (
        <button
          key={option}
          aria-pressed={language === option}
          disabled={disabled}
          onClick={() => void setLanguage(option)}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

function StartScreen(): React.JSX.Element {
  const [path, setPath] = useState('')
  const { t, plural } = useT()
  const drives = useApp((s) => s.drives)
  const sessions = useApp((s) => s.sessions)
  const startScan = useApp((s) => s.startScan)
  const undo = useApp((s) => s.undo)
  const undoing = useApp((s) => s.undoing)
  const undoResult = useApp((s) => s.undoResult)

  const pick = async (): Promise<void> => {
    const folder = await api().pickFolder(t('start.pickTitle'))
    if (folder) {
      setPath(folder)
      await startScan(folder)
    }
  }

  const interrupted = sessions.filter((s) => s.status === 'interrupted' && s.pending > 0)

  return (
    <main className="start">
      <div className="start-language">
        <LanguageSwitch disabled={undoing !== null} />
      </div>
      <header>
        <h1>{t('start.title')}</h1>
        <p className="lead">{t('start.lead')}</p>
      </header>

      {interrupted.map((session) => (
        <p className="note bad" key={session.id}>
          {t('start.interrupted', { root: session.root })}{' '}
          <button className="btn" disabled={undoing !== null} onClick={() => void undo(session.id)}>
            {t('start.finishUndo', { count: formatCount(session.pending) })}
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
          aria-label={t('start.pathLabel')}
          placeholder={t('start.pathPlaceholder')}
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <button className="btn" type="button" onClick={() => void pick()}>
          {t('start.pick')}
        </button>
        <button className="btn primary" type="submit" disabled={!path.trim()}>
          {t('start.scan')}
        </button>
      </form>

      {drives.length > 0 && (
        <section>
          <h2 className="section-title">{t('start.drives')}</h2>
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
                    {t('start.driveFree', {
                      free: formatBytes(drive.freeBytes),
                      total: formatBytes(drive.totalBytes),
                    })}
                  </small>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {undoing && (
        <p className="note">
          {t('undo.progress', { done: formatCount(undoing.done), total: formatCount(undoing.total) })}
        </p>
      )}
      {undoResult && (
        <p className="note">
          {t('undo.summary', {
            restored: formatCount(undoResult.restored),
            conflicts: formatCount(undoResult.conflicts.length),
            lost: formatCount(undoResult.lost.length),
          })}
        </p>
      )}

      {sessions.length > 0 && (
        <section>
          <h2 className="section-title">{t('start.history')}</h2>
          {sessions.slice(0, 8).map((session) => (
            <div className="session" key={session.id}>
              <span className="path mono">{session.root}</span>
              <small>
                {formatDate(session.startedAt)} · {plural('files', session.moved)} · {t(`status.${session.status}`)}
              </small>
              <button
                className="btn"
                disabled={session.pending === 0 || undoing !== null}
                onClick={() => void undo(session.id)}
              >
                {t('start.undo')}
              </button>
            </div>
          ))}
        </section>
      )}
    </main>
  )
}

const STEPS: Exclude<Stage, 'start'>[] = ['scan', 'plan', 'run', 'summary']

function Workspace(): React.JSX.Element {
  const { t, labels } = useT()
  const stage = useApp((s) => s.stage)
  const root = useApp((s) => s.root)
  const scan = useApp((s) => s.scan)
  const focus = useApp((s) => s.focus)
  const focusUp = useApp((s) => s.focusUp)
  const simulating = useApp((s) => s.simulating)
  const undoing = useApp((s) => s.undoing)
  const backToStart = useApp((s) => s.backToStart)
  const [drawer, setDrawer] = useState<DrawerTarget>(null)
  const scanning = stage === 'scan' && scan?.phase !== 'done' && scan?.phase !== 'cancelled'
  const busy = stage === 'run' || simulating || scanning || undoing !== null

  return (
    <div className="workspace">
      <div className="topbar">
        <button className="btn ghost" disabled={busy} onClick={backToStart}>
          {t('nav.back')}
        </button>
        <span className="root-path mono">{root}</span>
        <div className="steps">
          {STEPS.map((step) => (
            <span key={step}>{step === stage ? <b>{t(`step.${step}`)}</b> : t(`step.${step}`)}</span>
          ))}
        </div>
        <LanguageSwitch disabled={busy} />
      </div>

      <div className="canvas-wrap">
        <Scene />
        {stage === 'scan' && !scan && <div className="empty-scene">{t('scene.starting')}</div>}
        {stage === 'scan' && focus?.parent && (
          <button className="btn crumb" onClick={() => void focusUp()}>
            {t('nav.up')}
          </button>
        )}
        {simulating && <div className="banner">{t('scene.simulation')}</div>}
        {drawer && <Drawer target={drawer} onClose={() => setDrawer(null)} />}
      </div>

      <aside className="panel">
        {stage === 'scan' && <ScanPanel />}
        {stage === 'plan' && <PlanPanel onOpen={setDrawer} />}
        {stage === 'run' && <RunPanel />}
        {stage === 'summary' && <SummaryPanel />}
      </aside>

      <div className="legend" aria-label={t('scene.legend')}>
        {CATEGORIES.map((category) => (
          <span key={category}>
            <i style={{ background: cssColor(CATEGORY_COLORS[category]) }} />
            {labels.categories[category]}
          </span>
        ))}
      </div>
    </div>
  )
}

export function App(): React.JSX.Element {
  const { t } = useT()
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
            {t('common.close')}
          </button>
        </div>
      )}
    </>
  )
}
