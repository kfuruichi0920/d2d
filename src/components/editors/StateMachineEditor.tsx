/**
 * 状態遷移エディタ（P10-4、V-04 の STATE 特化、EDIT-030〜035）。
 * 状態一覧・遷移一覧の編集、SVG 状態遷移図、簡易シミュレーション、問題検出。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'

interface StateTransition {
  from: string
  to: string
  event: string
  condition?: string
  action?: string
}

interface StateMachine {
  uid: string
  code: string
  state_machine_name: string
  states: string[]
  events: string[]
  transitions: StateTransition[]
  initial_state: string
  final_states: string[]
  problems: { kind: string; message: string }[]
}

export function StateMachineEditor({ uid }: { uid: string }): React.JSX.Element {
  const [machine, setMachine] = useState<StateMachine | null>(null)
  const [newState, setNewState] = useState('')
  const [newEvent, setNewEvent] = useState('')
  const [simEvents, setSimEvents] = useState('')
  const [simResult, setSimResult] = useState<{
    steps: { event: string; from: string; to: string | null; matched: boolean }[]
    finalState: string
  } | null>(null)
  const notify = useJobsStore((s) => s.notify)

  const load = useCallback(async () => {
    const res = await invoke<StateMachine>('state.get', { uid })
    if (res.ok) setMachine(res.result)
  }, [uid])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (
    patch: Partial<Pick<StateMachine, 'states' | 'events' | 'transitions' | 'initial_state' | 'final_states'>>
  ): Promise<void> => {
    if (!machine) return
    const next = { ...machine, ...patch }
    const res = await invoke<StateMachine>('state.update', {
      uid,
      states: next.states,
      events: next.events,
      transitions: next.transitions,
      initialState: next.initial_state,
      finalStates: next.final_states
    })
    if (res.ok) {
      setMachine(res.result)
      setSimResult(null)
    } else {
      notify('error', '状態遷移を保存できませんでした', res.error.message)
    }
  }

  const simulate = async (): Promise<void> => {
    const events = simEvents
      .split(/[,、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const res = await invoke<typeof simResult>('state.simulate', { uid, events })
    if (res.ok) setSimResult(res.result)
  }

  if (!machine) return <div className="d2d-empty">読込中…</div>

  // 円環レイアウトの SVG 状態遷移図（EDIT-033）
  const R = 140
  const cx = 220
  const cy = 170
  const positions = new Map<string, { x: number; y: number }>()
  machine.states.forEach((state, i) => {
    const angle = (2 * Math.PI * i) / machine.states.length - Math.PI / 2
    positions.set(state, { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) })
  })

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }} data-testid="state-machine-editor">
      <h1 style={{ fontSize: 15, marginTop: 0 }}>
        {machine.code} — {machine.state_machine_name}
      </h1>

      {machine.problems.length > 0 && (
        <div style={{ marginBottom: 8 }} data-testid="state-problems">
          {machine.problems.map((problem, i) => (
            <div key={i} style={{ color: 'var(--d2d-warning)', fontSize: 12 }}>
              ⚠ {problem.message}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 300 }}>
          <h2 style={{ fontSize: 13 }}>状態（EDIT-030）</h2>
          {machine.states.map((state) => (
            <div key={state} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
              <input
                type="radio"
                name="initial"
                checked={machine.initial_state === state}
                title="初期状態にする"
                onChange={() => void save({ initial_state: state })}
              />
              <span style={{ flex: 1 }}>{state}</span>
              <label style={{ fontSize: 11, color: 'var(--d2d-fg-muted)' }}>
                <input
                  type="checkbox"
                  checked={machine.final_states.includes(state)}
                  onChange={(e) =>
                    void save({
                      final_states: e.target.checked
                        ? [...machine.final_states, state]
                        : machine.final_states.filter((s) => s !== state)
                    })
                  }
                />
                終了
              </label>
              <button
                type="button"
                className="d2d-btn small"
                onClick={() => {
                  if (!window.confirm(`状態「${state}」を削除しますか？（参照する遷移も削除されます）`)) return
                  void save({
                    states: machine.states.filter((s) => s !== state),
                    transitions: machine.transitions.filter((t) => t.from !== state && t.to !== state)
                  })
                }}
              >
                ×
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <input
              value={newState}
              onChange={(e) => setNewState(e.target.value)}
              placeholder="新しい状態"
              data-testid="new-state-input"
            />
            <button
              type="button"
              className="d2d-btn small"
              disabled={!newState.trim() || machine.states.includes(newState.trim())}
              onClick={() => {
                void save({ states: [...machine.states, newState.trim()] })
                setNewState('')
              }}
              data-testid="add-state"
            >
              追加
            </button>
          </div>

          <h2 style={{ fontSize: 13, marginTop: 12 }}>イベント</h2>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {machine.events.map((event) => (
              <span key={event} className="d2d-badge status-running">
                {event}
              </span>
            ))}
            <input
              value={newEvent}
              onChange={(e) => setNewEvent(e.target.value)}
              placeholder="新しいイベント"
              style={{ width: 110 }}
              data-testid="new-event-input"
            />
            <button
              type="button"
              className="d2d-btn small"
              disabled={!newEvent.trim() || machine.events.includes(newEvent.trim())}
              onClick={() => {
                void save({ events: [...machine.events, newEvent.trim()] })
                setNewEvent('')
              }}
              data-testid="add-event"
            >
              追加
            </button>
          </div>

          <h2 style={{ fontSize: 13, marginTop: 12 }}>遷移（EDIT-031/032）</h2>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }} data-testid="transitions-table">
            <thead>
              <tr>
                {['元', 'イベント', '先', '条件', ''].map((header) => (
                  <th key={header} style={{ textAlign: 'left', padding: '2px 6px', color: 'var(--d2d-fg-muted)' }}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {machine.transitions.map((transition, i) => (
                <tr key={i}>
                  <td>{transition.from}</td>
                  <td style={{ padding: '0 6px' }}>{transition.event}</td>
                  <td>{transition.to}</td>
                  <td style={{ padding: '0 6px', color: 'var(--d2d-fg-muted)' }}>{transition.condition ?? ''}</td>
                  <td>
                    <button
                      type="button"
                      className="d2d-btn small"
                      onClick={() => void save({ transitions: machine.transitions.filter((_, j) => j !== i) })}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              <TransitionForm
                machine={machine}
                onAdd={(transition) => void save({ transitions: [...machine.transitions, transition] })}
              />
            </tbody>
          </table>

          <h2 style={{ fontSize: 13, marginTop: 12 }}>簡易シミュレーション（EDIT-034）</h2>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              style={{ flex: 1 }}
              placeholder="イベント列（カンマ区切り）"
              value={simEvents}
              onChange={(e) => setSimEvents(e.target.value)}
              data-testid="sim-input"
            />
            <button type="button" className="d2d-btn small" onClick={() => void simulate()} data-testid="sim-run">
              実行
            </button>
          </div>
          {simResult && (
            <div style={{ fontSize: 12, marginTop: 4 }} data-testid="sim-result">
              {simResult.steps.map((step, i) => (
                <div key={i} style={{ color: step.matched ? 'var(--d2d-fg)' : 'var(--d2d-error)' }}>
                  {step.from} --{step.event}→ {step.matched ? step.to : '（遷移なし）'}
                </div>
              ))}
              <div style={{ fontWeight: 700 }}>最終状態: {simResult.finalState}</div>
            </div>
          )}
        </div>

        <svg
          width={460}
          height={360}
          style={{ border: '1px solid var(--d2d-border)', borderRadius: 4 }}
          data-testid="state-diagram"
        >
          <defs>
            <marker id="sm-arrow" markerWidth="8" markerHeight="8" refX="22" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8" fill="var(--d2d-fg-muted)" />
            </marker>
          </defs>
          {machine.transitions.map((transition, i) => {
            const from = positions.get(transition.from)
            const to = positions.get(transition.to)
            if (!from || !to) return null
            const selfLoop = transition.from === transition.to
            return selfLoop ? (
              <g key={i}>
                <circle cx={from.x} cy={from.y - 34} r={14} fill="none" stroke="var(--d2d-fg-muted)" />
                <text x={from.x} y={from.y - 52} fontSize={10} fill="var(--d2d-fg-muted)" textAnchor="middle">
                  {transition.event}
                </text>
              </g>
            ) : (
              <g key={i}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="var(--d2d-fg-muted)"
                  markerEnd="url(#sm-arrow)"
                />
                <text
                  x={(from.x + to.x) / 2}
                  y={(from.y + to.y) / 2 - 4}
                  fontSize={10}
                  fill="var(--d2d-fg-muted)"
                  textAnchor="middle"
                >
                  {transition.event}
                </text>
              </g>
            )
          })}
          {machine.states.map((state) => {
            const pos = positions.get(state)!
            const isInitial = machine.initial_state === state
            const isFinal = machine.final_states.includes(state)
            return (
              <g key={state}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={22}
                  fill="var(--d2d-surface-raised)"
                  stroke={isInitial ? 'var(--d2d-accent)' : 'var(--d2d-border)'}
                  strokeWidth={isInitial ? 2.5 : 1.5}
                />
                {isFinal && <circle cx={pos.x} cy={pos.y} r={18} fill="none" stroke="var(--d2d-border)" />}
                <text x={pos.x} y={pos.y + 4} fontSize={11} fill="var(--d2d-fg)" textAnchor="middle">
                  {state.slice(0, 5)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function TransitionForm({
  machine,
  onAdd
}: {
  machine: StateMachine
  onAdd: (t: StateTransition) => void
}): React.JSX.Element {
  const [from, setFrom] = useState('')
  const [event, setEvent] = useState('')
  const [to, setTo] = useState('')
  const [condition, setCondition] = useState('')

  return (
    <tr>
      <td>
        <select value={from} onChange={(e) => setFrom(e.target.value)} data-testid="tr-from">
          <option value="" />
          {machine.states.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: '0 6px' }}>
        <select value={event} onChange={(e) => setEvent(e.target.value)} data-testid="tr-event">
          <option value="" />
          {machine.events.map((ev) => (
            <option key={ev}>{ev}</option>
          ))}
        </select>
      </td>
      <td>
        <select value={to} onChange={(e) => setTo(e.target.value)} data-testid="tr-to">
          <option value="" />
          {machine.states.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: '0 6px' }}>
        <input
          style={{ width: 90 }}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="条件"
        />
      </td>
      <td>
        <button
          type="button"
          className="d2d-btn small"
          disabled={!from || !to || !event}
          onClick={() => {
            onAdd({ from, to, event, condition: condition || undefined })
            setCondition('')
          }}
          data-testid="add-transition"
        >
          +
        </button>
      </td>
    </tr>
  )
}
