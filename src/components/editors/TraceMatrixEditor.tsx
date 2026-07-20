/**
 * 汎用トレースマトリクスEditor（P9-4、TRACE-026〜029/040、UI-014）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { pushUndo } from '../../services/undo-service'

interface MatrixScope {
  id: string
  kind: 'design' | 'extracted' | 'intermediate' | 'chunk' | 'resource_type'
  label: string
  description: string
  count: number
}

interface MatrixResource {
  uid: string
  code: string
  title: string | null
  entityType: string
  modelType: string | null
  status: string
  itemType: string | null
  scopes: string[]
}

interface MatrixLink {
  uid: string
  relationType: string
  fromUid: string
  toUid: string
  direction: 'row_to_col' | 'col_to_row'
  reviewStatus: string | null
}

interface MatrixRelationDefinition {
  relationType: string
  label: string
  requiredAttr: string | null
  isEnabled: boolean
  iconColor: string
  iconText: string
}

interface MatrixData {
  rows: MatrixResource[]
  cols: MatrixResource[]
  cells: Record<string, Record<string, MatrixLink[]>>
  relationTypes: string[]
  relationDefinitions: MatrixRelationDefinition[]
}

const ATTRIBUTE_OPTIONS: Record<string, string[]> = {
  basis_kind: ['original', 'extracted', 'normalized', 'inferred', 'human_approved'],
  allocation_kind: ['structure', 'behavior', 'state', 'interface', 'data'],
  usage_kind: ['input', 'output', 'read', 'write', 'update', 'publish', 'subscribe'],
  conflict_status: ['suspected', 'confirmed', 'resolved', 'dismissed'],
  review_status: ['creating', 'draft', 'review', 'approved', 'rejected', 'provisional']
}

function traceReviewLabel(status: string | null): string {
  return status === 'creating' ? '作成中' : (status ?? '-')
}

function scopeSelection(event: React.ChangeEvent<HTMLSelectElement>): string[] {
  return [...event.currentTarget.selectedOptions].map((option) => option.value)
}

function cellKey(rowUid: string, colUid: string): string {
  return `${rowUid}\0${colUid}`
}

function resourceTooltip(resource: MatrixResource, scopes: MatrixScope[]): string {
  const labels = resource.scopes.map((id) => scopes.find((scope) => scope.id === id)?.label ?? id)
  return [
    `ID: ${resource.code}`,
    `名称: ${resource.title ?? '-'}`,
    `entity_type: ${resource.entityType}`,
    `model_type: ${resource.modelType ?? '-'}`,
    `item_type: ${resource.itemType ?? '-'}`,
    `状態: ${resource.status}`,
    `所属: ${labels.join(' / ')}`
  ].join('\n')
}

export function TraceMatrixEditor({
  initialRow,
  initialCol
}: {
  initialRow: string
  initialCol: string
}): React.JSX.Element {
  const [scopes, setScopes] = useState<MatrixScope[]>([])
  const [rowScopeIds, setRowScopeIds] = useState<string[]>([])
  const [colScopeIds, setColScopeIds] = useState<string[]>([])
  const [relationTypes, setRelationTypes] = useState<string[]>(['satisfies'])
  const [relationDefinitions, setRelationDefinitions] = useState<MatrixRelationDefinition[]>([])
  const [relationAttributes, setRelationAttributes] = useState<Record<string, string>>({})
  const [direction, setDirection] = useState<'row_to_col' | 'col_to_row'>('row_to_col')
  const [matrix, setMatrix] = useState<MatrixData | null>(null)
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set())
  const [activeCell, setActiveCell] = useState<{ rowUid: string; colUid: string } | null>(null)
  const [anchorCell, setAnchorCell] = useState<{ rowUid: string; colUid: string } | null>(null)
  const [zoom, setZoom] = useState(100)
  const [busy, setBusy] = useState(false)
  const notify = useJobsStore((state) => state.notify)

  useEffect(() => {
    void invoke<MatrixScope[]>('trace.matrixScopes').then((result) => {
      if (!result.ok) return
      setScopes(result.result)
      const initialRowId = `design:${initialRow}`
      const initialColId = `design:${initialCol}`
      setRowScopeIds((current) =>
        current.length > 0
          ? current
          : [result.result.some((scope) => scope.id === initialRowId) ? initialRowId : result.result[0]?.id].filter(
              (value): value is string => Boolean(value)
            )
      )
      setColScopeIds((current) =>
        current.length > 0
          ? current
          : [result.result.some((scope) => scope.id === initialColId) ? initialColId : result.result[1]?.id].filter(
              (value): value is string => Boolean(value)
            )
      )
    })
  }, [initialCol, initialRow])

  const load = useCallback(async (): Promise<void> => {
    if (rowScopeIds.length === 0 || colScopeIds.length === 0) {
      setMatrix(null)
      return
    }
    const result = await invoke<MatrixData>('trace.editableMatrix', {
      rowScopeIds,
      colScopeIds,
      relationTypes
    })
    if (result.ok) {
      setMatrix(result.result)
      setRelationDefinitions(result.result.relationDefinitions)
    } else {
      notify('error', 'トレースマトリクスを取得できません', result.error.message)
    }
  }, [colScopeIds, notify, relationTypes, rowScopeIds])

  useEffect(() => {
    void load()
    return onBackendEvent((event) => {
      if (
        event === 'relation.updated' ||
        event === 'ontology.updated' ||
        event === 'intermediate.updated' ||
        event === 'design_model.updated'
      ) {
        void load()
      }
    })
  }, [load])

  const selectedPairs = useMemo(() => {
    if (!matrix) return []
    const rowSet = new Set(matrix.rows.map((row) => row.uid))
    const colSet = new Set(matrix.cols.map((col) => col.uid))
    return [...selectedCells]
      .map((key) => {
        const [rowUid, colUid] = key.split('\0')
        return { rowUid: rowUid ?? '', colUid: colUid ?? '' }
      })
      .filter((pair) => rowSet.has(pair.rowUid) && colSet.has(pair.colUid))
  }, [matrix, selectedCells])

  const update = async (operation: 'add' | 'delete' | 'toggle', pairs = selectedPairs): Promise<void> => {
    if (pairs.length === 0 || relationTypes.length === 0 || busy) return
    setBusy(true)
    const result = await invoke<{ added: number; deleted: number; unchanged: number }>('trace.updateMatrix', {
      pairs,
      relationTypes,
      relationAttributes,
      direction,
      operation
    })
    setBusy(false)
    if (!result.ok) {
      notify('error', '関係を更新できません', result.error.message)
      return
    }
    notify(
      'info',
      `関係を更新しました（追加 ${result.result.added} / 削除 ${result.result.deleted} / 変更なし ${result.result.unchanged}）`
    )
    await load()
    // W7（NFR-012）: 正確に逆転できる操作だけ Undo へ登録する。
    // toggle は自己逆操作。add/delete は「変更なし」が混ざると逆操作が既存関係を壊すため対象外。
    const inverse: Record<'add' | 'delete' | 'toggle', 'add' | 'delete' | 'toggle'> = {
      add: 'delete',
      delete: 'add',
      toggle: 'toggle'
    }
    if (operation === 'toggle' || result.result.unchanged === 0) {
      const request = { pairs, relationTypes, relationAttributes, direction }
      const apply = async (op: 'add' | 'delete' | 'toggle'): Promise<void> => {
        const res = await invoke('trace.updateMatrix', { ...request, operation: op })
        if (!res.ok) throw new Error(res.error.message)
      }
      pushUndo({
        label: `マトリクス関係の${operation === 'add' ? '追加' : operation === 'delete' ? '削除' : '切替'}（${pairs.length}セル）`,
        undo: () => apply(inverse[operation]),
        redo: () => apply(operation)
      })
    }
  }

  const selectCell = (rowUid: string, colUid: string, event: React.MouseEvent<HTMLTableCellElement>): void => {
    const key = cellKey(rowUid, colUid)
    setActiveCell({ rowUid, colUid })
    if (event.shiftKey && anchorCell && matrix) {
      const rowStart = matrix.rows.findIndex((row) => row.uid === anchorCell.rowUid)
      const rowEnd = matrix.rows.findIndex((row) => row.uid === rowUid)
      const colStart = matrix.cols.findIndex((col) => col.uid === anchorCell.colUid)
      const colEnd = matrix.cols.findIndex((col) => col.uid === colUid)
      const next = new Set(event.ctrlKey || event.metaKey ? selectedCells : [])
      for (let r = Math.min(rowStart, rowEnd); r <= Math.max(rowStart, rowEnd); r += 1) {
        for (let c = Math.min(colStart, colEnd); c <= Math.max(colStart, colEnd); c += 1) {
          const row = matrix.rows[r]
          const col = matrix.cols[c]
          if (row && col) next.add(cellKey(row.uid, col.uid))
        }
      }
      setSelectedCells(next)
      return
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedCells((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      setAnchorCell({ rowUid, colUid })
      return
    }
    setSelectedCells(new Set([key]))
    setAnchorCell({ rowUid, colUid })
    void update('toggle', [{ rowUid, colUid }])
  }

  const selectRow = (rowUid: string, append: boolean): void => {
    if (!matrix) return
    const next = new Set(append ? selectedCells : [])
    matrix.cols.forEach((col) => next.add(cellKey(rowUid, col.uid)))
    setSelectedCells(next)
    setActiveCell({ rowUid, colUid: matrix.cols[0]?.uid ?? '' })
  }

  const selectCol = (colUid: string, append: boolean): void => {
    if (!matrix) return
    const next = new Set(append ? selectedCells : [])
    matrix.rows.forEach((row) => next.add(cellKey(row.uid, colUid)))
    setSelectedCells(next)
    setActiveCell({ rowUid: matrix.rows[0]?.uid ?? '', colUid })
  }

  const transpose = (): void => {
    setRowScopeIds(colScopeIds)
    setColScopeIds(rowScopeIds)
    setSelectedCells(new Set())
    setActiveCell(null)
    setAnchorCell(null)
  }

  const connectedRows = new Set<string>()
  const connectedCols = new Set<string>()
  if (matrix) {
    for (const row of matrix.rows) {
      for (const col of matrix.cols) {
        if ((matrix.cells[row.uid]?.[col.uid]?.length ?? 0) > 0) {
          connectedRows.add(row.uid)
          connectedCols.add(col.uid)
        }
      }
    }
  }

  return (
    <div className="trace-matrix-editor" data-testid="trace-matrix">
      <header className="trace-matrix-toolbar">
        <div className="trace-matrix-axis-config">
          <label>
            <b>行Resource集合（複数選択可）</b>
            <select
              multiple
              size={Math.min(6, Math.max(3, scopes.length))}
              value={rowScopeIds}
              onChange={(event) => {
                setRowScopeIds(scopeSelection(event))
                setSelectedCells(new Set())
              }}
              data-testid="trace-matrix-row-scopes"
            >
              {scopes.map((scope) => (
                <option key={scope.id} value={scope.id} title={scope.description}>
                  {scope.label}（{scope.count}）
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="d2d-btn"
            onClick={transpose}
            title="行と列の表示スコープを入れ替えます"
            data-testid="trace-matrix-transpose"
          >
            ⇄ 行／列入替
          </button>
          <label>
            <b>列Resource集合（複数選択可）</b>
            <select
              multiple
              size={Math.min(6, Math.max(3, scopes.length))}
              value={colScopeIds}
              onChange={(event) => {
                setColScopeIds(scopeSelection(event))
                setSelectedCells(new Set())
              }}
              data-testid="trace-matrix-col-scopes"
            >
              {scopes.map((scope) => (
                <option key={scope.id} value={scope.id} title={scope.description}>
                  {scope.label}（{scope.count}）
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="trace-matrix-edit-config">
          <fieldset>
            <legend>表示・編集する関係種別（複数選択可）</legend>
            <div className="trace-relation-options">
              {relationDefinitions.map((definition) => {
                const type = definition.relationType
                return (
                  <label key={type} style={{ '--relation-color': definition.iconColor } as React.CSSProperties}>
                    <input
                      aria-label={type}
                      data-testid={`trace-relation-${type}`}
                      type="checkbox"
                      checked={relationTypes.includes(type)}
                      onChange={(event) =>
                        setRelationTypes((current) =>
                          event.target.checked ? [...current, type] : current.filter((value) => value !== type)
                        )
                      }
                    />
                    <span>{definition.iconText}</span>
                    {type}
                    {definition.isEnabled ? '' : '（無効）'}
                    {definition.requiredAttr && relationTypes.includes(type) && (
                      <select
                        aria-label={`${type} 必須属性`}
                        data-testid={`trace-relation-attribute-${type}`}
                        value={relationAttributes[type] ?? ''}
                        onChange={(event) =>
                          setRelationAttributes((current) => ({ ...current, [type]: event.target.value }))
                        }
                      >
                        <option value="">仮設定（作成中）</option>
                        {(ATTRIBUTE_OPTIONS[definition.requiredAttr] ?? []).map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                )
              })}
            </div>
          </fieldset>
          <div className="trace-matrix-actions">
            <label>
              関係方向
              <select
                value={direction}
                onChange={(event) => setDirection(event.target.value as typeof direction)}
                data-testid="trace-matrix-direction"
              >
                <option value="row_to_col">行 → 列</option>
                <option value="col_to_row">列 → 行</option>
              </select>
            </label>
            <button
              type="button"
              className="d2d-btn primary"
              disabled={selectedPairs.length === 0 || relationTypes.length === 0 || busy}
              onClick={() => void update('add')}
              data-testid="trace-matrix-add"
            >
              選択へ追加
            </button>
            <button
              type="button"
              className="d2d-btn"
              disabled={selectedPairs.length === 0 || relationTypes.length === 0 || busy}
              onClick={() => void update('delete')}
              data-testid="trace-matrix-delete"
            >
              選択から削除
            </button>
            <span>{selectedPairs.length} セル選択</span>
            <label className="trace-matrix-zoom">
              表示倍率
              <input
                type="range"
                min={60}
                max={160}
                step={10}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                data-testid="trace-matrix-zoom"
              />
              {zoom}%
            </label>
          </div>
          <p>
            セルクリック: 設定トグル / Ctrl・Cmdクリック: 複数選択 / Shiftクリック: 矩形範囲 / 行・列見出し: 一括選択
          </p>
        </div>
      </header>

      <div className="trace-matrix-viewport" data-testid="trace-matrix-viewport">
        {!matrix || matrix.rows.length === 0 || matrix.cols.length === 0 ? (
          <div className="d2d-empty">行・列に表示するResource集合を選択してください</div>
        ) : (
          <table className="trace-matrix-table" style={{ fontSize: `${zoom}%` }}>
            <thead>
              <tr>
                <th className="trace-matrix-corner">行 \ 列</th>
                {matrix.cols.map((col) => (
                  <th
                    key={col.uid}
                    className={[
                      connectedCols.has(col.uid) ? 'connected' : '',
                      activeCell?.colUid === col.uid ? 'cross-active' : ''
                    ].join(' ')}
                    title={resourceTooltip(col, scopes)}
                    onClick={(event) => selectCol(col.uid, event.ctrlKey || event.metaKey)}
                    data-testid={`trace-col-${col.code}`}
                  >
                    <span>{col.code}</span>
                    <small>{col.title}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.uid}>
                  <th
                    className={[
                      connectedRows.has(row.uid) ? 'connected' : '',
                      activeCell?.rowUid === row.uid ? 'cross-active' : ''
                    ].join(' ')}
                    title={resourceTooltip(row, scopes)}
                    onClick={(event) => selectRow(row.uid, event.ctrlKey || event.metaKey)}
                    data-testid={`trace-row-${row.code}`}
                  >
                    <span>{row.code}</span>
                    <small>{row.title}</small>
                  </th>
                  {matrix.cols.map((col) => {
                    const links = matrix.cells[row.uid]?.[col.uid] ?? []
                    const selected = selectedCells.has(cellKey(row.uid, col.uid))
                    const cross = activeCell?.rowUid === row.uid || activeCell?.colUid === col.uid
                    return (
                      <td
                        key={col.uid}
                        className={[
                          selected ? 'selected' : '',
                          cross ? 'cross-active' : '',
                          links.length > 0 ? 'has-relation' : ''
                        ].join(' ')}
                        title={
                          links.length > 0
                            ? links
                                .map(
                                  (link) =>
                                    `${link.direction === 'row_to_col' ? '→' : '←'} ${link.relationType} [${traceReviewLabel(link.reviewStatus)}]`
                                )
                                .join('\n')
                            : '関係なし。クリックで設定をトグルします'
                        }
                        onClick={(event) => selectCell(row.uid, col.uid, event)}
                        data-testid={`trace-cell-${row.code}-${col.code}`}
                      >
                        <span className="trace-cell-relations">
                          {links.map((link) => (
                            <i
                              key={link.uid}
                              style={
                                {
                                  '--relation-color':
                                    relationDefinitions.find(
                                      (definition) => definition.relationType === link.relationType
                                    )?.iconColor ?? '#9099a8'
                                } as React.CSSProperties
                              }
                            >
                              {link.direction === 'row_to_col' ? '→' : '←'}
                              {relationDefinitions.find((definition) => definition.relationType === link.relationType)
                                ?.iconText ?? '?'}
                            </i>
                          ))}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
