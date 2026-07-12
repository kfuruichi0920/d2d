/**
 * Editor Area（P3-1、sdd_ui_design §10）。Resource URI に応じた Editor Provider を表示する。
 */
import { useEditorStore, type EditorGroup } from '../../stores/editor-store'
import { DashboardEditor } from '../editors/DashboardEditor'
import { SettingsEditor } from '../editors/SettingsEditor'
import { ProjectSettingsEditor } from '../editors/ProjectSettingsEditor'
import { JobLogEditor } from '../editors/JobLogEditor'
import { WelcomeEditor } from '../editors/WelcomeEditor'
import { ExtractionReviewEditor } from '../editors/ExtractionReviewEditor'
import { OriginalViewer } from '../views/DocumentsTree'
import { LlmRunViewer } from '../views/LlmViews'
import { IntermediateDocumentEditor } from '../editors/IntermediateDocumentEditor'
import { CandidateSetReviewEditor } from '../editors/CandidateSetReviewEditor'
import { DesignElementViewer } from '../views/DesignModelViews'
import { BasisChainEditor, TraceGraphEditor, TraceMatrixEditor } from '../views/TraceViews'
import { GlossaryEditor } from '../editors/GlossaryEditor'
import { ModelPlaygroundEditor } from '../editors/ModelPlaygroundEditor'
import { ArchiveDiffEditor, GitCommitViewer, StoreBrowserEditor } from '../views/HistoryViews'
import { ReportPreviewEditor } from '../views/ReportViews'

/** Resource URI → Editor Provider の解決（§10.2。P7 以降で Provider を追加する） */
function resolveEditor(uri: string): React.JSX.Element {
  if (uri === 'project://current') return <DashboardEditor />
  if (uri.startsWith('settings://')) return <SettingsEditor />
  if (uri.startsWith('project-settings://')) return <ProjectSettingsEditor />
  if (uri.startsWith('log://job/')) return <JobLogEditor jobId={uri.slice('log://job/'.length)} />
  if (uri.startsWith('log://llm/')) return <LlmRunViewer uid={uri.slice('log://llm/'.length)} />
  if (uri.startsWith('original://')) return <OriginalViewer uid={uri.slice('original://'.length)} />
  if (uri.startsWith('extracted://')) return <ExtractionReviewEditor uid={uri.slice('extracted://'.length)} />
  if (uri.startsWith('intermediate://')) return <IntermediateDocumentEditor uid={uri.slice('intermediate://'.length)} />
  if (uri.startsWith('candidate://')) return <CandidateSetReviewEditor llmRunUid={uri.slice('candidate://'.length)} />
  if (uri.startsWith('design://')) return <DesignElementViewer uid={uri.slice('design://'.length)} />
  if (uri.startsWith('trace://graph/')) {
    const [rootUid, depth, direction] = uri.slice('trace://graph/'.length).split('/')
    return <TraceGraphEditor rootUid={rootUid ?? ''} depth={Number(depth ?? 3)} direction={direction ?? 'both'} />
  }
  if (uri.startsWith('trace://matrix/')) {
    const [row, col] = uri.slice('trace://matrix/'.length).split('/')
    return <TraceMatrixEditor initialRow={row ?? 'FUNC'} initialCol={col ?? 'REQ'} />
  }
  if (uri === 'trace://list-link') return <BasisChainEditor />
  if (uri.startsWith('glossary://')) return <GlossaryEditor />
  if (uri === 'model://playground') return <ModelPlaygroundEditor />
  if (uri === 'diff://archive') return <ArchiveDiffEditor />
  if (uri.startsWith('diff://git/')) return <GitCommitViewer hash={uri.slice('diff://git/'.length)} />
  if (uri === 'store://tables') return <StoreBrowserEditor />
  if (uri.startsWith('report://')) return <ReportPreviewEditor fileName={uri.slice('report://'.length)} />
  return <div className="d2d-empty">この Resource（{uri}）の Editor Provider は未実装です。</div>
}

export function EditorArea(): React.JSX.Element {
  const groups = useEditorStore((s) => s.groups)
  const hasAnyTab = groups.some((g) => g.tabs.length > 0)

  if (!hasAnyTab) {
    return (
      <div className="wb-editor-area" data-testid="editor-area">
        <div className="wb-editor-group">
          <div className="wb-editor-body">
            <WelcomeEditor />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="wb-editor-area" data-testid="editor-area">
      {groups.map((group) => (
        <GroupView key={group.id} group={group} />
      ))}
    </div>
  )
}

function GroupView({ group }: { group: EditorGroup }): React.JSX.Element {
  const activateTab = useEditorStore((s) => s.activateTab)
  const closeTab = useEditorStore((s) => s.closeTab)
  const pinTab = useEditorStore((s) => s.pinTab)
  const activeTab = group.tabs.find((t) => t.uri === group.activeUri)

  return (
    <div className="wb-editor-group" data-testid={`editor-group-${group.id}`}>
      <div className="wb-tabs" role="tablist">
        {group.tabs.map((tab) => (
          <span
            key={tab.uri}
            role="tab"
            aria-selected={tab.uri === group.activeUri}
            className={`wb-tab ${tab.uri === group.activeUri ? 'active' : ''}`}
            onClick={() => activateTab(tab.uri, group.id)}
            onDoubleClick={() => pinTab(tab.uri)}
          >
            <span className={tab.preview ? 'preview' : ''}>{tab.title}</span>
            {tab.dirty && <span className="dirty-dot">●</span>}
            <button
              type="button"
              className="close"
              aria-label={`${tab.title} を閉じる`}
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.uri, group.id)
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="wb-editor-body">{activeTab ? resolveEditor(activeTab.uri) : null}</div>
    </div>
  )
}
