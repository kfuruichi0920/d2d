// T806: PlantUML / SysMLv2 表示ページ

import { useState, useEffect, useCallback } from 'react'

type DiagramType = 'class' | 'state' | 'idmap'

interface StateTransitionEntry {
  uid: string
  code: string
  title: string
}

export default function PlantUmlPage() {
  const [diagramType, setDiagramType] = useState<DiagramType>('class')
  const [puml, setPuml] = useState<string>('')
  const [krokiUrl, setKrokiUrl] = useState<string | null>(null)
  const [stateEntities, setStateEntities] = useState<StateTransitionEntry[]>([])
  const [selectedUid, setSelectedUid] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  useEffect(() => {
    window.api.store.query(
      "SELECT e.uid, e.code, e.title FROM entity_registry e WHERE e.entity_type='resource_state_transition' AND e.status='active' ORDER BY e.code"
    ).then((rows) => {
      setStateEntities(rows as StateTransitionEntry[])
      if ((rows as StateTransitionEntry[]).length > 0) {
        setSelectedUid((rows[0] as StateTransitionEntry).uid)
      }
    })
  }, [])

  const generate = useCallback(async () => {
    setLoading(true)
    setSavedPath(null)
    let content = ''
    if (diagramType === 'class') {
      content = await window.api.plantuml.classDiagram()
    } else if (diagramType === 'state' && selectedUid) {
      content = await window.api.plantuml.stateDiagram(selectedUid)
    } else if (diagramType === 'idmap') {
      content = await window.api.plantuml.idMap()
    }
    setPuml(content)
    if (diagramType !== 'idmap') {
      const url = await window.api.plantuml.krokiUrl(content)
      setKrokiUrl(url)
    } else {
      setKrokiUrl(null)
    }
    setLoading(false)
  }, [diagramType, selectedUid])

  async function handleSave() {
    const ext = diagramType === 'idmap' ? '.md' : '.puml'
    const filename = `${diagramType}-${new Date().toISOString().slice(0, 10)}${ext}`
    const path = await window.api.plantuml.save(puml, filename)
    setSavedPath(path)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ツールバー */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--srd-color-border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontWeight: 600, marginRight: 8 }}>PlantUML</span>

        <select
          value={diagramType}
          onChange={(e) => setDiagramType(e.target.value as DiagramType)}
          style={selectStyle}
        >
          <option value="class">クラス図（データ構造）</option>
          <option value="state">状態遷移図</option>
          <option value="idmap">要素 ID 対応表</option>
        </select>

        {diagramType === 'state' && (
          <select
            value={selectedUid}
            onChange={(e) => setSelectedUid(e.target.value)}
            style={selectStyle}
          >
            {stateEntities.map((e) => (
              <option key={e.uid} value={e.uid}>{e.code} {e.title}</option>
            ))}
            {stateEntities.length === 0 && <option value="">（状態遷移要素なし）</option>}
          </select>
        )}

        <button onClick={generate} disabled={loading} style={btnStyle}>生成</button>
        {puml && <button onClick={handleSave} disabled={loading} style={{ ...btnStyle, background: 'var(--srd-color-primary)', color: '#fff' }}>保存</button>}
      </div>

      {savedPath && (
        <div style={{ padding: '4px 12px', background: '#d1fae5', color: '#065f46', fontSize: 12 }}>
          保存完了: {savedPath}
        </div>
      )}

      {/* コンテンツ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* ソース */}
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {loading && <div style={{ color: 'var(--srd-color-on-surface-variant)' }}>生成中...</div>}
          {!loading && !puml && (
            <div style={{ color: 'var(--srd-color-on-surface-variant)', textAlign: 'center', marginTop: 60 }}>
              「生成」ボタンで PlantUML ソースを生成します
            </div>
          )}
          {puml && (
            <pre style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'monospace' }}>
              {puml}
            </pre>
          )}
        </div>

        {/* Kroki プレビュー */}
        {krokiUrl && (
          <div style={{ width: 480, borderLeft: '1px solid var(--srd-color-border)', overflow: 'auto', flexShrink: 0, padding: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--srd-color-on-surface-variant)', marginBottom: 8 }}>
              プレビュー（Kroki.io）
              <a href={krokiUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 8, color: 'var(--srd-color-primary)', fontSize: 10 }}>
                新しいタブで開く
              </a>
            </div>
            <img
              src={krokiUrl}
              alt="PlantUML diagram"
              style={{ maxWidth: '100%', border: '1px solid var(--srd-color-border)', borderRadius: 4 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '2px 6px',
  background: 'var(--srd-color-surface)',
  color: 'var(--srd-color-on-surface)',
  border: '1px solid var(--srd-color-border)',
  borderRadius: 4,
  fontSize: 12,
  cursor: 'pointer',
}

const btnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'var(--srd-color-surface-variant)',
  color: 'var(--srd-color-on-surface)',
  border: '1px solid var(--srd-color-border)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
}
