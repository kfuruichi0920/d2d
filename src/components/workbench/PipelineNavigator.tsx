/**
 * Pipeline Navigator（P3-7、sdd_ui_design §3.1）。
 * ①〜④のステージ・件数・変換アクションを常時表示し、クリックで作業モードへ切り替える。
 */
import { useProjectStore } from '../../stores/project-store'
import { useWorkbenchStore, type WorkMode } from '../../stores/workbench-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useEditorStore } from '../../stores/editor-store'

interface StageDef {
  key: string
  label: string
  mode: WorkMode
  count: (stats: NonNullable<ReturnType<typeof useProjectStore.getState>['stats']>) => number
}

const STAGES: StageDef[] = [
  { key: 'source', label: '①原本', mode: 'M1', count: (s) => s.sources },
  { key: 'extracted', label: '②抽出', mode: 'M1', count: (s) => s.extracted },
  { key: 'intermediate', label: '③中間', mode: 'M2', count: (s) => s.intermediate },
  { key: 'design', label: '④モデル', mode: 'M3', count: (s) => s.designElements }
]

const ARROWS = ['抽出▶', '統合▶', 'モデル化▶']

export function PipelineNavigator(): React.JSX.Element {
  const stats = useProjectStore((s) => s.stats)
  const hasProject = useProjectStore((s) => s.project !== null)
  const workMode = useWorkbenchStore((s) => s.workMode)
  const switchMode = useWorkbenchStore((s) => s.switchMode)
  const runningCount = useJobsStore((s) => s.runningCount)
  const openResource = useEditorStore((s) => s.openResource)

  return (
    <nav className="wb-pipeline" data-testid="pipeline-navigator">
      {STAGES.map((stage, i) => (
        <span key={stage.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {i > 0 && <span className="wb-stage-arrow">{ARROWS[i - 1]}</span>}
          <button
            type="button"
            className={`wb-stage ${workMode === stage.mode ? 'active' : ''}`}
            data-testid={`stage-${stage.key}`}
            disabled={!hasProject}
            onClick={() => {
              switchMode(stage.mode)
              openResource(`stage://${stage.key}`, `${stage.label}一覧`, { preview: false })
            }}
            title={`${stage.label} — 一覧を開く`}
          >
            {stage.label}
            <span className="count">{stats ? stage.count(stats) : '-'}</span>
          </button>
        </span>
      ))}
      <span style={{ flex: 1 }} />
      {runningCount > 0 && (
        <span style={{ color: 'var(--d2d-fg-muted)' }} data-testid="pipeline-jobs">
          ジョブ実行中: {runningCount}
        </span>
      )}
    </nav>
  )
}
