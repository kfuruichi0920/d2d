/**
 * PDF抽出領域候補レビュー（P5-20B、EXT-028/029/032/033、UI-031/032）。
 * ページ画像上に抽出領域候補を半透明オーバーレイ表示し、追加・削除・移動・リサイズ・
 * 種別変更・読み順・採否（2値）・表データ確認/修正・領域単位の表再解析を行う。
 * 座標はPDFポイント（左上原点）を正とし、表示は image_scale × zoom で換算する。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { executeCommand } from '../../services/command-registry'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { showContextMenu } from '../common/ContextMenu'
import { ResizablePaneGroup } from '../workbench/ResizablePaneGroup'

type RegionType =
  | 'heading'
  | 'text'
  | 'list'
  | 'table'
  | 'figure'
  | 'caption'
  | 'formula'
  | 'header'
  | 'footer'
  | 'page_number'
  | 'decoration'
  | 'unknown'
type ReviewStatus = 'approved' | 'rejected'
type Bbox = [number, number, number, number]

interface PdfLine {
  text: string
  bbox: Bbox
  size: number
  bold: boolean
  italic: boolean
  color: string | null
}
interface PdfBlock {
  block_id: string
  bbox: Bbox
  text: string
  lines: PdfLine[]
}
interface PdfPage {
  page_index: number
  page_number: number
  width: number
  height: number
  rotation: number
  image_file?: string
  image_width?: number
  image_height?: number
  image_scale?: number
  blocks: PdfBlock[]
  images: Array<{ image_id: string; bbox: Bbox }>
  word_count: number
}
interface TableData {
  rows: string[][]
  row_count: number
  column_count: number
  header_row_count: number
  detection_method: string
}
interface Region {
  region_uid: string
  page_index: number
  bbox: Bbox
  region_type: RegionType
  title: string
  text_preview: string
  detection_methods: string[]
  confidence: number
  candidate_status: 'detected' | 'adjusted' | 'confirmed' | 'rejected'
  review_status: ReviewStatus
  reading_order: number
  block_ids: string[]
  level?: number
  caption_of?: string
  table_data?: TableData
}
interface Draft {
  source_document_uid: string
  status: 'generated' | 'editing' | 'confirmed' | 'failed'
  physical: {
    metadata: { file_name?: string; page_count?: number; has_text_layer?: boolean }
    document: { file_name: string; pages: PdfPage[] }
    review_hints: { warnings: string[] }
  }
  regions: Region[]
}

const TYPES: RegionType[] = [
  'heading',
  'text',
  'list',
  'table',
  'figure',
  'caption',
  'formula',
  'header',
  'footer',
  'page_number',
  'decoration',
  'unknown'
]
const EXCLUDED_TYPES = new Set<RegionType>(['header', 'footer', 'page_number', 'decoration'])
const TYPE_LABELS: Record<RegionType, string> = {
  heading: '見出し',
  text: '本文',
  list: 'リスト',
  table: '表',
  figure: '図',
  caption: 'キャプション',
  formula: '数式',
  header: 'ヘッダ',
  footer: 'フッタ',
  page_number: 'ページ番号',
  decoration: '装飾',
  unknown: '不明'
}
const ZOOMS = [0.35, 0.5, 0.75, 1, 1.5, 2]

export function PdfExtractionEditor({ sourceDocumentUid }: { sourceDocumentUid: string }): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [regions, setRegions] = useState<Region[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [zoom, setZoom] = useState(0.5)
  const [pageImages, setPageImages] = useState<Record<number, string>>({})
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set())
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const [selectRect, setSelectRect] = useState<Bbox | null>(null)
  const draggingSelect = useRef(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const notify = useJobsStore((state) => state.notify)
  const openResource = useEditorStore((state) => state.openResource)

  const load = useCallback(async (): Promise<void> => {
    const result = await invoke<Draft>('pdfDraft.get', { sourceDocumentUid })
    if (!result.ok) return notify('error', 'PDF候補を取得できませんでした', result.error.message)
    setDraft(result.result)
    setRegions(result.result.regions)
  }, [notify, sourceDocumentUid])
  useEffect(() => {
    void load()
    return onBackendEvent((event, payload) => {
      // 確定ジョブ完了時は生成された②抽出データを開く（P5-20C）
      if (event === 'extraction.completed') {
        const done = payload as { sourceDocumentUid?: string; extractedDocumentUid?: string }
        if (done.sourceDocumentUid === sourceDocumentUid && done.extractedDocumentUid) {
          openResource('extracted://' + done.extractedDocumentUid, '抽出: PDF')
        }
        void load()
        return
      }
      if (event !== 'pdfDraft.updated' && event !== 'job.updated') return
      const uid = (payload as { sourceDocumentUid?: string }).sourceDocumentUid
      if (!uid || uid === sourceDocumentUid) void load()
    })
  }, [load, openResource, sourceDocumentUid])

  const pages = useMemo(() => draft?.physical.document.pages ?? [], [draft])
  const page = pages.find((item) => item.page_index === pageIndex) ?? pages[0]
  useEffect(() => {
    const index = page?.page_index
    if (index === undefined || pageImages[index]) return
    void invoke<{ dataUrl: string }>('pdfDraft.getPageImage', { sourceDocumentUid, pageIndex: index }).then(
      (result) => {
        if (result.ok) setPageImages((current) => ({ ...current, [index]: result.result.dataUrl }))
      }
    )
  }, [page, pageImages, sourceDocumentUid])

  const pageRegions = useMemo(
    () =>
      regions
        .filter((item) => item.page_index === (page?.page_index ?? 0))
        .sort((a, b) => a.reading_order - b.reading_order),
    [regions, page]
  )
  const active = regions.find((item) => item.region_uid === activeUid) ?? null
  const counts = regions.reduce(
    (acc, item) => {
      if (item.review_status === 'rejected') acc.rejected++
      else acc.approved++
      return acc
    },
    { approved: 0, rejected: 0 }
  )
  // 表示倍率: PDFポイント → CSS px（ページ画像の解像度 × ズーム）
  const displayScale = (page?.image_scale ?? 2) * zoom
  const readOnly = draft?.status === 'confirmed'

  const patchRegion = (uid: string, patch: Partial<Region>): void => {
    if (readOnly) return
    setRegions((items) =>
      items.map((item) =>
        item.region_uid === uid
          ? { ...item, ...patch, candidate_status: patch.review_status === 'rejected' ? 'rejected' : 'adjusted' }
          : item
      )
    )
  }
  const patchSelectedStatus = (status: ReviewStatus, targetUids: Set<string> = selectedUids): void => {
    if (readOnly) return
    setRegions((items) =>
      items.map((item) =>
        targetUids.has(item.region_uid)
          ? { ...item, review_status: status, candidate_status: status === 'rejected' ? 'rejected' : 'adjusted' }
          : item
      )
    )
  }
  const save = async (): Promise<boolean> => {
    const result = await invoke('pdfDraft.saveRegions', { sourceDocumentUid, regions })
    if (!result.ok) {
      notify('error', 'PDF候補を保存できませんでした', result.error.message)
      return false
    }
    await load()
    return true
  }
  const addRegion = (): void => {
    if (readOnly || !selectRect || !page) return
    const next: Region = {
      region_uid: 'new-' + Date.now(),
      page_index: page.page_index,
      bbox: selectRect,
      region_type: 'text',
      title: '新しい抽出領域',
      text_preview: '',
      detection_methods: ['manual_overlay'],
      confidence: 1,
      candidate_status: 'adjusted',
      review_status: 'approved',
      reading_order: Math.max(0, ...regions.map((item) => item.reading_order)) + 1,
      block_ids: []
    }
    setRegions((items) => [...items, next])
    setActiveUid(next.region_uid)
    setSelectedUids(new Set([next.region_uid]))
    setSelectRect(null)
  }
  const removeSelected = (): void => {
    if (readOnly) return
    setRegions((items) => items.filter((item) => !selectedUids.has(item.region_uid)))
    setSelectedUids(new Set())
    setActiveUid(null)
  }
  const confirm = async (): Promise<void> => {
    if (!(await save())) return
    const result = await invoke<{ jobId: string }>('pdfDraft.confirm', { sourceDocumentUid })
    if (!result.ok) return notify('error', 'PDF抽出を確定できませんでした', result.error.message)
    notify('info', '採用領域から②抽出データの生成を開始しました')
    void executeCommand('job.openPanel')
  }
  const reanalyzeRegion = async (mode: 'table' | 'text'): Promise<void> => {
    if (!active || !(await save())) return
    const target = active.region_uid.startsWith('new-')
      ? regions.find((item) => item.region_uid === active.region_uid)
      : active
    const result = await invoke('pdfDraft.reanalyzeRegion', {
      sourceDocumentUid,
      regionUid: target?.region_uid ?? active.region_uid,
      mode
    })
    if (!result.ok) return notify('error', '領域の再解析を開始できませんでした', result.error.message)
    notify('info', mode === 'table' ? '表の再解析を開始しました' : 'テキストの再抽出を開始しました')
    void executeCommand('job.openPanel')
  }
  const chooseRegion = (region: Region, additive: boolean): void => {
    setActiveUid(region.region_uid)
    setSelectedUids((current) => {
      const next = additive ? new Set(current) : new Set<string>()
      if (next.has(region.region_uid) && additive) next.delete(region.region_uid)
      else next.add(region.region_uid)
      return next
    })
  }
  const pointFromPointer = (event: React.PointerEvent): [number, number] => {
    const node = canvasRef.current
    if (!node || !page) return [0, 0]
    const rect = node.getBoundingClientRect()
    return [
      Math.max(0, Math.min(page.width, (event.clientX - rect.left) / displayScale)),
      Math.max(0, Math.min(page.height, (event.clientY - rect.top) / displayScale))
    ]
  }
  const moveOrResize = (region: Region, mode: 'move' | 'resize', event: React.PointerEvent): void => {
    if (readOnly) return
    event.stopPropagation()
    const originX = event.clientX
    const originY = event.clientY
    const original = region.bbox
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent): void => {
      if (!page) return
      const dx = (next.clientX - originX) / displayScale
      const dy = (next.clientY - originY) / displayScale
      if (mode === 'move') {
        const width = original[2] - original[0]
        const height = original[3] - original[1]
        const x0 = Math.max(0, Math.min(original[0] + dx, page.width - width))
        const top = Math.max(0, Math.min(original[1] + dy, page.height - height))
        patchRegion(region.region_uid, {
          bbox: [round2(x0), round2(top), round2(x0 + width), round2(top + height)]
        })
      } else {
        patchRegion(region.region_uid, {
          bbox: [
            original[0],
            original[1],
            round2(Math.max(original[0] + 2, Math.min(original[2] + dx, page.width))),
            round2(Math.max(original[1] + 2, Math.min(original[3] + dy, page.height)))
          ]
        })
      }
    }
    const finish = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
  }

  if (!draft || !page) return <div className="d2d-empty">PDF抽出領域候補を読込中…</div>
  const imageUrl = pageImages[page.page_index]
  const canvasWidth = page.width * displayScale
  const canvasHeight = page.height * displayScale
  const cropPreview = (region: Region): React.CSSProperties => {
    // ページ画像から領域部分をCSSで切出す（確定前プレビュー用）
    const scale = page.image_scale ?? 2
    const widthPx = (region.bbox[2] - region.bbox[0]) * scale
    const fit = Math.min(1, 240 / Math.max(1, widthPx))
    return {
      width: Math.max(24, widthPx * fit),
      height: Math.max(24, (region.bbox[3] - region.bbox[1]) * scale * fit),
      backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
      backgroundSize: `${(page.image_width ?? page.width * scale) * fit}px auto`,
      backgroundPosition: `${-region.bbox[0] * scale * fit}px ${-region.bbox[1] * scale * fit}px`
    }
  }

  return (
    <div className="pdf-extraction-editor" data-testid="pdf-extraction-editor">
      <div className="extraction-review-toolbar">
        <h1>{draft.physical.document.file_name}</h1>
        <label className="excel-sheet-select">
          ページ
          <select
            value={page.page_index}
            onChange={(event) => {
              setPageIndex(Number(event.target.value))
              setSelectRect(null)
            }}
            data-testid="pdf-page-select"
          >
            {pages.map((item) => (
              <option key={item.page_index} value={item.page_index}>
                {item.page_number} / {pages.length}
              </option>
            ))}
          </select>
        </label>
        <label className="excel-sheet-select">
          倍率
          <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))} data-testid="pdf-zoom-select">
            {ZOOMS.map((value) => (
              <option key={value} value={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
          </select>
        </label>
        <span className="d2d-badge">候補 {regions.length}</span>
        <span className="d2d-badge">採用 {counts.approved}</span>
        <span className="d2d-badge">不採用 {counts.rejected}</span>
        <span style={{ flex: 1 }} />
        <button
          className="d2d-btn small"
          type="button"
          onClick={addRegion}
          disabled={readOnly || !selectRect}
          data-testid="pdf-region-add"
          title={selectRect ? undefined : 'ページ上をドラッグして範囲を指定してください'}
        >
          選択範囲を候補追加
        </button>
        <button
          className="d2d-btn small"
          type="button"
          disabled={readOnly || !selectedUids.size}
          onClick={removeSelected}
          data-testid="pdf-region-delete"
        >
          削除
        </button>
        <button
          className="d2d-btn small"
          type="button"
          disabled={readOnly}
          onClick={() => void save()}
          data-testid="pdf-region-save"
        >
          候補を保存
        </button>
        <button
          className="d2d-btn primary"
          type="button"
          disabled={
            readOnly ||
            !regions.some((region) => region.review_status === 'approved' && !EXCLUDED_TYPES.has(region.region_type))
          }
          onClick={() => void confirm()}
          data-testid="pdf-region-confirm"
        >
          抽出を実行して②を生成
        </button>
      </div>
      {draft.physical.review_hints.warnings.length > 0 && (
        <div className="excel-extraction-warnings" data-testid="pdf-extraction-warnings">
          {draft.physical.review_hints.warnings.map((warning) => (
            <span key={warning}>⚠ {warning}</span>
          ))}
        </div>
      )}
      <ResizablePaneGroup initialSizes={[1.5, 1]} testId="pdf-extraction-layout">
        <section className="pdf-page-pane">
          <div className="excel-selection-bar">
            ページ {page.page_number}（{Math.round(page.width)}×{Math.round(page.height)}pt / 単語 {page.word_count}）
            <span>
              {selectRect
                ? `選択範囲: ${Math.round(selectRect[0])}, ${Math.round(selectRect[1])} - ${Math.round(selectRect[2])}, ${Math.round(selectRect[3])}`
                : 'ドラッグで範囲選択、候補クリックで選択'}
            </span>
          </div>
          <div className="pdf-page-scroll" data-testid="pdf-page-scroll">
            <div
              ref={canvasRef}
              className="pdf-page-canvas"
              data-testid="pdf-page-canvas"
              style={{ width: canvasWidth, height: canvasHeight }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                const [x, y] = pointFromPointer(event)
                draggingSelect.current = true
                setSelectRect([x, y, x, y])
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                if (!draggingSelect.current) return
                const [x, y] = pointFromPointer(event)
                setSelectRect((current) => (current ? [current[0], current[1], x, y] : [x, y, x, y]))
              }}
              onPointerUp={(event) => {
                draggingSelect.current = false
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId)
                setSelectRect((current) => {
                  if (!current) return null
                  const normalized: Bbox = [
                    Math.min(current[0], current[2]),
                    Math.min(current[1], current[3]),
                    Math.max(current[0], current[2]),
                    Math.max(current[1], current[3])
                  ]
                  return normalized[2] - normalized[0] < 3 || normalized[3] - normalized[1] < 3 ? null : normalized
                })
              }}
              onPointerCancel={() => {
                draggingSelect.current = false
              }}
            >
              {imageUrl ? (
                <img className="pdf-page-image" src={imageUrl} alt={`ページ ${page.page_number}`} draggable={false} />
              ) : (
                <div className="d2d-empty">ページ画像を読込中…</div>
              )}
              {selectRect && (
                <div
                  className="excel-selection-overlay"
                  style={{
                    left: Math.min(selectRect[0], selectRect[2]) * displayScale,
                    top: Math.min(selectRect[1], selectRect[3]) * displayScale,
                    width: Math.abs(selectRect[2] - selectRect[0]) * displayScale,
                    height: Math.abs(selectRect[3] - selectRect[1]) * displayScale
                  }}
                />
              )}
              {pageRegions.map((region) => (
                <div
                  key={region.region_uid}
                  className={
                    'pdf-region-overlay type-' +
                    region.region_type +
                    (selectedUids.has(region.region_uid) ? ' active' : '') +
                    (region.review_status === 'rejected' ? ' rejected' : '')
                  }
                  style={{
                    left: region.bbox[0] * displayScale,
                    top: region.bbox[1] * displayScale,
                    width: (region.bbox[2] - region.bbox[0]) * displayScale,
                    height: (region.bbox[3] - region.bbox[1]) * displayScale
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    chooseRegion(region, event.ctrlKey || event.metaKey)
                  }}
                  data-testid={'pdf-overlay-' + region.region_uid}
                >
                  <button
                    type="button"
                    className="excel-overlay-move"
                    aria-label="領域を移動"
                    onPointerDown={(event) => moveOrResize(region, 'move', event)}
                  >
                    ⋮⋮ {TYPE_LABELS[region.region_type]} {region.reading_order} · {Math.round(region.confidence * 100)}%
                  </button>
                  <button
                    type="button"
                    className="excel-overlay-resize"
                    aria-label="領域サイズを変更"
                    onPointerDown={(event) => moveOrResize(region, 'resize', event)}
                  >
                    ◢
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="excel-candidate-pane">
          <ResizablePaneGroup initialSizes={[1, 1.2]} testId="pdf-region-detail-layout" axis="y" minPaneSize={100}>
            <div className="excel-candidate-list" data-testid="pdf-region-list">
              {pageRegions.map((region) => (
                <div
                  key={region.region_uid}
                  className={'excel-candidate-row' + (region.region_uid === activeUid ? ' active' : '')}
                  onContextMenu={(event) => {
                    if (!selectedUids.has(region.region_uid)) chooseRegion(region, false)
                    showContextMenu(event, [
                      {
                        label: '採用',
                        testId: 'pdf-bulk-approved',
                        run: () =>
                          patchSelectedStatus(
                            'approved',
                            selectedUids.has(region.region_uid) ? selectedUids : new Set([region.region_uid])
                          )
                      },
                      {
                        label: '不採用',
                        testId: 'pdf-bulk-rejected',
                        run: () =>
                          patchSelectedStatus(
                            'rejected',
                            selectedUids.has(region.region_uid) ? selectedUids : new Set([region.region_uid])
                          )
                      }
                    ])
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={region.title || region.region_type}
                    checked={selectedUids.has(region.region_uid)}
                    onChange={() => chooseRegion(region, true)}
                  />
                  <button type="button" onClick={(event) => chooseRegion(region, event.ctrlKey || event.metaKey)}>
                    <span className={'excel-type-tag type-' + region.region_type}>
                      {TYPE_LABELS[region.region_type]}
                    </span>
                    <strong>{region.title || region.text_preview.slice(0, 40) || '（無題）'}</strong>
                    <span>
                      順 {region.reading_order} · {region.review_status === 'rejected' ? '不採用' : '採用'} ·{' '}
                      {Math.round(region.confidence * 100)}% · {region.detection_methods.join(',') || '手動'}
                    </span>
                  </button>
                </div>
              ))}
              {pageRegions.length === 0 && <div className="d2d-empty">このページに候補はありません。</div>}
            </div>
            {active ? (
              <div className="excel-candidate-form" data-testid="pdf-region-form">
                <div className="pdf-region-form-grid">
                  <label>
                    種別
                    <select
                      value={active.region_type}
                      disabled={readOnly}
                      onChange={(event) =>
                        patchRegion(active.region_uid, { region_type: event.target.value as RegionType })
                      }
                      data-testid="pdf-region-type"
                    >
                      {TYPES.map((type) => (
                        <option key={type} value={type}>
                          {TYPE_LABELS[type]}
                          {EXCLUDED_TYPES.has(type) ? '（②へ変換しない）' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    採否
                    <select
                      value={active.review_status}
                      disabled={readOnly}
                      onChange={(event) =>
                        patchRegion(active.region_uid, { review_status: event.target.value as ReviewStatus })
                      }
                      data-testid="pdf-region-status"
                    >
                      <option value="approved">採用</option>
                      <option value="rejected">不採用</option>
                    </select>
                  </label>
                  <label>
                    読み順
                    <input
                      type="number"
                      min={1}
                      value={active.reading_order}
                      disabled={readOnly}
                      onChange={(event) =>
                        patchRegion(active.region_uid, { reading_order: Number(event.target.value) })
                      }
                      data-testid="pdf-region-order"
                    />
                  </label>
                  {active.region_type === 'heading' && (
                    <label>
                      見出しレベル
                      <input
                        type="number"
                        min={1}
                        max={6}
                        value={active.level ?? 1}
                        disabled={readOnly}
                        onChange={(event) => patchRegion(active.region_uid, { level: Number(event.target.value) })}
                      />
                    </label>
                  )}
                </div>
                <div className="pdf-region-bbox-inputs">
                  {(['x0', 'top', 'x1', 'bottom'] as const).map((label, index) => (
                    <label key={label}>
                      {label}
                      <input
                        type="number"
                        value={active.bbox[index]}
                        disabled={readOnly}
                        onChange={(event) => {
                          const bbox = [...active.bbox] as Bbox
                          bbox[index] = Number(event.target.value)
                          patchRegion(active.region_uid, { bbox })
                        }}
                        data-testid={'pdf-region-bbox-' + label}
                      />
                    </label>
                  ))}
                </div>
                <div className="excel-range-text">
                  <label>領域内の文字列</label>
                  <textarea
                    readOnly
                    data-testid="pdf-region-text-preview"
                    value={active.text_preview || '（文字列なし）'}
                  />
                </div>
                {(active.region_type === 'figure' || active.region_type === 'decoration') && (
                  <div className="excel-figure-preview">
                    <div className="pdf-figure-crop" style={cropPreview(active)} data-testid="pdf-figure-crop" />
                  </div>
                )}
                {active.region_type === 'table' && (
                  <div className="pdf-table-editor" data-testid="pdf-table-editor">
                    <div className="pdf-table-editor-head">
                      <strong>
                        表データ（{active.table_data?.row_count ?? 0}行×{active.table_data?.column_count ?? 0}列 /{' '}
                        {active.table_data?.detection_method ?? '未解析'}）
                      </strong>
                      <button
                        className="d2d-btn small"
                        type="button"
                        disabled={readOnly}
                        onClick={() => void reanalyzeRegion('table')}
                        data-testid="pdf-reanalyze-table"
                      >
                        領域から表を再解析
                      </button>
                    </div>
                    {active.table_data && active.table_data.rows.length <= 60 ? (
                      <div className="pdf-table-grid">
                        {active.table_data.rows.map((row, rowIndex) => (
                          <div className="pdf-table-row" key={rowIndex}>
                            {row.map((cell, columnIndex) => (
                              <input
                                key={columnIndex}
                                value={cell}
                                disabled={readOnly}
                                aria-label={`セル ${rowIndex + 1},${columnIndex + 1}`}
                                onChange={(event) => {
                                  const rows = active.table_data!.rows.map((entry) => [...entry])
                                  rows[rowIndex]![columnIndex] = event.target.value
                                  patchRegion(active.region_uid, {
                                    table_data: { ...active.table_data!, rows, detection_method: 'user' }
                                  })
                                }}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="d2d-empty">
                        {active.table_data
                          ? '行数が多いため一覧表示を省略します'
                          : '「領域から表を再解析」で取得できます'}
                      </span>
                    )}
                  </div>
                )}
                {active.region_type !== 'table' && active.region_type !== 'figure' && (
                  <button
                    className="d2d-btn small"
                    type="button"
                    disabled={readOnly}
                    onClick={() => void reanalyzeRegion('text')}
                    data-testid="pdf-reanalyze-text"
                  >
                    領域からテキストを再抽出
                  </button>
                )}
                {active.caption_of && (
                  <div>
                    キャプション対象:{' '}
                    {(() => {
                      const target = regions.find((item) => item.region_uid === active.caption_of)
                      return target ? `${TYPE_LABELS[target.region_type]}（読み順 ${target.reading_order}）` : '未解決'
                    })()}
                  </div>
                )}
                <div>検出根拠: {active.detection_methods.join(', ') || '手動'}</div>
              </div>
            ) : (
              <div className="d2d-empty">候補を選択してください。</div>
            )}
          </ResizablePaneGroup>
        </section>
      </ResizablePaneGroup>
    </div>
  )
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
