/** PlantUML レンダリング設定（P2-2 / P10-3、CORE-040〜043、FORM-001）。 */
import { useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'

export function PlantUmlSettingsSection(): React.JSX.Element {
  const notify = useJobsStore((state) => state.notify)
  const [jarPath, setJarPath] = useState('')
  const [javaPath, setJavaPath] = useState('')

  useEffect(() => {
    void Promise.all([
      invoke<unknown>('settings.get', { key: 'plantuml.jarPath' }),
      invoke<unknown>('settings.get', { key: 'plantuml.javaPath' })
    ]).then(([jarResult, javaResult]) => {
      if (jarResult.ok && typeof jarResult.result === 'string') setJarPath(jarResult.result)
      if (javaResult.ok && typeof javaResult.result === 'string') setJavaPath(javaResult.result)
    })
  }, [])

  const savePath = async (key: string, value: string): Promise<boolean> => {
    const trimmed = value.trim()
    const result = trimmed
      ? await invoke('settings.set', { key, value: trimmed })
      : await invoke('settings.delete', { key })
    if (!result.ok) {
      notify('error', 'PlantUML レンダリング設定の保存に失敗しました', result.error.message)
      return false
    }
    return true
  }

  const save = async (): Promise<void> => {
    if (!(await savePath('plantuml.jarPath', jarPath))) return
    if (!(await savePath('plantuml.javaPath', javaPath))) return
    setJarPath(jarPath.trim())
    setJavaPath(javaPath.trim())
    notify('info', jarPath.trim() ? 'PlantUML レンダリング設定を保存しました' : 'PlantUML 設定を解除しました')
  }

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }

  return (
    <section data-testid="setting-plantuml-section">
      <h2 style={{ fontSize: 14, marginTop: 20 }}>PlantUML レンダリング（FORM-001）</h2>
      <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 11.5 }}>
        開発環境で使用する PlantUML jar と Java 実行ファイルを指定します。Java を空欄にすると PATH 上の java
        を使用します。 配布版への同梱は P14-5 で対応します。
      </p>
      <div style={rowStyle}>
        <label style={{ width: 120, color: 'var(--d2d-fg-muted)' }} htmlFor="setting-plantuml-jar-path">
          PlantUML jar
        </label>
        <input
          id="setting-plantuml-jar-path"
          data-testid="setting-plantuml-jar-path"
          style={{ flex: 1 }}
          value={jarPath}
          onChange={(event) => setJarPath(event.target.value)}
          placeholder="例: C:\tools\plantuml.jar"
        />
      </div>
      <div style={rowStyle}>
        <label style={{ width: 120, color: 'var(--d2d-fg-muted)' }} htmlFor="setting-plantuml-java-path">
          Java
        </label>
        <input
          id="setting-plantuml-java-path"
          data-testid="setting-plantuml-java-path"
          style={{ flex: 1 }}
          value={javaPath}
          onChange={(event) => setJavaPath(event.target.value)}
          placeholder="空欄時: java"
        />
      </div>
      <button type="button" className="d2d-btn primary" onClick={() => void save()} data-testid="setting-plantuml-save">
        PlantUML 設定を保存
      </button>
    </section>
  )
}
