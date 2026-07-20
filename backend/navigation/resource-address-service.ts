/**
 * Resource URIのUID一覧（P3-7、UI-057）。
 * アドレスバーでschemeだけを指定した場合に、実際に開けるリンクを返す。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'

export type ResourceAddressScheme =
  'original' | 'extracted' | 'intermediate' | 'chunk' | 'candidate' | 'design' | 'resource'

export interface ResourceAddressEntry {
  uid: string
  code: string
  title: string | null
  entityType: string
  uri: string
}

const SCHEMES: readonly ResourceAddressScheme[] = [
  'original',
  'extracted',
  'intermediate',
  'chunk',
  'candidate',
  'design',
  'resource'
]

export function listResourceAddresses(db: Database, projectUid: string, scheme: string): ResourceAddressEntry[] {
  if (!SCHEMES.includes(scheme as ResourceAddressScheme)) {
    throw new BackendError('validation', '一覧表示できないResource URIです', scheme)
  }
  if (scheme === 'chunk') {
    const rows = db
      .prepare(
        `SELECT d.uid, e.code, e.title, e.entity_type AS entityType
           FROM intermediate_document d
           JOIN entity_registry e ON e.uid=d.uid AND e.project_uid=? AND e.status <> 'deleted'
          WHERE EXISTS (
            SELECT 1 FROM chunk c JOIN entity_registry ce ON ce.uid=c.uid AND ce.status <> 'deleted'
             WHERE c.intermediate_document_uid=d.uid
          )
          ORDER BY e.code`
      )
      .all(projectUid) as Omit<ResourceAddressEntry, 'uri'>[]
    return rows.map((row) => ({ ...row, uri: `chunk://${row.uid}` }))
  }

  const condition =
    scheme === 'original'
      ? `e.entity_type='source_document'`
      : scheme === 'extracted'
        ? `e.entity_type='extracted_document'`
        : scheme === 'intermediate'
          ? `e.entity_type='intermediate_document'`
          : scheme === 'candidate'
            ? `e.entity_type='llm_run_ref' AND EXISTS (
                 SELECT 1 FROM llm_run_ref r WHERE r.uid=e.uid AND r.process_name='design-candidates'
               )`
            : scheme === 'design'
              ? 'e.design_category IS NOT NULL'
              : `e.entity_type LIKE 'resource_%'`
  const rows = db
    .prepare(
      `SELECT e.uid, e.code, e.title, e.entity_type AS entityType
         FROM entity_registry e
        WHERE e.project_uid=? AND e.status <> 'deleted' AND ${condition}
        ORDER BY e.code`
    )
    .all(projectUid) as Omit<ResourceAddressEntry, 'uri'>[]
  return rows.map((row) => ({ ...row, uri: `${scheme}://${row.uid}` }))
}
