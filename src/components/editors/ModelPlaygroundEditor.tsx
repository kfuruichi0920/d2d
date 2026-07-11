/**
 * PlantUML モデルエディタ（P10-3、FORM-001/002、EDIT-020/021）。
 * Monaco でモデル表記を編集し、要素ID対応表（モデル内要素 ↔ 設計要素）をセットで管理する。
 * レンダリングは plantuml.jarPath 設定時のみ（同梱は P14-5 / TBD-02）。
 */
import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { CodeEditor } from '../common/CodeEditor'
import type { DesignElementRow } from '../views/DesignModelViews'

const DEFAULT_UML = `@startuml
component "モジュールA" as A
component "モジュールB" as B
A --> B : 呼び出し
@enduml
`

interface Mapping {
  model_element: string
  design_uid: string | null
}

export function ModelPlaygroundEditor(): React.JSX.Element {
  const [text, setText] = useState(DEFAULT_UML)
  const [name, setName] = useState('構成図')
  const [svg, setSvg] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [elements, setElements] = useState<DesignElementRow[]>([])
  const notify = useJobsStore((s) => s.notify)

  useEffect(() => {
    void invoke<{ configured: boolean }>('model.getConfig').then((res) => {
      if (res.ok) setConfigured(res.result.configured)
    })
    void invoke<DesignElementRow[]>('design.listElements').then((res) => {
      if (res.ok) setElements(res.result)
    })
  }, [])

  const render = async (): Promise<void> => {
    const res = await invoke<{ svg: string }>('model.render', { text })
    if (res.ok) {
      setSvg(res.result.svg)
    } else {
      setSvg(null)
      notify('warning', 'レンダリングできません', res.error.detail || res.error.message)
    }
  }

  const addMapping = (): void => {
    // モデル表記から要素名候補（as X / component "..."）を粗く抽出
    const names = [...text.matchAll(/(?:as\s+(\w+)|component\s+"([^"]+)")/g)].map((m) => m[1] ?? m[2] ?? '')
    const unmapped = names.find((n) => n && !mappings.some((m) => m.model_element === n))
    setMappings((prev) => [...prev, { model_element: unmapped ?? '', design_uid: null }])
  }

  const save = async (): Promise<void> => {
    const res = await invoke<{ code: string }>('model.save', {
      name,
      text,
      mappings: mappings.map((m) => ({
        ...m,
        design_code: elements.find((e) => e.uid === m.design_uid)?.code ?? null
      }))
    })
    if (res.ok) {
      notify('info', `モデルを STRUCT 要素として保存しました: ${res.result.code}`)
    } else {
      notify('error', '保存できませんでした', res.error.message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="model-editor">
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '6px 12px',
          borderBottom: '1px solid var(--d2d-border)'
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 160 }} />
        <button type="button" className="d2d-btn" onClick={() => void render()} data-testid="model-render">
          レンダリング
        </button>
        {configured === false && (
          <span style={{ color: 'var(--d2d-warning)', fontSize: 11.5 }}>
            PlantUML 未設定（設定 plantuml.jarPath。同梱は P14-5 / TBD-02）
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="d2d-btn primary" onClick={() => void save()} data-testid="model-save">
          STRUCT 要素として保存
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CodeEditor value={text} language="plaintext" onChange={setText} />
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', borderLeft: '1px solid var(--d2d-border)', padding: 8 }}>
          {svg ? (
            // PlantUML 出力 SVG をサニタイズして表示
            <div
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
              }}
            />
          ) : (
            <div className="d2d-empty">レンダリング結果（jar 設定時）</div>
          )}
          <h2 style={{ fontSize: 13 }}>要素ID対応表（FORM-002）</h2>
          <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>
            モデル表記内の要素と設計要素 ID の対応をモデルとセットで保存します。
          </p>
          <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }} data-testid="mapping-table">
            <tbody>
              {mappings.map((mapping, i) => (
                <tr key={i}>
                  <td style={{ padding: 2 }}>
                    <input
                      value={mapping.model_element}
                      placeholder="モデル内要素名"
                      onChange={(e) =>
                        setMappings((prev) =>
                          prev.map((m, j) => (j === i ? { ...m, model_element: e.target.value } : m))
                        )
                      }
                    />
                  </td>
                  <td style={{ padding: 2 }}>
                    <select
                      value={mapping.design_uid ?? ''}
                      onChange={(e) =>
                        setMappings((prev) =>
                          prev.map((m, j) => (j === i ? { ...m, design_uid: e.target.value || null } : m))
                        )
                      }
                    >
                      <option value="">（未対応）</option>
                      {elements.map((element) => (
                        <option key={element.uid} value={element.uid}>
                          {element.code} {element.title}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="d2d-btn small"
                      onClick={() => setMappings((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="d2d-btn small" onClick={addMapping} data-testid="add-mapping">
            + 対応を追加
          </button>
        </div>
      </div>
    </div>
  )
}
