/**
 * ③中間データの成果物取込ダイアログ（P7-1、UI-048）。
 */
import { useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import type { ExtractedDocumentItem, IntermediateDocumentItem } from '../views/DocumentsTree'

interface ArtifactSetting {
  uid: string
  artifact_name: string
  artifact_type_id: string
  dev_phase_id: string | null
  is_active: number
}
interface DevPhaseSetting {
  uid: string
  dev_phase_id: string
  dev_phase_name: string
  is_active: number
}

export function IntermediateImportDialog({
  onClose,
  onSaved
}: {
  onClose: () => void
  onSaved: () => void | Promise<void>
}): React.JSX.Element {
  const [artifacts, setArtifacts] = useState<ArtifactSetting[]>([])
  const [phases, setPhases] = useState<DevPhaseSetting[]>([])
  const [extracted, setExtracted] = useState<ExtractedDocumentItem[]>([])
  const [intermediates, setIntermediates] = useState<IntermediateDocumentItem[]>([])
  const [selectedArtifactUid, setSelectedArtifactUid] = useState<string | null>(null)
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const notify = useJobsStore((state) => state.notify)

  useEffect(() => {
    void Promise.all([
      invoke<ArtifactSetting[]>('project.listArtifactSettings'),
      invoke<DevPhaseSetting[]>('project.listDevPhases'),
      invoke<ExtractedDocumentItem[]>('extracted.list'),
      invoke<IntermediateDocumentItem[]>('intermediate.list')
    ]).then(([artifactResult, phaseResult, extractedResult, intermediateResult]) => {
      if (artifactResult.ok) setArtifacts(artifactResult.result)
      if (phaseResult.ok) setPhases(phaseResult.result)
      if (extractedResult.ok) setExtracted(extractedResult.result)
      if (intermediateResult.ok) setIntermediates(intermediateResult.result)
    })
  }, [])

  const save = async (): Promise<void> => {
    const artifact = artifacts.find((item) => item.uid === selectedArtifactUid)
    const phase = artifact ? phases.find((item) => item.dev_phase_id === artifact.dev_phase_id) : undefined
    if (!artifact || !phase) return
    const existing = intermediates.find(
      (doc) => doc.dev_phase_id === phase.dev_phase_id && doc.artifact_type_id === artifact.artifact_type_id
    )
    setSaving(true)
    const result = existing
      ? await invoke('intermediate.updateSources', { uid: existing.uid, extractedDocumentUids: [...selectedSources] })
      : await invoke('intermediate.create', {
          extractedDocumentUids: [...selectedSources],
          artifactTypeId: artifact.artifact_type_id,
          devPhaseId: phase.dev_phase_id,
          title: artifact.artifact_name,
          importItems: false
        })
    setSaving(false)
    if (!result.ok) {
      notify('error', '③中間データへ取込できませんでした', result.error.message)
      return
    }
    notify('info', existing ? '③中間データの取込元を更新しました' : '③中間データを作成しました')
    await onSaved()
    onClose()
  }

  return (
    <div role="dialog" aria-modal="true" className="stage-import-dialog" data-testid="intermediate-source-dialog">
      <h3>③中間データへ取込</h3>
      <section data-testid="intermediate-import-targets">
        <b>取込先（③中間データの成果物・1件選択）</b>
        {phases
          .filter((phase) => phase.is_active === 1)
          .flatMap((phase) =>
            artifacts
              .filter((artifact) => artifact.is_active === 1 && artifact.dev_phase_id === phase.dev_phase_id)
              .map((artifact) => {
                const checked = selectedArtifactUid === artifact.uid
                return (
                  <label key={artifact.uid}>
                    <input
                      type="checkbox"
                      data-testid={`intermediate-target-${phase.dev_phase_id}-${artifact.artifact_type_id}`}
                      checked={checked}
                      onChange={(event) => {
                        if (!event.target.checked) {
                          setSelectedArtifactUid(null)
                          setSelectedSources(new Set())
                          return
                        }
                        const existing = intermediates.find(
                          (doc) =>
                            doc.dev_phase_id === phase.dev_phase_id &&
                            doc.artifact_type_id === artifact.artifact_type_id
                        )
                        setSelectedArtifactUid(artifact.uid)
                        setSelectedSources(
                          new Set(existing?.sources?.map((source) => source.extracted_document_uid) ?? [])
                        )
                      }}
                    />{' '}
                    {phase.dev_phase_name} / {artifact.artifact_name}
                  </label>
                )
              })
          )}
      </section>
      <section data-testid="intermediate-import-sources">
        <b>取込元（②抽出データ・複数選択可）</b>
        {extracted.map((item) => (
          <label key={item.uid}>
            <input
              type="checkbox"
              data-testid={`intermediate-source-${item.code}`}
              disabled={!selectedArtifactUid}
              checked={selectedSources.has(item.uid)}
              onChange={(event) =>
                setSelectedSources((current) => {
                  const next = new Set(current)
                  if (event.target.checked) next.add(item.uid)
                  else next.delete(item.uid)
                  return next
                })
              }
            />{' '}
            <ReviewStatusBadge status={reviewStateFromEntityStatus(item.status)} /> {item.title ?? item.code}
          </label>
        ))}
      </section>
      <div className="stage-import-dialog-actions">
        <button type="button" className="d2d-btn" onClick={onClose}>
          キャンセル
        </button>
        <button
          type="button"
          className="d2d-btn primary"
          disabled={!selectedArtifactUid || saving}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '選択内容を保存'}
        </button>
      </div>
    </div>
  )
}
