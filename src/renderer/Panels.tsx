import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useState } from 'react'
import { UNDO_CONFLICT_DIFFERS } from '../shared/i18n'
import type { Dimension } from '../core/types'
import type { DrawerTarget } from './App'
import { api, formatBytes, formatCount } from './lib'
import { useApp } from './store'
import { useT } from './useT'

const DIMENSIONS: Dimension[] = ['type', 'year', 'month', 'size']

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
  const { t } = useT()
  const scan = useApp((s) => s.scan)
  const cancel = useApp((s) => s.cancel)
  const goToPlan = useApp((s) => s.goToPlan)
  const backToStart = useApp((s) => s.backToStart)
  const phase = scan?.phase ?? 'walk'
  const finished = phase === 'done' || phase === 'cancelled'

  return (
    <>
      <div className="panel-body">
        <h2 data-testid="scan-phase">{t(`scan.${phase}`)}</h2>
        {scan && scan.total > 0 && phase !== 'done' && <Meter value={scan.done} total={scan.total} />}
        <dl className="stats">
          <div>
            <dt>{t('scan.files')}</dt>
            <dd>{formatCount(scan?.stats.files ?? 0)}</dd>
          </div>
          <div>
            <dt>{t('scan.size')}</dt>
            <dd>{formatBytes(scan?.stats.bytes ?? 0)}</dd>
          </div>
          <div>
            <dt>{t('scan.folders')}</dt>
            <dd>{formatCount(scan?.stats.dirs ?? 0)}</dd>
          </div>
          <div>
            <dt>{t('scan.projects')}</dt>
            <dd>{formatCount(scan?.stats.units ?? 0)}</dd>
          </div>
        </dl>
        {scan?.cloud && <p className="note warn">{t('scan.cloud')}</p>}
        {scan && scan.duplicateGroups > 0 && (
          <p className="note">
            {t('scan.duplicatesFound', {
              groups: formatCount(scan.duplicateGroups),
              bytes: formatBytes(scan.duplicateBytes),
            })}
          </p>
        )}
        {scan && scan.mismatched > 0 && (
          <p className="note">{t('scan.mismatched', { count: formatCount(scan.mismatched) })}</p>
        )}
        {scan && scan.stats.errors > 0 && (
          <p className="note warn">{t('scan.errors', { count: formatCount(scan.stats.errors) })}</p>
        )}
        {scan && scan.stats.skippedLinks > 0 && (
          <p className="note">{t('scan.links', { count: formatCount(scan.stats.skippedLinks) })}</p>
        )}
      </div>
      <div className="panel-foot">
        {!finished && (
          <button className="btn" onClick={() => void cancel()}>
            {t('scan.stop')}
          </button>
        )}
        {phase === 'done' && (
          <button className="btn primary" onClick={() => void goToPlan()}>
            {t('scan.toPlan')}
          </button>
        )}
        {phase === 'cancelled' && (
          <button className="btn" onClick={backToStart}>
            {t('scan.back')}
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
  const { t, plural } = useT()
  const plan = useApp((s) => s.plan)
  const root = useApp((s) => s.root)
  const execute = useApp((s) => s.execute)
  const [accepted, setAccepted] = useState(false)
  const wholeDrive = isDriveRoot(root)
  if (!plan) return <></>
  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{t('confirm.title', { items: plural('items', plan.moveCount) })}</h2>
        <p>{t('confirm.body', { bytes: formatBytes(plan.totalBytes), target: plan.options.targetRoot })}</p>
        {wholeDrive && (
          <label className="check">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            {t('confirm.drive', { root })}
          </label>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={wholeDrive && !accepted}
            onClick={() => {
              onClose()
              void execute()
            }}
          >
            {t('confirm.action')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PlanPanel({ onOpen }: { onOpen: (target: DrawerTarget) => void }): React.JSX.Element {
  const { t, plural, labels } = useT()
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
    const folder = await api().pickFolder(t('plan.target'))
    if (folder) void updateSettings({ targetRoot: folder })
  }

  const countDecision = (decision: 'whole' | 'keep' | 'split'): string =>
    formatCount(plan?.topics.filter((topic) => topic.decision === decision).length ?? 0)

  return (
    <>
      <div className="panel-body">
        <div>
          <h3 className="section-title">{t('plan.groupBy')}</h3>
          <div className="chips">
            {DIMENSIONS.map((id) => {
              const position = settings.dimensions.indexOf(id)
              return (
                <button className="chip" key={id} aria-pressed={position >= 0} onClick={() => toggle(id)}>
                  {position >= 0 && <i>{position + 1}</i>}
                  {t(`dimension.${id}`)}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <h3 className="section-title">{t('plan.target')}</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="input mono"
              aria-label={t('plan.target')}
              value={settings.targetRoot}
              onChange={(event) => void updateSettings({ targetRoot: event.target.value })}
            />
            <button className="btn" onClick={() => void pickTarget()}>
              {t('plan.change')}
            </button>
          </div>
        </div>

        {plan && plan.topics.length > 0 && (
          <div>
            <h3 className="section-title">{t('plan.context')}</h3>
            <p className="note">
              {t('plan.contextSummary', {
                whole: countDecision('whole'),
                keep: countDecision('keep'),
                split: countDecision('split'),
              })}
            </p>
            <button
              className="btn ghost"
              style={{ paddingLeft: 0 }}
              data-testid="open-topics"
              onClick={() => onOpen({ kind: 'topics' })}
            >
              {t('plan.topicFolders', { count: formatCount(plan.topics.length) })}
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
              {t('plan.separateDuplicates', {
                folder: labels.duplicates,
                count: formatCount(plan?.duplicateCount ?? 0),
              })}
            </label>
            <button className="btn ghost" style={{ paddingLeft: 0 }} onClick={() => onOpen({ kind: 'duplicates' })}>
              {t('plan.chooseKeeper')}
            </button>
          </div>
        )}

        {plan && (
          <dl className="stats">
            <div>
              <dt>{t('plan.toMove')}</dt>
              <dd data-testid="plan-count">{formatCount(plan.moveCount)}</dd>
            </div>
            <div>
              <dt>{t('plan.size')}</dt>
              <dd>{formatBytes(plan.totalBytes)}</dd>
            </div>
            {plan.kept > 0 && (
              <div>
                <dt>{t('plan.kept')}</dt>
                <dd data-testid="plan-kept">{formatCount(plan.kept)}</dd>
              </div>
            )}
          </dl>
        )}

        {plan && plan.alreadySorted > 0 && (
          <p className="note">{t('plan.alreadySorted', { count: formatCount(plan.alreadySorted) })}</p>
        )}
        {plan && plan.skipped.length > 0 && (
          <p className="note warn">
            {t('plan.skipped', {
              count: formatCount(plan.skipped.length),
              reason: t(`skip.${plan.skipped[0].reason}`),
            })}
          </p>
        )}
        <GroupList onOpen={onOpen} />
      </div>
      <div className="panel-foot">
        <button className="btn" disabled={!plan || plan.moveCount === 0 || simulating} onClick={() => void simulate()}>
          {simulating ? t('plan.simulating') : t('plan.simulate')}
        </button>
        <button
          className="btn primary"
          disabled={!plan || plan.moveCount === 0 || simulating}
          onClick={() => setConfirming(true)}
        >
          {t('plan.move', { items: plural('items', plan?.moveCount ?? 0) })}
        </button>
      </div>
      {confirming && <ConfirmDialog onClose={() => setConfirming(false)} />}
    </>
  )
}

export function RunPanel(): React.JSX.Element {
  const { t } = useT()
  const flow = useApp((s) => s.flow)
  const plan = useApp((s) => s.plan)
  const cancel = useApp((s) => s.cancel)
  const total = flow?.total ?? plan?.moveCount ?? 0
  return (
    <>
      <div className="panel-body">
        <h2>{t('run.title')}</h2>
        <Meter value={flow?.done ?? 0} total={total} />
        <dl className="stats">
          <div>
            <dt>{t('run.done')}</dt>
            <dd>
              {formatCount(flow?.done ?? 0)} / {formatCount(total)}
            </dd>
          </div>
          <div>
            <dt>{t('run.moved')}</dt>
            <dd>{formatBytes(flow?.bytes ?? 0)}</dd>
          </div>
          <div>
            <dt>{t('run.skipped')}</dt>
            <dd>{formatCount(flow?.failed ?? 0)}</dd>
          </div>
        </dl>
      </div>
      <div className="panel-foot">
        <button className="btn" onClick={() => void cancel()}>
          {t('run.stop')}
        </button>
      </div>
    </>
  )
}

export function SummaryPanel(): React.JSX.Element {
  const { t } = useT()
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
        <h2 data-testid="summary-title">{run.cancelled ? t('summary.stopped') : t('summary.done')}</h2>
        <dl className="stats">
          <div>
            <dt>{t('run.moved')}</dt>
            <dd data-testid="summary-moved">{formatCount(run.moved)}</dd>
          </div>
          <div>
            <dt>{t('run.skipped')}</dt>
            <dd>{formatCount(run.failed.length)}</dd>
          </div>
        </dl>
        {undoing && (
          <>
            <p className="note">
              {t('undo.progress', { done: formatCount(undoing.done), total: formatCount(undoing.total) })}
            </p>
            <Meter value={undoing.done} total={undoing.total} />
          </>
        )}
        {undoResult && (
          <p className="note" data-testid="undo-result">
            {t('undo.summary', {
              restored: formatCount(undoResult.restored),
              conflicts: formatCount(undoResult.conflicts.length),
              lost: formatCount(undoResult.lost.length),
            })}
          </p>
        )}
        {undoResult?.conflicts.length ? (
          <ul className="fail-list">
            {undoResult.conflicts.slice(0, 50).map((conflict) => (
              <li key={conflict.to}>
                {conflict.reason === UNDO_CONFLICT_DIFFERS ? t('undo.differs') : conflict.reason}
                <span className="mono">{conflict.to}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {run.failed.length > 0 && (
          <div>
            <h3 className="section-title">{t('summary.skippedFiles')}</h3>
            <ul className="fail-list">
              {run.failed.slice(0, 100).map((failure) => (
                <li key={failure.path}>
                  {t(`failure.${failure.reason}`)}
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
            {t('summary.showManifest')}
          </button>
        )}
        {plan && (
          <button className="btn" onClick={() => void api().reveal(plan.options.targetRoot)}>
            {t('summary.showFolder')}
          </button>
        )}
        <button
          className="btn"
          disabled={undoing !== null || undoResult !== null || run.moved === 0}
          onClick={() => void undo(run.sessionId)}
        >
          {t('summary.undoAll')}
        </button>
        <button className="btn primary" disabled={undoing !== null} onClick={() => void startScan(root)}>
          {t('summary.rescan')}
        </button>
      </div>
    </>
  )
}
