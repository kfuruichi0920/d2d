/** Project Settings Editor（P7-1、CORE-012、LLM-042）。 */
import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { confirmDialog } from '../common/ConfirmDialog'
interface Artifact {
  uid: string
  artifact_name: string
  artifact_type_id: string
  dev_phase_id: string | null
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
  const [artifacts, setArtifacts] = useState<Artifact[]>([]),
    [phases, setPhases] = useState<Phase[]>([])
  const [artifactName, setArtifactName] = useState(''),
    [artifactTypeId, setArtifactTypeId] = useState(''),
    [artifactPhase, setArtifactPhase] = useState('')
  const [phaseId, setPhaseId] = useState(''),
    [phaseName, setPhaseName] = useState(''),
    [externalAllowed, setExternalAllowed] = useState(false)
  const notify = useJobsStore((s) => s.notify)
  const load = useCallback(async () => {
    const [a, p, s] = await Promise.all([
      invoke<Artifact[]>('project.listArtifactSettings'),
      invoke<Phase[]>('project.listDevPhases'),
      invoke<Record<string, unknown>>('settings.getProjectSettings')
    ])
    if (a.ok) setArtifacts(a.result)
    if (p.ok) {
      setPhases(p.result)
      setArtifactPhase((v) => v || p.result.find((x) => x.is_active === 1)?.dev_phase_id || '')
    }
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
            devPhaseId: item.dev_phase_id,
            sortOrder: item.sort_order,
            isActive: item.is_active !== 1
          }
        : { artifactName, artifactTypeId, devPhaseId: artifactPhase, sortOrder: artifacts.length }
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
  const remove = async (method: string, uid: string, label: string): Promise<void> => {
    const accepted = await confirmDialog({
      message: `${label}を削除します。関連する中間データも復旧不能になります。よろしいですか？`,
      okLabel: '削除',
      danger: true
    })
    if (!accepted) return
    const res = await invoke(method, { uid })
    if (!res.ok) notify('error', `${label}を削除できませんでした`, res.error.message)
    else {
      notify('info', `${label}を削除しました`)
      await load()
    }
  }
  const section: React.CSSProperties = {
    border: '1px solid var(--d2d-border)',
    borderRadius: 6,
    padding: 12,
    marginBottom: 16
  }
  const row: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 70px 70px',
    gap: 8,
    alignItems: 'center',
    margin: '5px 0'
  }
  return (
    <div style={{ padding: 20, maxWidth: 900 }} data-testid="project-settings-editor">
      <h1 style={{ fontSize: 18, marginTop: 0 }}>プロジェクト設定</h1>
      <p style={{ color: 'var(--d2d-fg-muted)' }}>
        この設定は現在のプロジェクト内に保存されます。成果物は開発フェーズの配下で管理します。
      </p>
      <section style={section}>
        <h2 style={{ fontSize: 14 }}>開発フェーズ・成果物設定</h2>
        {phases.map((phase) => (
          <div
            key={phase.uid}
            data-testid={`project-phase-${phase.dev_phase_id}`}
            style={{ borderLeft: '3px solid var(--d2d-accent)', paddingLeft: 10, marginBottom: 12 }}
          >
            <div style={row}>
              <strong>{phase.dev_phase_name}</strong>
              <code>{phase.dev_phase_id}</code>
              <button className="d2d-btn small" onClick={() => void savePhase(phase)}>
                {phase.is_active ? '無効化' : '有効化'}
              </button>
              <button
                className="d2d-btn small danger"
                onClick={() => void remove('project.deleteDevPhase', phase.uid, '開発フェーズ')}
              >
                削除
              </button>
            </div>
            {artifacts
              .filter((a) => a.dev_phase_id === phase.dev_phase_id)
              .map((a) => (
                <div
                  key={a.uid}
                  style={{ ...row, marginLeft: 16 }}
                  data-testid={`project-artifact-${a.artifact_type_id}`}
                >
                  <span>└ {a.artifact_name}</span>
                  <code>{a.artifact_type_id}</code>
                  <button className="d2d-btn small" onClick={() => void saveArtifact(a)}>
                    {a.is_active ? '無効化' : '有効化'}
                  </button>
                  <button
                    className="d2d-btn small danger"
                    onClick={() => void remove('project.deleteArtifactSetting', a.uid, '成果物')}
                  >
                    削除
                  </button>
                </div>
              ))}
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
            フェーズ追加
          </button>
        </div>
        <div style={{ ...row, gridTemplateColumns: '1fr 1fr 1fr 70px' }}>
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
          <select value={artifactPhase} onChange={(e) => setArtifactPhase(e.target.value)} data-testid="artifact-phase">
            <option value="">開発フェーズを選択</option>
            {phases
              .filter((p) => p.is_active)
              .map((p) => (
                <option key={p.uid} value={p.dev_phase_id}>
                  {p.dev_phase_name}
                </option>
              ))}
          </select>
          <button
            className="d2d-btn primary small"
            disabled={!artifactName || !artifactTypeId || !artifactPhase}
            onClick={() => void saveArtifact()}
            data-testid="artifact-add"
          >
            成果物追加
          </button>
        </div>
      </section>
      <section style={section}>
        <h2 style={{ fontSize: 14 }}>LLM 外部送信（LLM-042）</h2>
        <label>
          <input
            type="checkbox"
            checked={externalAllowed}
            onChange={async (e) => {
              const value = e.target.checked
              const r = await invoke('settings.setProjectSetting', { key: 'llm.externalSendAllowed', value })
              if (r.ok) setExternalAllowed(value)
            }}
            data-testid="llm-external-allowed"
          />{' '}
          このプロジェクトから外部 LLM への送信を許可する（既定: 不可）
        </label>
      </section>
    </div>
  )
}
