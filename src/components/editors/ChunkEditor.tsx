/**
 * 成果物単位のチャンク編集（P7-5/P8-3、MID-030〜034）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'

interface ElementRow {
  id: string
  type: string
  text?: string
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

export function ChunkEditor({ uid }: { uid: string }): React.JSX.Element {
  const [doc, setDoc] = useState<DocumentData | null>(null)
  const [chunks, setChunks] = useState<ChunkRow[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [activeItem, setActiveItem] = useState<string | null>(null)
  const [selectedChunk, setSelectedChunk] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChunkDetail | null>(null)
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const anchor = useRef<number | null>(null)
  const notify = useJobsStore((s) => s.notify)

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

  const loadChunk = async (chunkUid: string): Promise<void> => {
    setSelectedChunk(chunkUid)
    const result = await invoke<ChunkDetail>('chunk.get', { uid: chunkUid })
    if (result.ok) {
      setDetail(result.result)
      setSelectedItems(new Set(result.result.items.map((item) => item.intermediate_item_uid)))
      setPrompt(result.result.additional_prompt)
    }
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
    setActiveItem(itemUid)
  }

  const moveSelection = (side: 'item' | 'chunk', delta: number): void => {
    if (side === 'chunk') {
      if (chunks.length === 0) return
      const current = chunks.findIndex((c) => c.uid === selectedChunk)
      const next = chunks[Math.max(0, Math.min(chunks.length - 1, current + delta))] ?? chunks[0]
      if (next) void loadChunk(next.uid)
      return
    }
    if (!doc) return
    const eligible = doc.elements.filter((e) => e.review?.status === 'approved' && e.intermediate_item_uid)
    const current = eligible.findIndex((e) => e.intermediate_item_uid === activeItem)
    const next = eligible[Math.max(0, Math.min(eligible.length - 1, current + delta))] ?? eligible[0]
    if (next?.intermediate_item_uid) {
      setActiveItem(next.intermediate_item_uid)
      setSelectedItems(new Set([next.intermediate_item_uid]))
    }
  }

  const create = async (): Promise<void> => {
    if (!doc) return
    const elementIds = doc.elements
      .filter((e) => e.intermediate_item_uid && selectedItems.has(e.intermediate_item_uid))
      .map((e) => e.id)
    const result = await invoke<{ chunkUid: string }>('chunk.create', {
      intermediateDocumentUid: uid,
      elementIds,
      additionalPrompt: prompt
    })
    if (!result.ok) return notify('error', 'チャンクを作成できません', result.error.message)
    await refresh()
    await loadChunk(result.result.chunkUid)
  }

  const save = async (): Promise<void> => {
    if (!selectedChunk) return
    const result = await invoke('chunk.update', {
      uid: selectedChunk,
      intermediateItemUids: [...selectedItems],
      additionalPrompt: prompt
    })
    if (!result.ok) return notify('error', 'チャンクを更新できません', result.error.message)
    notify('info', 'チャンクを更新しました')
    await refresh()
    await loadChunk(selectedChunk)
  }

  const remove = async (): Promise<void> => {
    if (!selectedChunk || !window.confirm('選択中のチャンクを削除しますか？')) return
    const result = await invoke('chunk.delete', { uid: selectedChunk })
    if (!result.ok) return notify('error', 'チャンクを削除できません', result.error.message)
    setSelectedChunk(null)
    setDetail(null)
    setPrompt('')
    await refresh()
  }

  const generate = async (): Promise<void> => {
    if (!selectedChunk) return
    setGenerating(true)
    const enq = await invoke<{ jobId: string }>('design.generateCandidates', { chunkUid: selectedChunk })
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

  const linked = new Set(detail?.items.map((i) => i.intermediate_item_uid) ?? [])
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
        <span style={{ flex: 1 }} />
        <button className="d2d-btn" onClick={() => void create()} disabled={selectedItems.size === 0}>
          チャンク作成
        </button>
        <button className="d2d-btn" onClick={() => void save()} disabled={!selectedChunk || selectedItems.size === 0}>
          選択行で更新
        </button>
        <button className="d2d-btn" onClick={() => void remove()} disabled={!selectedChunk}>
          削除
        </button>
        <button className="d2d-btn primary" onClick={() => void generate()} disabled={!selectedChunk || generating}>
          {generating ? '生成中…' : '④モデル候補生成'}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '34% 26% 40%' }}>
        <section
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              moveSelection('item', e.key === 'ArrowUp' ? -1 : 1)
            }
          }}
          style={{ overflow: 'auto', borderRight: '1px solid var(--d2d-border)' }}
        >
          <h3 style={{ padding: '0 8px' }}>成果物（確認済のみ選択可）</h3>
          {doc.elements.map((row, index) => {
            const itemUid = row.intermediate_item_uid
            const isLinked = Boolean(itemUid && linked.has(itemUid))
            return (
              <div
                key={row.id}
                className="d2d-list-row"
                data-testid={`chunk-source-${row.id}`}
                onClick={(e) => chooseItem(row, index, e)}
                style={{
                  opacity: row.review?.status === 'approved' ? 1 : 0.45,
                  background: selectedItems.has(itemUid ?? '')
                    ? 'var(--d2d-selection)'
                    : isLinked
                      ? 'color-mix(in srgb, var(--d2d-accent) 18%, transparent)'
                      : undefined
                }}
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={selectedItems.has(itemUid ?? '')}
                  disabled={row.review?.status !== 'approved'}
                />
                <span>{row.type}</span>
                <span style={{ flex: 1 }}>{row.text ?? row.id}</span>
              </div>
            )
          })}
        </section>
        <section
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              moveSelection('chunk', e.key === 'ArrowUp' ? -1 : 1)
            }
          }}
          style={{ overflow: 'auto', borderRight: '1px solid var(--d2d-border)' }}
        >
          <h3 style={{ padding: '0 8px' }}>チャンク</h3>
          {chunks.map((chunk) => (
            <div
              key={chunk.uid}
              className="d2d-list-row"
              onClick={() => void loadChunk(chunk.uid)}
              style={{
                background:
                  chunk.uid === selectedChunk
                    ? 'var(--d2d-selection)'
                    : selectedChunksForItems.has(chunk.uid)
                      ? 'color-mix(in srgb, var(--d2d-accent) 18%, transparent)'
                      : undefined
              }}
            >
              <span style={{ flex: 1 }}>{chunk.title ?? chunk.code}</span>
              <small>{chunk.item_count}項目</small>
            </div>
          ))}
          <label style={{ display: 'block', padding: 8 }}>
            追加プロンプト
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </label>
        </section>
        <section style={{ overflow: 'auto', padding: 12 }}>
          <h3>中間文書プレビュー</h3>
          {doc.elements.map((row) => {
            const itemUid = row.intermediate_item_uid
            const highlighted = Boolean(itemUid && (linked.has(itemUid) || selectedItems.has(itemUid)))
            return (
              <article
                key={row.id}
                style={{
                  padding: 8,
                  marginBottom: 4,
                  borderLeft: highlighted ? '4px solid var(--d2d-accent)' : '4px solid transparent',
                  background: highlighted ? 'color-mix(in srgb, var(--d2d-accent) 12%, transparent)' : undefined
                }}
              >
                <small>{row.type}</small>
                <div>{row.text ?? row.id}</div>
              </article>
            )
          })}
        </section>
      </div>
    </div>
  )
}
