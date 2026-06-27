import { getDatabase } from '../db/database'
import { getCurrentProjectRoot } from '../project/project-manager'
import { createEntityEntry } from '../store/entity-registry'
import { withTransaction } from '../store/store-access'
import { runPythonWorker } from '../workers/python-worker'
import { createJob, startJob, completeJob, failJob } from '../jobs/job-manager'
import { join } from 'path'

export interface ExtractionResult {
  extractedDocumentUid: string
  itemCount: number
}

type FileType = 'word' | 'excel' | 'powerpoint' | 'visio' | 'pdf' | 'text' | 'markdown' | 'csv' | 'tsv' | 'json' | 'jsonl' | 'yaml' | 'unknown'

function commandForFileType(fileType: FileType): string {
  const map: Record<string, string> = {
    word: 'extract_word',
    excel: 'extract_excel',
    powerpoint: 'extract_powerpoint',
    visio: 'extract_visio',
    pdf: 'extract_pdf',
    text: 'extract_text',
    markdown: 'extract_text',
    csv: 'extract_text',
    tsv: 'extract_text',
    json: 'extract_text',
    jsonl: 'extract_text',
    yaml: 'extract_text'
  }
  return map[fileType] ?? 'extract_text'
}

function nextExtractCode(_projectRoot: string): string {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM entity_registry WHERE entity_type = 'extracted_document'`)
    .get() as { cnt: number }
  return `EXT-${String(row.cnt + 1).padStart(4, '0')}`
}

export async function extractDocument(sourceDocumentUid: string): Promise<ExtractionResult> {
  const db = getDatabase()
  const projectRoot = getCurrentProjectRoot()
  if (!projectRoot) throw new Error('No project is open')

  // source_document + blob を取得
  const srcRow = db
    .prepare(
      `SELECT sd.uid, sd.file_name, sd.file_type, sd.blob_uid,
              br.relative_path
       FROM source_document sd
       JOIN blob_resource br ON br.uid = sd.blob_uid
       WHERE sd.uid = ?`
    )
    .get(sourceDocumentUid) as
    | { uid: string; file_name: string; file_type: string; blob_uid: string; relative_path: string }
    | undefined

  if (!srcRow) throw new Error(`source_document not found: ${sourceDocumentUid}`)

  const blobAbsPath = join(projectRoot, srcRow.relative_path)
  const code = nextExtractCode(projectRoot)

  // ジョブ作成
  const job = createJob({
    batchType: 'extract',
    settingsJson: JSON.stringify({ sourceDocumentUid }),
    executedBy: 'system'
  })

  // entity_registry + extracted_document をまず pending で登録
  const extDocUid = withTransaction((db) => {
    const uid = createEntityEntry({
      entityType: 'extracted_document',
      code,
      title: `抽出: ${srcRow.file_name}`,
      batchOperationUid: job.uid
    })

    db.prepare(
      `INSERT INTO extracted_document
       (uid, source_document_uid, extraction_status, extractor_name, extractor_version)
       VALUES (?, ?, 'pending', 'python-worker', '1.0')`
    ).run(uid, sourceDocumentUid)

    return uid
  })

  // 非同期で Python Worker を実行
  setImmediate(async () => {
    try {
      startJob(job.uid)
      db.prepare(`UPDATE extracted_document SET extraction_status = 'running' WHERE uid = ?`).run(
        extDocUid
      )

      const result = (await runPythonWorker(
        {
          job_id: job.uid,
          command: commandForFileType(srcRow.file_type as FileType),
          parameters: {
            blob_path: blobAbsPath,
            source_document_uid: sourceDocumentUid,
            extracted_document_uid: extDocUid,
            project_root: projectRoot
          }
        },
        (msg) => console.log(`[extract] ${msg}`)
      )) as { items: unknown[]; structure_json: string }

      // 結果を DB へ書き込む
      withTransaction((db) => {
        const now = new Date().toISOString()
        db.prepare(
          `UPDATE extracted_document
           SET extraction_status = 'success', structure_json = ?, extracted_at = ?
           WHERE uid = ?`
        ).run(JSON.stringify(result.structure_json ?? null), now, extDocUid)

        let itemIdx = 0
        for (const item of result.items ?? []) {
          const itemData = item as Record<string, unknown>
          const itemCode = `${code}-ITEM-${String(++itemIdx).padStart(4, '0')}`
          const itemUid = createEntityEntry({
            entityType: 'extracted_item',
            code: itemCode,
            title: String(itemData['title'] ?? itemCode),
            batchOperationUid: job.uid
          })
          db.prepare(
            `INSERT INTO extracted_item
             (uid, extracted_document_uid, source_document_uid, item_type)
             VALUES (?, ?, ?, ?)`
          ).run(itemUid, extDocUid, sourceDocumentUid, String(itemData['item_type'] ?? 'text'))
        }
      })

      completeJob(job.uid)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      db.prepare(`UPDATE extracted_document SET extraction_status = 'failed' WHERE uid = ?`).run(
        extDocUid
      )
      failJob(job.uid, msg)
    }
  })

  return { extractedDocumentUid: extDocUid, itemCount: 0 }
}

export function getExtractionStatus(
  extractedDocumentUid: string
): { status: string; itemCount: number } | undefined {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT extraction_status FROM extracted_document WHERE uid = ?`)
    .get(extractedDocumentUid) as { extraction_status: string } | undefined
  if (!row) return undefined

  const cnt = db
    .prepare(`SELECT COUNT(*) as cnt FROM extracted_item WHERE extracted_document_uid = ?`)
    .get(extractedDocumentUid) as { cnt: number }

  return { status: row.extraction_status, itemCount: cnt.cnt }
}
