/** Project Settings Editor（P7-1、CORE-012、LLM-042）。 */
import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'

interface Artifact {
  uid: string
  artifact_name: string
  artifact_type_id: string
  sort_order: number
  is_active: number
}
interface Phase {
  uid: string
  dev_phase_id: string
  dev_phase_name: string
  sort_order: number
  is_active: number
}

export function ProjectSettingsEditor(): React.JSX.Element {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [phases, setPhases] = useState<Phase[]>([])
  const [artifactName, setArtifactName] = useState('')
  const [artifactTypeId, setArtifactTypeId] = useState('')
  const [phaseId, setPhaseId] = useState('')
  const [phaseName, setPhaseName] = useState('')
  const [externalAllowed, setExternalAllowed] = useState(false)
  const notify = useJobsStore((s) => s.notify)
  const load = useCallback(async () => {
    const [a, p, s] = await Promise.all([
      invoke<Artifact[]>('project.listArtifactSettings'),
      invoke<Phase[]>('project.listDevPhases'),
      invoke<Record<string, unknown>>('settings.getProjectSettings')
    ])
    if (a.ok) setArtifacts(a.result)
    if (p.ok) setPhases(p.result)
    if (s.ok) setExternalAllowed(s.result['llm.externalSendAllowed'] === true)
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const saveArtifact = async (item?: Artifact): Promise<void> => {
    const res = await invoke(
      'project.saveArtifactSetting',
      item
        ? {
            uid: item.uid,
            artifactName: item.artifact_name,
            artifactTypeId: item.artifact_type_id,
            sortOrder: item.sort_order,
            isActive: item.is_active !== 1
          }
        : { artifactName, artifactTypeId, sortOrder: artifacts.length }
    )
    if (!res.ok) notify('error', '成果物設定を保存できませんでした', res.error.message)
    else {
      setArtifactName('')
      setArtifactTypeId('')
      await load()
    }
  }
  const savePhase = async (item?: Phase): Promise<void> => {
    const res = await invoke(
      'project.saveDevPhase',
      item
        ? {
            uid: item.uid,
            devPhaseId: item.dev_phase_id,
            devPhaseName: item.dev_phase_name,
            sortOrder: item.sort_order,
            isActive: item.is_active !== 1
          }
        : { devPhaseId: phaseId, devPhaseName: phaseName, sortOrder: phases.length }
    )
    if (!res.ok) notify('error', '開発フェーズ設定を保存できませんでした', res.error.message)
    else {
      setPhaseId('')
      setPhaseName('')
      await load()
    }
  }
  const setExternal = async (value: boolean): Promise<void> => {
    const res = await invoke('settings.setProjectSetting', { key: 'llm.externalSendAllowed', value })
    if (res.ok) setExternalAllowed(value)
    else notify('error', '外部送信可否を保存できませんでした', res.error.message)
  }
  const section: React.CSSProperties = {
    border: '1px solid var(--d2d-border)',
    borderRadius: 6,
    padding: 12,
    marginBottom: 16
  }
  const row: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 80px 70px',
    gap: 8,
    alignItems: 'center',
    margin: '5px 0'
  }
  return (
    <div style={{ padding: 20, maxWidth: 820 }} data-testid="project-settings-editor">
      <h1 style={{ fontSize: 18, marginTop: 0 }}>プロジェクト設定</h1>
      <p style={{ color: 'var(--d2d-fg-muted)' }}>
        この設定は現在のプロジェクト内に保存され、③中間データのフェーズ・成果物構成に使用されます。
      </p>
      <section style={section}>
        <h2 style={{ fontSize: 14 }}>成果物設定（project_artifact_setting）</h2>
        {artifacts.map((a) => (
          <div key={a.uid} style={row}>
            <span>{a.artifact_name}</span>
            <code>{a.artifact_type_id}</code>
            <span>{a.is_active ? '有効' : '無効'}</span>
            <button className="d2d-btn small" onClick={() => void saveArtifact(a)}>
              {a.is_active ? '無効化' : '有効化'}
            </button>
          </div>
        ))}
        <div style={row}>
          <input
            value={artifactName}
            onChange={(e) => setArtifactName(e.target.value)}
            placeholder="成果物名"
            data-testid="artifact-name"
          />
          <input
            value={artifactTypeId}
            onChange={(e) => setArtifactTypeId(e.target.value)}
            placeholder="種別ID"
            data-testid="artifact-type"
          />
          <span />
          <button
            className="d2d-btn primary small"
            disabled={!artifactName || !artifactTypeId}
            onClick={() => void saveArtifact()}
            data-testid="artifact-add"
          >
            追加
          </button>
        </div>
      </section>
      <section style={section}>
        <h2 style={{ fontSize: 14 }}>開発フェーズ設定（project_dev_phase_setting）</h2>
        {phases.map((p) => (
          <div key={p.uid} style={row}>
            <span>{p.dev_phase_name}</span>
            <code>{p.dev_phase_id}</code>
            <span>{p.is_active ? '有効' : '無効'}</span>
            <button className="d2d-btn small" onClick={() => void savePhase(p)}>
              {p.is_active ? '無効化' : '有効化'}
            </button>
          </div>
        ))}
        <div style={row}>
          <input
            value={phaseName}
            onChange={(e) => setPhaseName(e.target.value)}
            placeholder="フェーズ名"
            data-testid="phase-name"
          />
          <input
            value={phaseId}
            onChange={(e) => setPhaseId(e.target.value)}
            placeholder="フェーズID"
            data-testid="phase-id"
          />
          <span />
          <button
            className="d2d-btn primary small"
            disabled={!phaseName || !phaseId}
            onClick={() => void savePhase()}
            data-testid="phase-add"
          >
            追加
          </button>
        </div>
      </section>
      <section style={section}>
        <h2 style={{ fontSize: 14 }}>LLM 外部送信（LLM-042）</h2>
        <label>
          <input
            type="checkbox"
            checked={externalAllowed}
            onChange={(e) => void setExternal(e.target.checked)}
            data-testid="llm-external-allowed"
          />{' '}
          このプロジェクトから外部 LLM への送信を許可する（既定: 不可）
        </label>
      </section>
    </div>
  )
}
