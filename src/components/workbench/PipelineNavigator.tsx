/**
 * Pipeline Navigator（P3-7、UI-046、sdd_ui_design §3.1）。
 * ①〜④、分析、用語集、ResourceアドレスをIDE風ナビゲーションとして常時表示する。
 */
import { useEffect, useState } from 'react'
import { resolveResourceAddress } from '../../services/resource-address'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorkbenchStore, type WorkMode } from '../../stores/workbench-store'

interface StageDef {
  key: 'source' | 'extracted' | 'intermediate' | 'design'
  label: string
  mode: WorkMode
}

const STAGES: StageDef[] = [
  { key: 'source', label: '①原本', mode: 'M1' },
  { key: 'extracted', label: '②抽出', mode: 'M1' },
  { key: 'intermediate', label: '③中間', mode: 'M2' },
  { key: 'design', label: '④モデル', mode: 'M3' }
]

const ARROWS = ['-(抽出)->', '-(統合)->', '-(モデル化)->']

export function PipelineNavigator(): React.JSX.Element {
  const hasProject = useProjectStore((state) => state.project !== null)
  const switchMode = useWorkbenchStore((state) => state.switchMode)
  const notify = useJobsStore((state) => state.notify)
  const openResource = useEditorStore((state) => state.openResource)
  const activeUri = useEditorStore((state) => state.activeUri)
  const [address, setAddress] = useState(activeUri ?? '')

  useEffect(() => setAddress(activeUri ?? ''), [activeUri])

  const navigateAddress = (): void => {
    const resolved = resolveResourceAddress(address)
    if (!resolved) {
      notify('error', 'アドレスを開けません', '既知のResource URIを入力してください（例: resource://<uid>）')
      return
    }
    openResource(resolved.uri, resolved.title, { preview: false })
  }

  return (
    <nav className="wb-pipeline" data-testid="pipeline-navigator">
      {STAGES.map((stage, index) => (
        <span key={stage.key} className="wb-stage-segment">
          {index > 0 && <span className="wb-stage-arrow">{ARROWS[index - 1]}</span>}
          <button
            type="button"
            className={`wb-stage ${activeUri === `stage://${stage.key}` ? 'active' : ''}`}
            data-testid={`stage-${stage.key}`}
            disabled={!hasProject}
            onClick={() => {
              switchMode(stage.mode)
              openResource(`stage://${stage.key}`, `${stage.label}一覧`, { preview: false })
            }}
            title={`${stage.label} — 一覧を開く`}
          >
            {stage.label}
          </button>
        </span>
      ))}
      <button
        type="button"
        className="wb-pipeline-tool"
        data-testid="pipeline-analysis"
        disabled={!hasProject}
        title="全抽出データ・全中間データ・全モデルの汎用インパクト分析を開く"
        onClick={() => openResource('trace://list-link/pipeline', '汎用インパクト分析', { preview: false })}
      >
        分析
      </button>
      <button
        type="button"
        className="wb-pipeline-tool"
        data-testid="pipeline-glossary"
        disabled={!hasProject}
        title="プロジェクト用語集を開く"
        onClick={() => openResource('glossary://workspace', '用語集', { preview: false })}
      >
        用語集
      </button>
      <label className="wb-resource-address">
        <span>アドレス</span>
        <input
          value={address}
          data-testid="resource-address"
          aria-label="現在のResourceアドレス"
          title="現在のResource URI。既知のURIを入力してEnterで移動します（例: resource://<uid>）"
          placeholder="resource://..."
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') navigateAddress()
          }}
        />
      </label>
    </nav>
  )
}
