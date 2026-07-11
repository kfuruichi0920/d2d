/**
 * 表グリッド編集（P10-2、EDIT-022〜025、TBD-04）。
 * セルは resource_table_cell 別テーブルで ID 付きで管理する（schema 1.1.0）。
 * ③中間データ上の表編集は、P7 と同じ意味論（新リソース + based_on 由来追跡）で行う。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { eventBus } from '../events/event-bus'
import { registerEntity } from '../store/entity-registry'
import { newUid } from '../store/uid'
import type { IntermediateStructure } from '../intermediate/intermediate-service'

export interface TableCell {
  uid: string
  row_no: number
  col_no: number
  cell_text: string
  colspan: number
  is_header: number
}

/** セル一覧を返す。cell 行が無い旧データは cells_json から生成して返す（uid は空） */
export function getTableCells(
  db: Database,
  tableUid: string
): { rows: TableCell[][]; rowCount: number; colCount: number } {
  const table = db
    .prepare(`SELECT row_count, column_count, cells_json FROM resource_table WHERE uid = ?`)
    .get(tableUid) as { row_count: number; column_count: number; cells_json: string | null } | undefined
  if (!table) {
    throw new BackendError('not_found', `表リソースが見つかりません: ${tableUid}`, '')
  }
  const cellRows = db
    .prepare(
      `SELECT uid, row_no, col_no, cell_text, colspan, is_header FROM resource_table_cell WHERE table_uid = ? ORDER BY row_no, col_no`
    )
    .all(tableUid) as TableCell[]

  const grid: TableCell[][] = []
  if (cellRows.length > 0) {
    for (const cell of cellRows) {
      ;(grid[cell.row_no] ??= []).push(cell)
    }
  } else if (table.cells_json) {
    const json = JSON.parse(table.cells_json) as { text: string; colspan?: number }[][]
    json.forEach((row, rowNo) => {
      grid[rowNo] = row.map((cell, colNo) => ({
        uid: '',
        row_no: rowNo,
        col_no: colNo,
        cell_text: cell.text,
        colspan: cell.colspan ?? 1,
        is_header: rowNo === 0 ? 1 : 0
      }))
    })
  }
  return { rows: grid, rowCount: table.row_count, colCount: table.column_count }
}

/**
 * ③中間データの表要素を編集する。
 * 新 resource_table + resource_table_cell（セル ID 付与）を作成し、
 * based_on + transform_note=edit-table で元表を追跡する（EDIT-024、MID-005）。
 */
export function editIntermediateTable(
  db: Database,
  projectUid: string,
  docUid: string,
  elementId: string,
  cells: string[][]
): { newResourceUid: string; cellCount: number } {
  if (cells.length === 0 || cells[0]!.length === 0) {
    throw new BackendError('validation', '表のセルが空です', '')
  }
  const txn = db.transaction(() => {
    const docRow = db.prepare(`SELECT structure_json FROM intermediate_document WHERE uid = ?`).get(docUid) as
      { structure_json: string } | undefined
    if (!docRow) {
      throw new BackendError('not_found', `中間文書が見つかりません: ${docUid}`, '')
    }
    const structure = JSON.parse(docRow.structure_json) as IntermediateStructure
    const element = structure.elements.find((e) => e.id === elementId)
    if (!element || element.type !== 'table' || !element.resource_uid) {
      throw new BackendError('validation', `表要素ではありません: ${elementId}`, '')
    }
    const oldResourceUid = element.resource_uid

    // 新表リソース（正規化された二次元配列として保存。結合セル編集は後続対応）
    const created = registerEntity(db, {
      projectUid,
      entityType: 'resource_table',
      title: cells[0]!.join(' | ').slice(0, 80),
      createdBy: 'user'
    })
    const rowCount = cells.length
    const colCount = Math.max(...cells.map((r) => r.length))
    const cellsJson = cells.map((row) => row.map((text) => ({ text })))
    db.prepare(`INSERT INTO resource_table (uid, row_count, column_count, cells_json) VALUES (?, ?, ?, ?)`).run(
      created.uid,
      rowCount,
      colCount,
      JSON.stringify(cellsJson)
    )

    // セル ID 付与（resource_table_cell。EDIT-024）
    const insertCell = db.prepare(
      `INSERT INTO resource_table_cell (uid, table_uid, row_no, col_no, cell_text, is_header) VALUES (?, ?, ?, ?, ?, ?)`
    )
    let cellCount = 0
    cells.forEach((row, rowNo) => {
      row.forEach((text, colNo) => {
        insertCell.run(newUid(), created.uid, rowNo, colNo, text, rowNo === 0 ? 1 : 0)
        cellCount++
      })
    })

    // 由来リンク（新→旧）
    const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: 'human' })
    db.prepare(
      `INSERT INTO trace_link (uid, from_uid, to_uid, relation_type, basis_kind, transform_note, created_by, review_status)
       VALUES (?, ?, ?, 'based_on', 'human_approved', 'edit-table', 'human', 'approved')`
    ).run(link.uid, created.uid, oldResourceUid)

    // intermediate_item 差し替え + structure 更新
    const itemRows = db
      .prepare(`SELECT uid FROM intermediate_item WHERE intermediate_document_uid = ? AND resource_uid = ?`)
      .all(docUid, oldResourceUid) as { uid: string }[]
    for (const item of itemRows) {
      db.prepare(`DELETE FROM entity_registry WHERE uid = ?`).run(item.uid)
    }
    const newItem = registerEntity(db, { projectUid, entityType: 'intermediate_item', createdBy: 'user' })
    db.prepare(
      `INSERT INTO intermediate_item (uid, intermediate_document_uid, item_type, resource_uid) VALUES (?, ?, 'resource_table', ?)`
    ).run(newItem.uid, docUid, created.uid)

    element.resource_uid = created.uid
    element.rows = cellsJson
    element.row_count = rowCount
    element.column_count = colCount
    db.prepare(`UPDATE intermediate_document SET structure_json = ? WHERE uid = ?`).run(
      JSON.stringify(structure),
      docUid
    )

    return { newResourceUid: created.uid, cellCount }
  })
  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'table-edited' })
  return result
}
