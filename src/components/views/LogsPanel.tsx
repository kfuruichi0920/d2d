/**
 * Output パネル: 動作ログ・デバッグログ表示（W11、NFR-010 拡張）。
 * 動作ログ … トースト通知の履歴（Renderer メモリ、最大500件）。
 * デバッグログ … プロジェクトの logs/debug/<source>-YYYY-MM-DD.log の末尾（log.tail）。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { useLogsStore } from '../../stores/logs-store'
import { useProjectStore } from '../../stores/project-store'

type LogView = 'operation' | 'debug'
type DebugSource = 'frontend' | 'backend'

const KIND_COLORS: Record<string, string> = {
  info: 'var(--d2d-fg-muted)',
  warning: 'var(--d2d-warning, #d97706)',
  error: 'var(--d2d-error)'
}

export function LogsPanel(): React.JSX.Element {
  const [view, setView] = useState<LogView>('operation')
  const entries = useLogsStore((s) => s.entries)
  const clear = useLogsStore((s) => s.clear)
  const hasProject = useProjectStore((s) => s.project !== null)

  const [debugSource, setDebugSource] = useState<DebugSource>('frontend')
  const [debugLines, setDebugLines] = useState<string[]>([])
  const [debugFile, setDebugFile] = useState<string | null>(null)
  const [debugLevel, setDebugLevel] = useState<string>('info')

  const loadDebug = useCallback(async (): Promise<void> => {
    const result = await invoke<{ file: string | null; lines: string[]; level: string }>('log.tail', {
      source: debugSource,
      limit: 500
    })
    if (result.ok) {
      setDebugLines(result.result.lines)
      setDebugFile(result.result.file)
      setDebugLevel(result.result.level)
    }
  }, [debugSource])

  useEffect(() => {
    if (view === 'debug') void loadDebug()
  }, [view, loadDebug])

  return (
    <div data-testid="logs-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
        <button
          type="button"
          className={`d2d-btn small ${view === 'operation' ? 'primary' : ''}`}
          onClick={() => setView('operation')}
          title="トースト通知の履歴（動作ログ）を表示します"
          data-testid="logs-view-operation"
        >
          動作ログ
        </button>
        <button
          type="button"
          className={`d2d-btn small ${view === 'debug' ? 'primary' : ''}`}
          onClick={() => setView('debug')}
          title="日付毎のデバッグログファイルの末尾を表示します（プロジェクト設定 logging.debugLevel でレベル変更）"
          data-testid="logs-view-debug"
        >
          デバッグログ
        </button>
        <span style={{ flex: 1 }} />
        {view === 'operation' ? (
          <button type="button" className="d2d-btn small" onClick={clear} title="動作ログの表示履歴を消去します">
            消去
          </button>
        ) : (
          <>
            <select
              value={debugSource}
              onChange={(e) => setDebugSource(e.target.value as DebugSource)}
              title="表示するデバッグログの出力元を選択します（frontend=Renderer / backend=Backendプロセス）"
              data-testid="logs-debug-source"
            >
              <option value="frontend">frontend</option>
              <option value="backend">backend</option>
            </select>
            <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>レベル: {debugLevel}</span>
            <button
              type="button"
              className="d2d-btn small"
              onClick={() => void loadDebug()}
              title="デバッグログファイルを読み直します"
              data-testid="logs-debug-reload"
            >
              更新
            </button>
          </>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', fontFamily: 'Consolas, monospace', fontSize: 11.5 }}>
        {view === 'operation' ? (
          entries.length === 0 ? (
            <div className="d2d-empty">動作ログはまだありません（通知が発生するとここへ記録されます）</div>
          ) : (
            [...entries].reverse().map((entry) => (
              <div
                key={entry.id}
                style={{ padding: '1px 6px', borderBottom: '1px solid var(--d2d-border)' }}
                data-testid={`operation-log-${entry.id}`}
              >
                <span style={{ color: 'var(--d2d-fg-muted)' }}>{entry.timestamp.slice(11, 19)}</span>{' '}
                <span style={{ color: KIND_COLORS[entry.kind] }}>[{entry.kind.toUpperCase()}]</span> {entry.message}
                {entry.detail && <span style={{ color: 'var(--d2d-fg-muted)' }}> | {entry.detail}</span>}
              </div>
            ))
          )
        ) : !hasProject ? (
          <div className="d2d-empty">デバッグログファイルはプロジェクトを開くと出力されます</div>
        ) : debugLines.length === 0 ? (
          <div className="d2d-empty">対象日のデバッグログはまだありません{debugFile ? `（${debugFile}）` : ''}</div>
        ) : (
          <>
            {debugFile && (
              <div style={{ padding: '1px 6px', color: 'var(--d2d-fg-muted)' }} data-testid="logs-debug-file">
                {debugFile}
              </div>
            )}
            {[...debugLines].reverse().map((line, index) => (
              <div key={index} style={{ padding: '1px 6px', borderBottom: '1px solid var(--d2d-border)' }}>
                {line}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
