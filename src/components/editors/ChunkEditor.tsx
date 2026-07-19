/**
 * 成果物単位のチャンク編集（P7-5/P8-3、MID-030〜034）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { moveKeyboardRangeSelection } from '../../utils/keyboard-range-selection'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useSelectionStore } from '../../stores/selection-store'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import { DocumentPreviewMetaControls, useDocumentPreviewMeta } from '../common/DocumentPreviewMeta'
import { ResizablePaneGroup } from '../workbench/ResizablePaneGroup'
import { confirmDialog } from '../common/ConfirmDialog'
import { showContextMenu } from '../common/ContextMenu'
import { LlmRequestDialog, type LlmRequestMessage, type PreparedLlmRequest } from '../common/LlmRequestDialog'

interface ElementRow {
  id: string
  type: string
  text?: string
  level?: number
  section_path?: string
  image?: string
  rows?: { text: string }[][]
  resource_uid?: string
  intermediate_item_uid?: string
  review?: { status: string }
}
interface DocumentData {
  title: string | null
  code: string
  elements: ElementRow[]
}
interface ChunkRow {
  uid: string
  code: string
  title: string | null
  item_count: number
  token_count: number
  additional_prompt: string
  item_uids: string[]
}
interface ChunkDetail extends ChunkRow {
  items: { intermediate_item_uid: string; sort_order: number; resource_uid: string }[]
}

const typeColors: Record<string, string> = {
  heading: '#7c3aed',
  paragraph: '#2563eb',
  list_item: '#0891b2',
  table: '#d97706',
  figure: '#db2777',
  caption: '#65a30d'
}

function FigurePreview({ resourceUid, alt }: { resourceUid?: string; alt?: string }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!resourceUid) return
    void invoke<{ dataUrl: string }>('extracted.getFigurePreview', { resourceUid }).then((result) => {
      if (result.ok) setSrc(result.result.dataUrl)
    })
  }, [resourceUid])
  return src ? (
    <img src={src} alt={alt ?? '図'} style={{ maxWidth: '100%', maxHeight: 420 }} />
  ) : (
    <div className="d2d-empty">図を読込中…</div>
  )
}

export function ChunkEditor({ uid }: { uid: string }): React.JSX.Element {
  const [doc, setDoc] = useState<DocumentData | null>(null)
  const [chunks, setChunks] = useState<ChunkRow[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [previewMeta, setPreviewMeta] = useDocumentPreviewMeta()
  const [activeItem, setActiveItem] = useState<string | null>(null)
  const [activePane, setActivePane] = useState<'item' | 'chunk'>('item')
  const [selectedChunk, setSelectedChunk] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChunkDetail | null>(null)
  const [prompt, setPrompt] = useState('')
  const [promptDraft, setPromptDraft] = useState('')
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [llmRequest, setLlmRequest] = useState<PreparedLlmRequest | null>(null)
  const anchor = useRef<number | null>(null)
  const keyboardAnchor = useRef<string | null>(null)
  const previewRefs = useRef(new Map<string, HTMLElement>())
  const notify = useJobsStore((s) => s.notify)
  const setSelectedItem = useSelectionStore((state) => state.setSelectedItem)
  const clearSelectedItem = useSelectionStore((state) => state.clearSelectedItem)

  const refresh = useCallback(async () => {
    const [d, c] = await Promise.all([
      invoke<DocumentData>('intermediate.get', { uid }),
      invoke<ChunkRow[]>('chunk.list', { intermediateDocumentUid: uid })
    ])
    if (d.ok) setDoc(d.result)
    if (c.ok) setChunks(c.result)
  }, [uid])

  useEffect(() => {
    void refresh()
    return onBackendEvent((event) => {
      if (event === 'intermediate.updated' || event === 'llm.candidate.generated') void refresh()
    })
  }, [refresh])

  useEffect(() => {
    if (activePane === 'chunk') {
      const chunk = chunks.find((item) => item.uid === selectedChunk)
      if (!chunk) return
      setSelectedItem({
        contextUri: `intermediate://${uid}`,
        uid: chunk.uid,
        displayId: chunk.code,
        entityType: 'chunk',
        title: chunk.title,
        properties: {
          itemCount: chunk.item_count,
          tokenCount: chunk.token_count,
          additionalPrompt: chunk.additional_prompt
        }
      })
      return
    }
    const element = doc?.elements.find((item) => item.intermediate_item_uid === activeItem)
    if (!element?.intermediate_item_uid) return
    setSelectedItem({
      contextUri: `intermediate://${uid}`,
      uid: element.intermediate_item_uid,
      displayId: element.intermediate_item_uid,
      entityType: 'intermediate_item',
      itemType: element.type,
      status: element.review?.status,
      properties: {
        resourceUid: element.resource_uid,
        type: element.type,
        status: element.review?.status,
        sectionPath: element.section_path,
        text: element.text ?? element.image
      }
    })
  }, [activeItem, activePane, chunks, doc, selectedChunk, setSelectedItem, uid])

  useEffect(() => () => clearSelectedItem(`intermediate://${uid}`), [clearSelectedItem, uid])

  const loadChunk = async (chunkUid: string): Promise<void> => {
    setSelectedChunk(chunkUid)
    setActivePane('chunk')
    const result = await invoke<ChunkDetail>('chunk.get', { uid: chunkUid })
    if (!result.ok) return
    setDetail(result.result)
    setSelectedItems(new Set(result.result.items.map((item) => item.intermediate_item_uid)))
    setPrompt(result.result.additional_prompt)
    setActiveItem(result.result.items[0]?.intermediate_item_uid ?? null)
  }

  const chooseItem = (row: ElementRow, index: number, event: React.MouseEvent): void => {
    if (row.review?.status !== 'approved' || !row.intermediate_item_uid) return
    const itemUid = row.intermediate_item_uid
    setSelectedItems((current) => {
      if (event.shiftKey && anchor.current !== null && doc) {
        const next = new Set(current)
        const from = Math.min(anchor.current, index)
        const to = Math.max(anchor.current, index)
        doc.elements.slice(from, to + 1).forEach((item) => {
          if (item.review?.status === 'approved' && item.intermediate_item_uid) next.add(item.intermediate_item_uid)
        })
        return next
      }
      anchor.current = index
      if (event.ctrlKey) {
        const next = new Set(current)
        if (next.has(itemUid)) next.delete(itemUid)
        else next.add(itemUid)
        return next
      }
      return new Set([itemUid])
    })
    if (!event.shiftKey) keyboardAnchor.current = itemUid
    setActiveItem(itemUid)
    setActivePane('item')
    previewRefs.current.get(itemUid)?.scrollIntoView({ block: 'nearest' })
  }

  const moveSelection = (side: 'item' | 'chunk', delta: -1 | 1, extend = false): void => {
    if (side === 'chunk') {
      if (chunks.length === 0) return
      const current = chunks.findIndex((chunk) => chunk.uid === selectedChunk)
      const next = chunks[Math.max(0, Math.min(chunks.length - 1, current + delta))] ?? chunks[0]
      if (next) void loadChunk(next.uid)
      return
    }
    if (!doc) return
    const next = moveKeyboardRangeSelection(
      doc.elements,
      activeItem,
      keyboardAnchor.current,
      delta,
      extend,
      (row) => row.intermediate_item_uid,
      (row) => row.review?.status === 'approved'
    )
    if (!next) return
    setActiveItem(next.activeId)
    setActivePane('item')
    setSelectedItems(next.selectedIds)
    keyboardAnchor.current = next.anchorId
    previewRefs.current.get(next.activeId)?.scrollIntoView({ block: 'nearest' })
  }

  const create = async (itemUids: ReadonlySet<string>): Promise<void> => {
    if (!doc) return
    const elementIds = doc.elements
      .filter((row) => row.intermediate_item_uid && itemUids.has(row.intermediate_item_uid))
      .map((row) => row.id)
    const result = await invoke<{ chunkUid: string }>('chunk.create', {
      intermediateDocumentUid: uid,
      elementIds,
      additionalPrompt: ''
    })
    if (!result.ok) return notify('error', 'チャンクを作成できません', result.error.message)
    await refresh()
    await loadChunk(result.result.chunkUid)
  }

  const save = async (additionalPrompt = prompt, itemUids: ReadonlySet<string> = selectedItems): Promise<void> => {
    if (!selectedChunk) return
    const result = await invoke('chunk.update', {
      uid: selectedChunk,
      intermediateItemUids: [...itemUids],
      additionalPrompt
    })
    if (!result.ok) return notify('error', 'チャンクを更新できません', result.error.message)
    setPrompt(additionalPrompt)
    setEditingPrompt(false)
    notify('info', 'チャンクを更新しました')
    await refresh()
    await loadChunk(selectedChunk)
  }

  const moveChunk = async (delta: number, chunkUid: string): Promise<void> => {
    const index = chunks.findIndex((chunk) => chunk.uid === chunkUid)
    const target = index + delta
    if (index < 0 || target < 0 || target >= chunks.length) return
    const ordered = chunks.map((chunk) => chunk.uid)
    ;[ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!]
    const result = await invoke('chunk.reorder', { intermediateDocumentUid: uid, chunkUids: ordered })
    if (!result.ok) return notify('error', 'チャンク順を変更できません', result.error.message)
    await refresh()
  }
  const remove = async (chunkUid: string): Promise<void> => {
    if (!(await confirmDialog({ message: '選択中のチャンクを削除しますか？', okLabel: '削除', danger: true }))) return
    const result = await invoke('chunk.delete', { uid: chunkUid })
    if (!result.ok) return notify('error', 'チャンクを削除できません', result.error.message)
    if (selectedChunk === chunkUid) {
      setSelectedChunk(null)
      setDetail(null)
      setPrompt('')
    }
    await refresh()
  }

  /**
   * 成果物行の右クリックメニュー（MID-004 UI改善、中間編集と同パターン）。
   * 未選択行の右クリックはその行の単独選択へ切り替え、複数選択中は選択全体へ適用する。
   */
  const openSourceRowMenu = (row: ElementRow, index: number, event: React.MouseEvent): void => {
    if (row.review?.status !== 'approved' || !row.intermediate_item_uid) return
    const itemUid = row.intermediate_item_uid
    const effective = selectedItems.has(itemUid) ? selectedItems : new Set([itemUid])
    if (!selectedItems.has(itemUid)) {
      setSelectedItems(effective)
      anchor.current = index
      keyboardAnchor.current = itemUid
      setActiveItem(itemUid)
      setActivePane('item')
    }
    showContextMenu(event, [
      {
        label: `選択${effective.size}件でチャンク作成`,
        testId: 'ctx-chunk-create',
        run: () => void create(effective)
      },
      {
        label: `選択${effective.size}件でチャンクを更新`,
        detail: selectedChunk ? undefined : '先にチャンク行を選択してください',
        testId: 'ctx-chunk-update',
        disabled: !selectedChunk,
        run: () => void save(prompt, effective)
      }
    ])
  }

  /** チャンク行の右クリックメニュー。右クリックした行を選択してから操作を適用する */
  const openChunkRowMenu = (chunk: ChunkRow, event: React.MouseEvent): void => {
    if (selectedChunk !== chunk.uid) void loadChunk(chunk.uid)
    const index = chunks.findIndex((item) => item.uid === chunk.uid)
    showContextMenu(event, [
      {
        label: '上へ移動',
        testId: 'ctx-chunk-move-up',
        disabled: index <= 0,
        run: () => void moveChunk(-1, chunk.uid)
      },
      {
        label: '下へ移動',
        testId: 'ctx-chunk-move-down',
        disabled: index < 0 || index >= chunks.length - 1,
        run: () => void moveChunk(1, chunk.uid)
      },
      { separator: true },
      {
        label: '追加プロンプトを編集…',
        testId: 'ctx-chunk-prompt-edit',
        run: () => {
          setPromptDraft(chunk.additional_prompt)
          setEditingPrompt(true)
        }
      },
      { separator: true },
      { label: 'チャンクを削除', testId: 'ctx-chunk-delete', run: () => void remove(chunk.uid) }
    ])
  }

  const openGenerateDialog = async (): Promise<void> => {
    if (!selectedChunk) return
    const result = await invoke<PreparedLlmRequest>('llm.prepareRequest', {
      operation: 'design-candidates',
      context: { chunkUid: selectedChunk }
    })
    if (result.ok) setLlmRequest(result.result)
    else notify('error', '候補生成の確認画面を開けません', result.error.message)
  }

  const generate = async (messages: LlmRequestMessage[], promptTemplateUid?: string): Promise<void> => {
    if (!selectedChunk) return
    setGenerating(true)
    const enq = await invoke<{ jobId: string }>('llm.runConfirmed', {
      operation: 'design-candidates',
      context: { chunkUid: selectedChunk },
      messages,
      promptTemplateUid
    })
    if (!enq.ok) {
      setGenerating(false)
      return notify('error', '候補生成を開始できません', enq.error.message)
    }
    for (let i = 0; i < 240; i++) {
      const got = await invoke<{ status: string; output: { llmRunUid: string }; error?: { message: string } }>(
        'job.get',
        { jobId: enq.result.jobId }
      )
      if (got.ok && got.result.status === 'success') {
        useEditorStore
          .getState()
          .openResource(`candidate://${got.result.output.llmRunUid}`, '④候補セット', { preview: false })
        setGenerating(false)
        return
      }
      if (got.ok && ['failed', 'aborted', 'partial'].includes(got.result.status)) {
        setGenerating(false)
        return notify('error', '候補生成に失敗しました', got.result.error?.message)
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    setGenerating(false)
    notify('error', '候補生成がタイムアウトしました')
  }

  const linked = new Set(detail?.items.map((item) => item.intermediate_item_uid) ?? [])
  const selectedChunksForItems = new Set(
    chunks
      .filter((chunk) => selectedItems.size > 0 && chunk.item_uids.some((id) => selectedItems.has(id)))
      .map((chunk) => chunk.uid)
  )

  if (!doc) return <div className="d2d-empty">読込中…</div>
  return (
    <div data-testid="chunk-editor" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: 8,
          borderBottom: '1px solid var(--d2d-border)',
          display: 'flex',
          gap: 8,
          alignItems: 'center'
        }}
      >
        <strong>{doc.title ?? doc.code} — チャンク編集</strong>
        <span className="intermediate-context-hint">成果物行・チャンク行の右クリックで作成・更新・移動・削除</span>
        <span style={{ flex: 1 }} />
        <button
          className="d2d-btn primary"
          onClick={() => void openGenerateDialog()}
          disabled={!selectedChunk || generating}
        >
          {generating ? '生成中…' : '④モデル候補生成'}
        </button>
      </div>

      {editingPrompt && (
        <div data-testid="chunk-prompt-editor" style={{ padding: 8, borderBottom: '1px solid var(--d2d-border)' }}>
          <label>
            追加プロンプト
            <textarea
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
              rows={5}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button className="d2d-btn primary" onClick={() => void save(promptDraft)}>
              保存
            </button>
            <button className="d2d-btn" onClick={() => setEditingPrompt(false)}>
              キャンセル
            </button>
          </div>
        </div>
      )}

      <ResizablePaneGroup initialSizes={[40, 27, 33]} testId="chunk-editor-layout" className="chunk-editor-layout">
        <section
          tabIndex={0}
          data-testid="chunk-source-pane"
          aria-label="成果物一覧。Shift+上下矢印で複数選択"
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              moveSelection('item', event.key === 'ArrowUp' ? -1 : 1, event.shiftKey)
            }
          }}
          style={{ overflow: 'auto' }}
        >
          <h3 style={{ padding: '0 8px' }}>成果物（確認済のみ選択可）</h3>
          <table className="d2d-table chunk-grid chunk-source-grid" style={{ width: '100%', minWidth: 680 }}>
            <thead>
              <tr>
                <th>状態</th>
                <th>ID</th>
                <th>種別</th>
                <th>内容</th>
                <th>小節</th>
              </tr>
            </thead>
            <tbody>
              {doc.elements.map((row, index) => {
                const itemUid = row.intermediate_item_uid
                const isLinked = Boolean(itemUid && linked.has(itemUid))
                const selected = activePane === 'item' && selectedItems.has(itemUid ?? '')
                const related = activePane === 'chunk' && isLinked
                return (
                  <tr
                    key={row.id}
                    data-testid={`chunk-source-${row.id}`}
                    aria-selected={selected}
                    tabIndex={row.review?.status === 'approved' ? 0 : -1}
                    onClick={(event) => chooseItem(row, index, event)}
                    onContextMenu={(event) => openSourceRowMenu(row, index, event)}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                      event.preventDefault()
                      event.stopPropagation()
                      moveSelection('item', event.key === 'ArrowUp' ? -1 : 1, event.shiftKey)
                    }}
                    className={selected ? 'chunk-row-selected' : related ? 'chunk-row-related' : undefined}
                    style={{ opacity: row.review?.status === 'approved' ? 1 : 0.45 }}
                  >
                    <td>
                      <ReviewStatusBadge status={reviewStateFromEntityStatus(row.review?.status ?? 'draft')} />
                    </td>
                    <td>{row.id}</td>
                    <td>
                      <span
                        className="d2d-badge"
                        style={{ borderColor: typeColors[row.type], color: typeColors[row.type] }}
                      >
                        {row.type}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          borderLeft: `${Math.max(1, row.level ?? 0)}px solid ${typeColors[row.type] ?? 'var(--d2d-border)'}`,
                          paddingLeft: 6,
                          background: `color-mix(in srgb, ${typeColors[row.type] ?? 'var(--d2d-border)'} ${Math.min(22, 6 + (row.level ?? 0) * 4)}%, transparent)`
                        }}
                      >
                        {'┆ '.repeat(row.level ?? 0)}
                        {row.text ?? row.image ?? ''}
                      </span>
                    </td>
                    <td>{row.section_path ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              moveSelection('chunk', event.key === 'ArrowUp' ? -1 : 1)
            }
          }}
          style={{ overflow: 'auto' }}
        >
          <h3 style={{ padding: '0 8px' }}>チャンク</h3>
          <table className="d2d-table chunk-grid" style={{ width: '100%', minWidth: 430 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>内容</th>
                <th>項目数</th>
                <th>Token</th>
                <th>追加プロンプト</th>
              </tr>
            </thead>
            <tbody>
              {chunks.map((chunk) => (
                <tr
                  key={chunk.uid}
                  data-testid={`chunk-row-${chunk.code}`}
                  aria-selected={activePane === 'chunk' && chunk.uid === selectedChunk}
                  onClick={() => void loadChunk(chunk.uid)}
                  onContextMenu={(event) => openChunkRowMenu(chunk, event)}
                  className={
                    activePane === 'chunk' && chunk.uid === selectedChunk
                      ? 'chunk-row-selected'
                      : activePane === 'item' && selectedChunksForItems.has(chunk.uid)
                        ? 'chunk-row-related'
                        : undefined
                  }
                >
                  <td>{chunk.code}</td>
                  <td>{chunk.title ?? chunk.code}</td>
                  <td>{chunk.item_count}</td>
                  <td>{chunk.token_count}</td>
                  <td title={chunk.additional_prompt}>{chunk.additional_prompt || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section style={{ overflow: 'auto', padding: 12 }}>
          <h3>中間文書プレビュー</h3>
          <DocumentPreviewMetaControls options={previewMeta} onChange={setPreviewMeta} />
          {doc.elements.map((row) => {
            const itemUid = row.intermediate_item_uid
            const selectedPreview = Boolean(itemUid && activePane === 'item' && selectedItems.has(itemUid))
            const relatedPreview = Boolean(itemUid && activePane === 'chunk' && linked.has(itemUid))
            const common = { marginLeft: (row.level ?? 0) * 12 }
            let body: React.JSX.Element
            if (row.type === 'figure') body = <FigurePreview resourceUid={row.resource_uid} alt={row.image} />
            else if (row.type === 'table' && row.rows)
              body = (
                <table className="d2d-table">
                  <tbody>
                    {row.rows.map((cells, rowNo) => (
                      <tr key={rowNo}>
                        {cells.map((cell, colNo) => (
                          <td key={colNo}>{cell.text}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            else if (row.type === 'heading') {
              const Heading = `h${Math.min(6, Math.max(1, row.level ?? 1))}` as keyof React.JSX.IntrinsicElements
              body = <Heading style={{ margin: 0 }}>{row.text ?? row.id}</Heading>
            } else body = <div style={{ whiteSpace: 'pre-wrap' }}>{row.text ?? row.image ?? row.id}</div>
            return (
              <article
                key={row.id}
                ref={(node) => {
                  if (itemUid && node) previewRefs.current.set(itemUid, node)
                }}
                className={
                  'extraction-preview-item' +
                  (selectedPreview ? ' selected active' : '') +
                  (relatedPreview ? ' related' : '')
                }
                style={common}
              >
                <header>
                  {previewMeta.parts && <small className="d2d-badge">{row.type}</small>}
                  {previewMeta.elementIds && <code>{row.id}</code>}
                  {previewMeta.sections && row.section_path && <span>{row.section_path}</span>}
                </header>
                {body}
              </article>
            )
          })}
        </section>
      </ResizablePaneGroup>
      {llmRequest && selectedChunk && (
        <LlmRequestDialog
          request={llmRequest}
          screenId="chunk.design-candidates"
          title="④設計モデル候補生成"
          onClose={() => setLlmRequest(null)}
          onConfirmed={generate}
        />
      )}
    </div>
  )
}
