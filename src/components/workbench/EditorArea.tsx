/**
 * Editor Area（P3-1、UI-006/022/039/040、sdd_ui_design §10）。
 * Resource Providerを再帰Editor Groupへ表示し、分割リサイズとタブDnDを提供する。
 */
import { useRef } from 'react'
import { useEditorStore, type EditorGroup, type EditorLayoutNode } from '../../stores/editor-store'
import { showContextMenu } from '../common/ContextMenu'
import { DashboardEditor } from '../editors/DashboardEditor'
import { SettingsEditor } from '../editors/SettingsEditor'
import { ProjectSettingsEditor } from '../editors/ProjectSettingsEditor'
import { JobLogEditor } from '../editors/JobLogEditor'
import { WelcomeEditor } from '../editors/WelcomeEditor'
import { HelpEditor, type HelpTopic } from '../editors/HelpEditor'
import { ExtractionReviewEditor } from '../editors/ExtractionReviewEditor'
import { OriginalViewer } from '../views/DocumentsTree'
import { LlmRunViewer } from '../views/LlmViews'
import { IntermediateDocumentEditor } from '../editors/IntermediateDocumentEditor'
import { CandidateSetReviewEditor } from '../editors/CandidateSetReviewEditor'
import { TabIcon } from './tab-icons'
import { DesignElementViewer } from '../views/DesignModelViews'
import { TraceGraphEditor } from '../views/TraceViews'
import { TraceMatrixEditor } from '../editors/TraceMatrixEditor'
import { TraceImpactEditor } from '../editors/TraceImpactEditor'
import { GlossaryEditor } from '../editors/GlossaryEditor'
import { ModelPlaygroundEditor } from '../editors/ModelPlaygroundEditor'
import {
  ArchiveDiffEditor,
  GitCommitViewer,
  GitSemanticDiffEditor,
  GitWorkingDiffEditor,
  StoreBrowserEditor
} from '../views/HistoryViews'
import { ReportPreviewEditor } from '../views/ReportViews'
import { ResourceEditorPage } from '../editors/ResourceEditor'
import { PipelineStageEditor, type PipelineStage } from '../editors/PipelineStageEditor'
import { ResizeHandle } from './ResizeHandle'
import { ResourceAddressListEditor, type ListableResourceScheme } from '../editors/ResourceAddressListEditor'
import { EmptyEditor } from '../editors/EmptyEditor'
import { openEmptyTab } from '../../services/empty-tab'

const TAB_DRAG_TYPE = 'application/x-d2d-editor-tab'

function resolveEditor(uri: string): React.JSX.Element {
  if (uri.startsWith('empty://')) return <EmptyEditor />
  const addressList = /^(original|extracted|intermediate|chunk|candidate|design|resource):\/\/$/.exec(uri)
  if (addressList) return <ResourceAddressListEditor scheme={addressList[1] as ListableResourceScheme} />
  if (uri.startsWith('help://')) return <HelpEditor topic={uri.slice('help://'.length) as HelpTopic} />
  if (uri === 'project://current') return <DashboardEditor />
  if (uri.startsWith('stage://')) return <PipelineStageEditor stage={uri.slice('stage://'.length) as PipelineStage} />
  if (uri.startsWith('settings://')) return <SettingsEditor />
  if (uri.startsWith('project-settings://')) return <ProjectSettingsEditor />
  if (uri.startsWith('log://job/')) return <JobLogEditor jobId={uri.slice('log://job/'.length)} />
  if (uri.startsWith('log://llm/')) return <LlmRunViewer uid={uri.slice('log://llm/'.length)} />
  if (uri.startsWith('original://')) return <OriginalViewer uid={uri.slice('original://'.length)} />
  if (uri.startsWith('extracted://')) return <ExtractionReviewEditor uid={uri.slice('extracted://'.length)} />
  if (uri.startsWith('intermediate://')) return <IntermediateDocumentEditor uid={uri.slice('intermediate://'.length)} />
  if (uri.startsWith('chunk://'))
    return <IntermediateDocumentEditor uid={uri.slice('chunk://'.length)} initialMode="chunk" />
  if (uri.startsWith('candidate://')) return <CandidateSetReviewEditor llmRunUid={uri.slice('candidate://'.length)} />
  if (uri.startsWith('design://')) return <DesignElementViewer uid={uri.slice('design://'.length)} />
  if (uri.startsWith('resource://')) return <ResourceEditorPage uid={uri.slice('resource://'.length)} />
  if (uri.startsWith('trace://graph/')) {
    const [rootUid, depth, direction] = uri.slice('trace://graph/'.length).split('/')
    return <TraceGraphEditor rootUid={rootUid ?? ''} depth={Number(depth ?? 3)} direction={direction ?? 'both'} />
  }
  if (uri.startsWith('trace://matrix/')) {
    const [row, col] = uri.slice('trace://matrix/'.length).split('/')
    return <TraceMatrixEditor initialRow={row ?? 'FUNC'} initialCol={col ?? 'REQ'} />
  }
  if (uri.startsWith('trace://list-link')) return <TraceImpactEditor contextUri={uri} />
  if (uri.startsWith('glossary://')) return <GlossaryEditor />
  if (uri === 'model://playground') return <ModelPlaygroundEditor />
  if (uri === 'diff://archive') return <ArchiveDiffEditor />
  if (uri.startsWith('diff://git-working/'))
    return <GitWorkingDiffEditor path={decodeURIComponent(uri.slice('diff://git-working/'.length))} />
  if (uri.startsWith('diff://git-compare/')) {
    const [fromHash, toHash] = uri.slice('diff://git-compare/'.length).split('..')
    return <GitSemanticDiffEditor fromHash={fromHash ?? ''} toHash={toHash ?? ''} />
  }
  if (uri.startsWith('diff://git/')) return <GitCommitViewer hash={uri.slice('diff://git/'.length)} />
  if (uri === 'store://tables') return <StoreBrowserEditor />
  if (uri.startsWith('report://')) return <ReportPreviewEditor fileName={uri.slice('report://'.length)} />
  return <div className="d2d-empty">この Resource（{uri}）の Editor Provider は未実装です。</div>
}

export function EditorArea(): React.JSX.Element {
  const groups = useEditorStore((state) => state.groups)
  const layout = useEditorStore((state) => state.layout)
  const hasAnyTab = groups.some((group) => group.tabs.length > 0)
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
      <LayoutNodeView node={layout} />
    </div>
  )
}

function LayoutNodeView({ node }: { node: EditorLayoutNode }): React.JSX.Element | null {
  const groups = useEditorStore((state) => state.groups)
  const resizeSplit = useEditorStore((state) => state.resizeSplit)
  const containerRef = useRef<HTMLDivElement>(null)
  if (node.kind === 'group') {
    const group = groups.find((candidate) => candidate.id === node.groupId)
    return group ? <GroupView group={group} /> : null
  }
  const horizontal = node.direction === 'horizontal'
  return (
    <div
      ref={containerRef}
      className={'wb-editor-split ' + node.direction}
      data-testid={'editor-split-' + node.id}
      data-direction={node.direction}
    >
      <div className="wb-editor-split-child" style={{ flexBasis: node.ratio * 100 + '%' }}>
        <LayoutNodeView node={node.first} />
      </div>
      <ResizeHandle
        axis={horizontal ? 'x' : 'y'}
        label={horizontal ? 'Editor左右分割のサイズ変更' : 'Editor上下分割のサイズ変更'}
        testId={'editor-split-handle-' + node.id}
        onDelta={(delta) => {
          const size = horizontal ? containerRef.current?.clientWidth : containerRef.current?.clientHeight
          if (size && size > 0) resizeSplit(node.id, delta / size)
        }}
      />
      <div className="wb-editor-split-child" style={{ flexBasis: (1 - node.ratio) * 100 + '%' }}>
        <LayoutNodeView node={node.second} />
      </div>
    </div>
  )
}

function GroupView({ group }: { group: EditorGroup }): React.JSX.Element {
  const activateTab = useEditorStore((state) => state.activateTab)
  const closeTab = useEditorStore((state) => state.closeTab)
  const pinTab = useEditorStore((state) => state.pinTab)
  const togglePinTab = useEditorStore((state) => state.togglePinTab)
  const splitGroup = useEditorStore((state) => state.splitGroup)
  const moveTab = useEditorStore((state) => state.moveTab)
  const refreshVersion = useEditorStore((state) => state.refreshVersion)
  const activeTab = group.tabs.find((tab) => tab.uri === group.activeUri)

  const acceptDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    const raw = event.dataTransfer.getData(TAB_DRAG_TYPE)
    if (!raw) return
    try {
      const data = JSON.parse(raw) as { uri: string; groupId: number }
      moveTab(data.uri, data.groupId, group.id)
    } catch {
      // D2D内部タブ以外のdropは無視する。
    }
  }

  return (
    <div
      className="wb-editor-group"
      data-workbench-tab-region="editor"
      tabIndex={-1}
      onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
      data-testid={'editor-group-' + group.id}
      onDragOver={(event) => event.preventDefault()}
      onDrop={acceptDrop}
    >
      <div className="wb-tabs" role="tablist">
        {group.tabs.map((tab) => (
          <span
            key={tab.uri}
            role="tab"
            aria-selected={tab.uri === group.activeUri}
            className={'wb-tab ' + (tab.uri === group.activeUri ? 'active' : '')}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData(TAB_DRAG_TYPE, JSON.stringify({ uri: tab.uri, groupId: group.id }))
            }}
            onClick={() => activateTab(tab.uri, group.id)}
            onDoubleClick={() => pinTab(tab.uri)}
            onContextMenu={(event) =>
              showContextMenu(event, [
                { label: '閉じる', detail: 'Ctrl+W', testId: 'tab-menu-close', run: () => closeTab(tab.uri, group.id) },
                {
                  label: '他のタブをすべて閉じる',
                  disabled: group.tabs.length <= 1,
                  testId: 'tab-menu-close-others',
                  run: () => group.tabs.filter((t) => t.uri !== tab.uri).forEach((t) => closeTab(t.uri, group.id))
                },
                {
                  label: 'すべてのタブを閉じる',
                  testId: 'tab-menu-close-all',
                  run: () => [...group.tabs].forEach((t) => closeTab(t.uri, group.id))
                },
                { separator: true },
                {
                  label: tab.pinned ? 'ピン止めを解除' : 'タブをピン止め',
                  run: () => togglePinTab(tab.uri)
                },
                { separator: true },
                { label: 'Editorを左右に分割', run: () => splitGroup(group.id, 'horizontal') },
                { label: 'Editorを上下に分割', run: () => splitGroup(group.id, 'vertical') }
              ])
            }
            title={tab.title}
          >
            <TabIcon uri={tab.uri} />
            <button
              type="button"
              className={'tab-pin ' + (tab.pinned ? 'pinned' : '')}
              title={tab.pinned ? 'ピン止めを解除' : 'タブをピン止め'}
              aria-label={tab.pinned ? `${tab.title} のピン止めを解除` : `${tab.title} をピン止め`}
              data-testid={`tab-pin-${tab.uri}`}
              onClick={(event) => {
                event.stopPropagation()
                togglePinTab(tab.uri)
              }}
            >
              {tab.pinned ? '●' : '○'}
            </button>
            <span className={'wb-tab-title ' + (tab.preview ? 'preview' : '')}>{tab.title}</span>
            {tab.dirty && <span className="dirty-dot">●</span>}
            <button
              type="button"
              className="close"
              aria-label={tab.title + ' を閉じる'}
              onClick={(event) => {
                event.stopPropagation()
                closeTab(tab.uri, group.id)
              }}
            >
              ×
            </button>
          </span>
        ))}
        <span className="wb-tab-actions">
          <button
            type="button"
            title="新しいタブ (Ctrl+T)"
            aria-label="新しいタブ"
            data-testid={'editor-new-tab-' + group.id}
            onClick={() => openEmptyTab(group.id)}
          >
            ＋
          </button>
          <button
            type="button"
            title="左右に分割"
            aria-label="左右に分割"
            data-testid={'editor-split-horizontal-' + group.id}
            onClick={() => splitGroup(group.id, 'horizontal')}
          >
            ◫
          </button>
          <button
            type="button"
            title="上下に分割"
            aria-label="上下に分割"
            data-testid={'editor-split-vertical-' + group.id}
            onClick={() => splitGroup(group.id, 'vertical')}
          >
            ⊟
          </button>
        </span>
      </div>
      <div className="wb-editor-body">
        {activeTab ? (
          <div key={`${activeTab.uri}:${refreshVersion}`} className="wb-editor-refresh-root">
            {resolveEditor(activeTab.uri)}
          </div>
        ) : (
          <div className="d2d-empty">タブをここへドロップ</div>
        )}
      </div>
    </div>
  )
}
