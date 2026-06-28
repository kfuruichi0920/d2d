import React, { lazy, Suspense } from 'react'
import { SerendieSymbolClose } from '@serendie/symbols'
import { useWorkbenchStore, type ViewId } from '../../stores/workbenchStore'

// lazy-load 各ビュー
const SourceDocumentsPage = lazy(() => import('../../pages/SourceDocumentsPage').then(m => ({ default: m.SourceDocumentsPage })))
const IntermediatePage = lazy(() => import('../../pages/IntermediatePage').then(m => ({ default: m.IntermediatePage })))
const DesignElementsPage = lazy(() => import('../../pages/DesignElementsPage').then(m => ({ default: m.DesignElementsPage })))
const GlossaryPage = lazy(() => import('../../pages/GlossaryPage').then(m => ({ default: m.GlossaryPage })))
const TraceMatrixPage = lazy(() => import('../../pages/TraceMatrixPage').then(m => ({ default: m.TraceMatrixPage })))
const TraceGraphPage = lazy(() => import('../../pages/TraceGraphPage').then(m => ({ default: m.TraceGraphPage })))
const LlmCandidatePage = lazy(() => import('../../pages/LlmCandidatePage').then(m => ({ default: m.LlmCandidatePage })))
const LlmLogPage = lazy(() => import('../../pages/LlmLogPage').then(m => ({ default: m.LlmLogPage })))
const LlmPromptsPage = lazy(() => import('../../pages/LlmPromptsPage').then(m => ({ default: m.LlmPromptsPage })))
const JobsView = lazy(() => import('./views/JobsView').then(m => ({ default: m.JobsView })))
const SettingsView = lazy(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })))
const ReportsPage = lazy(() => import('../../pages/ReportsPage'))
const GitPage = lazy(() => import('../../pages/GitPage'))
const StoreBrowserPage = lazy(() => import('../../pages/StoreBrowserPage'))
const PlantUmlPage = lazy(() => import('../../pages/PlantUmlPage'))
const LicensesPage = lazy(() => import('../../pages/LicensesPage'))
const TableEditorPage = lazy(() => import('../../pages/TableEditorPage'))
const StateMachineEditorPage = lazy(() => import('../../pages/StateMachineEditorPage'))
const VerificationPage = lazy(() => import('../../pages/VerificationPage'))
const ExtractedDataPage = lazy(() => import('../../pages/ExtractedDataPage').then(m => ({ default: m.ExtractedDataPage })))

function ViewContent({ viewId }: { viewId: ViewId }): React.JSX.Element {
  switch (viewId) {
    case 'sources': return <SourceDocumentsPage />
    case 'extraction': return <ExtractedDataPage />
    case 'intermediate': return <IntermediatePage />
    case 'design': return <DesignElementsPage />
    case 'glossary': return <GlossaryPage />
    case 'trace-matrix': return <TraceMatrixPage />
    case 'trace-graph': return <TraceGraphPage />
    case 'llm-candidates': return <LlmCandidatePage />
    case 'llm-logs': return <LlmLogPage />
    case 'llm-prompts': return <LlmPromptsPage />
    case 'jobs': return <JobsView />
    case 'settings': return <SettingsView />
    case 'reports': return <ReportsPage />
    case 'git': return <GitPage />
    case 'store-browser': return <StoreBrowserPage />
    case 'plantuml': return <PlantUmlPage />
    case 'licenses': return <LicensesPage />
    case 'table-editor': return <TableEditorPage />
    case 'state-machine': return <StateMachineEditorPage />
    case 'verification': return <VerificationPage />
  }
}

export function EditorArea(): React.JSX.Element {
  const { tabs, activeTabId, closeTab, setActiveTab } = useWorkbenchStore()

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--sd-color-bg-base, #fff)' }}>
      {/* タブバー */}
      {tabs.length > 0 && (
        <div
          style={{
            height: 36,
            display: 'flex',
            alignItems: 'stretch',
            background: 'var(--sd-color-bg-layer1, #f5f6f7)',
            borderBottom: '1px solid var(--sd-color-border-default, #e0e0e0)',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                  borderBottom: active ? '2px solid var(--sd-color-reference-primary-40, #2563eb)' : '2px solid transparent',
                  background: active ? 'var(--sd-color-bg-base, #fff)' : 'transparent',
                  color: active ? 'var(--sd-color-text-primary, #111)' : 'var(--sd-color-text-secondary, #666)',
                  fontWeight: active ? 500 : 400,
                  flexShrink: 0,
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{tab.label}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                    display: 'flex', alignItems: 'center', opacity: 0.5, borderRadius: 2,
                  }}
                  title="閉じる"
                >
                  <SerendieSymbolClose width={12} height={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* エディタコンテンツ */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tabs.length === 0 ? (
          <WelcomeScreen />
        ) : (
          tabs.map((tab) => (
            <div
              key={tab.id}
              style={{ display: tab.id === activeTabId ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
            >
              <Suspense fallback={<div style={{ padding: 24, color: '#888' }}>読み込み中…</div>}>
                <ViewContent viewId={tab.viewId} />
              </Suspense>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function WelcomeScreen(): React.JSX.Element {
  const { openTab } = useWorkbenchStore()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 24, color: '#888' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#333', letterSpacing: '-0.01em' }}>D2D</div>
      <div style={{ fontSize: 13, color: '#888' }}>Design to Digital</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240 }}>
        {([
          { viewId: 'sources', label: '原本ドキュメント' },
          { viewId: 'design', label: '設計要素' },
          { viewId: 'glossary', label: '用語集' },
          { viewId: 'trace-matrix', label: 'トレースマトリクス' },
        ] as const).map(({ viewId, label }) => (
          <button
            key={viewId}
            onClick={() => openTab({ viewId, label })}
            style={{
              padding: '8px 16px', background: '#f3f4f6', border: '1px solid #e0e0e0',
              borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#333', textAlign: 'left',
            }}
          >
            {label} →
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#aaa' }}>Ctrl+Shift+P でコマンドパレット</div>
    </div>
  )
}
