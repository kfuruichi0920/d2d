/**
 * 仮想スクロール対応データグリッド基盤（P3-4、UI-007、NFR-001）。
 * TanStack Table（ヘッドレス）+ TanStack Virtual。大量一覧の共通基盤として
 * P5（抽出要素一覧）・P8（候補セット）等から利用する。
 */
import { useRef } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useState } from 'react'

export interface VirtualDataGridProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  rowHeight?: number
  height?: number | string
  onRowClick?: (row: T, event: React.MouseEvent<HTMLTableRowElement>) => void
  onRowKeyDown?: (row: T, event: React.KeyboardEvent<HTMLTableRowElement>) => void
  selectedRowIds?: ReadonlySet<string>
  activeRowId?: string | null
  relatedRowIds?: ReadonlySet<string>
  isRowDisabled?: (row: T) => boolean
  getRowId?: (row: T, index: number) => string
  testId?: string
}

export function VirtualDataGrid<T>({
  columns,
  data,
  rowHeight = 26,
  height = '100%',
  onRowClick,
  onRowKeyDown,
  selectedRowIds,
  activeRowId,
  relatedRowIds,
  isRowDisabled,
  getRowId,
  testId
}: VirtualDataGridProps<T>): React.JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])
  const containerRef = useRef<HTMLDivElement>(null)

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId
  })

  const rows = table.getRowModel().rows
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 10
  })

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      style={{ height, overflow: 'auto', border: '1px solid var(--d2d-border)', borderRadius: 'var(--d2d-radius)' }}
    >
      <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead
          style={{
            position: 'sticky',
            top: 0,
            background: 'var(--d2d-surface-raised)',
            zIndex: 1
          }}
        >
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                  style={{
                    textAlign: 'left',
                    padding: '4px 8px',
                    borderBottom: '1px solid var(--d2d-border)',
                    cursor: header.column.getCanSort() ? 'pointer' : 'default',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() === 'asc' ? ' ▲' : header.column.getIsSorted() === 'desc' ? ' ▼' : ''}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody style={{ position: 'relative' }}>
          {virtualizer.getVirtualItems().length > 0 && (
            <tr style={{ height: virtualizer.getVirtualItems()[0]!.start }} aria-hidden />
          )}
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index]!
            return (
              <tr
                key={row.id}
                onClick={(event) => onRowClick?.(row.original, event)}
                onKeyDown={(event) => onRowKeyDown?.(row.original, event)}
                tabIndex={onRowKeyDown ? 0 : undefined}
                aria-selected={selectedRowIds?.has(row.id) ?? false}
                aria-disabled={isRowDisabled?.(row.original) ?? false}
                data-row-id={row.id}
                style={{
                  height: rowHeight,
                  cursor: isRowDisabled?.(row.original) ? 'not-allowed' : onRowClick ? 'pointer' : 'default',
                  opacity: isRowDisabled?.(row.original) ? 0.5 : 1,
                  background: selectedRowIds?.has(row.id)
                    ? row.id === activeRowId
                      ? 'var(--d2d-selection-bg)'
                      : 'color-mix(in srgb, var(--d2d-selection-bg) 65%, transparent)'
                    : undefined,
                  outline:
                    row.id === activeRowId
                      ? '1px solid var(--d2d-accent)'
                      : relatedRowIds?.has(row.id)
                        ? '1px dashed var(--d2d-warning)'
                        : undefined,
                  outlineOffset: -1
                }}
                className="d2d-grid-row"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    style={{
                      padding: '2px 8px',
                      borderBottom: '1px solid var(--d2d-border)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: 360
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            )
          })}
          <tr
            style={{
              height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0)
            }}
            aria-hidden
          />
        </tbody>
      </table>
      {rows.length === 0 && <div className="d2d-empty">データがありません</div>}
    </div>
  )
}
