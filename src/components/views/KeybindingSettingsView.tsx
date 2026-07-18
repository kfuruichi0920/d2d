/**
 * ショートカットキーのカスタマイズ（W1、UI-003/023）。
 * ツール設定内で全 Command の実効キーバインドを一覧し、上書き・解除・既定復元を行う。
 */
import { useEffect, useState } from 'react'
import { listCommands, resolveKeybinding, type CommandDefinition } from '../../services/command-registry'
import {
  findKeybindingConflict,
  getKeybindingOverrides,
  normalizeKeybindingEvent,
  resetAllKeybindingOverrides,
  resetKeybindingOverride,
  setKeybindingOverride,
  subscribeKeybindings
} from '../../services/keybindings'
import { useJobsStore } from '../../stores/jobs-store'

export function KeybindingSettingsSection(): React.JSX.Element {
  const notify = useJobsStore((s) => s.notify)
  const [query, setQuery] = useState('')
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [, setRevision] = useState(0)

  useEffect(() => subscribeKeybindings(() => setRevision((r) => r + 1)), [])

  // Command 数は高々数十件のため、毎描画で絞り込みしてもコストは無視できる。
  const q = query.trim().toLowerCase()
  const commands = listCommands()
    .filter((c) => !c.hidden)
    .filter(
      (c) =>
        !q ||
        c.title.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (resolveKeybinding(c) ?? '').toLowerCase().includes(q)
    )
    .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '', 'ja') || a.title.localeCompare(b.title, 'ja'))

  const overrides = getKeybindingOverrides()

  const applyCapturedKey = (command: CommandDefinition, e: React.KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecordingId(null)
      return
    }
    const binding = normalizeKeybindingEvent(e)
    if (!binding) return
    const conflict = findKeybindingConflict(binding, command.id)
    if (conflict) {
      notify(
        'error',
        `キー ${binding} は使用済みです`,
        `「${conflict.title}」に割り当てられています。先に解除してください。`
      )
      setRecordingId(null)
      return
    }
    setKeybindingOverride(command.id, binding)
    notify('info', `ショートカットを変更しました: ${command.title} → ${binding}`)
    setRecordingId(null)
  }

  return (
    <section data-testid="keybinding-settings">
      <h2 style={{ fontSize: 14, marginTop: 20 }}>ショートカットキー（UI-003 / UI-023）</h2>
      <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 11.5 }}>
        「変更」を押してから割り当てたいキーを押します（例: Ctrl+Alt+K）。Esc で取消、
        「解除」でキーなし、「既定」で標準へ戻します。この設定はこのPCのWorkbenchへ保存されます。
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}>
        <input
          style={{ flex: 1 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="コマンド名・キーで絞り込み（例: パレット、Ctrl+B）"
          title="表示するコマンドを絞り込みます。コマンド名・ID・キーバインドの部分一致で検索します（例: 「表示」「Ctrl+B」）"
          data-testid="keybinding-filter"
        />
        <button
          type="button"
          className="d2d-btn small"
          onClick={() => {
            resetAllKeybindingOverrides()
            notify('info', 'すべてのショートカットを既定へ戻しました')
          }}
          title="ユーザーが変更したすべてのショートカットを破棄し、標準の割り当てへ戻します"
          data-testid="keybinding-reset-all"
        >
          すべて既定に戻す
        </button>
      </div>
      <div className="d2d-keybinding-table" role="table" aria-label="ショートカットキー一覧">
        {commands.map((command) => {
          const effective = resolveKeybinding(command)
          const overridden = command.id in overrides
          const recording = recordingId === command.id
          return (
            <div
              key={command.id}
              role="row"
              className="d2d-keybinding-row"
              data-testid={`keybinding-row-${command.id}`}
            >
              <span role="cell" className="d2d-keybinding-title" title={`コマンドID: ${command.id}`}>
                {command.category ? `${command.category}: ` : ''}
                {command.title}
                {overridden && (
                  <span className="d2d-badge status-warning" style={{ marginLeft: 6 }}>
                    変更済み
                  </span>
                )}
              </span>
              <span role="cell" className="d2d-keybinding-key">
                {recording ? (
                  <input
                    autoFocus
                    readOnly
                    value="キーを押してください…"
                    onKeyDown={(e) => applyCapturedKey(command, e)}
                    onBlur={() => setRecordingId(null)}
                    aria-label={`${command.title} の新しいショートカットキー入力`}
                    data-testid={`keybinding-capture-${command.id}`}
                  />
                ) : effective ? (
                  <span className="kbd" data-testid={`keybinding-value-${command.id}`}>
                    {effective}
                  </span>
                ) : (
                  <span style={{ color: 'var(--d2d-fg-muted)' }}>（なし）</span>
                )}
              </span>
              <span role="cell" className="d2d-keybinding-actions">
                <button
                  type="button"
                  className="d2d-btn small"
                  onClick={() => setRecordingId(command.id)}
                  title={`「${command.title}」のショートカットを変更します。押した後に割り当てたいキーを入力します（例: Ctrl+Alt+K）`}
                  data-testid={`keybinding-change-${command.id}`}
                >
                  変更
                </button>
                <button
                  type="button"
                  className="d2d-btn small"
                  disabled={!effective}
                  onClick={() => {
                    setKeybindingOverride(command.id, null)
                    notify('info', `ショートカットを解除しました: ${command.title}`)
                  }}
                  title={`「${command.title}」へのキー割り当てを外します（コマンドパレット・メニューからは引き続き実行できます）`}
                  data-testid={`keybinding-unbind-${command.id}`}
                >
                  解除
                </button>
                <button
                  type="button"
                  className="d2d-btn small"
                  disabled={!overridden}
                  onClick={() => resetKeybindingOverride(command.id)}
                  title={`「${command.title}」のショートカットを標準の割り当てへ戻します`}
                  data-testid={`keybinding-reset-${command.id}`}
                >
                  既定
                </button>
              </span>
            </div>
          )
        })}
        {commands.length === 0 && <div className="d2d-empty">一致するコマンドがありません</div>}
      </div>
    </section>
  )
}
