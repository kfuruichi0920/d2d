// T707: LLM 候補管理 — 生成・レビュー（採用/修正/棄却）・履歴保存

import { getDatabase } from '../db/database'
import { generateUid } from '../utils/uuid'

export type CandidateType = 'term' | 'trace_link' | 'summary' | 'classification' | 'custom'
export type ReviewStatus = 'pending' | 'accepted' | 'modified' | 'rejected'

export interface CandidateRow {
  uid: string
  llm_run_ref_uid: string | null
  target_uid: string | null
  candidate_type: CandidateType
  content_json: string
  review_status: ReviewStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export function createCandidate(opts: {
  llmRunRefUid?: string
  targetUid?: string
  candidateType: CandidateType
  contentJson: string
}): string {
  const uid = generateUid()
  getDatabase().prepare(`
    INSERT INTO llm_candidate (uid, llm_run_ref_uid, target_uid, candidate_type, content_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(uid, opts.llmRunRefUid ?? null, opts.targetUid ?? null, opts.candidateType, opts.contentJson)
  return uid
}

export function listCandidates(opts: {
  status?: ReviewStatus
  candidateType?: CandidateType
  limit?: number
}): CandidateRow[] {
  const conditions: string[] = []
  const params: unknown[] = []
  if (opts.status) { conditions.push('review_status=?'); params.push(opts.status) }
  if (opts.candidateType) { conditions.push('candidate_type=?'); params.push(opts.candidateType) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(opts.limit ?? 100)
  return getDatabase().prepare(`SELECT * FROM llm_candidate ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as CandidateRow[]
}

export function getCandidate(uid: string): CandidateRow | null {
  return (getDatabase().prepare('SELECT * FROM llm_candidate WHERE uid=?').get(uid) as CandidateRow | undefined) ?? null
}

export function reviewCandidate(uid: string, status: ReviewStatus, modifiedJson?: string): void {
  const db = getDatabase()
  if (modifiedJson) {
    db.prepare(`
      UPDATE llm_candidate
      SET review_status=?, content_json=?, reviewed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE uid=?
    `).run(status, modifiedJson, uid)
  } else {
    db.prepare(`
      UPDATE llm_candidate
      SET review_status=?, reviewed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE uid=?
    `).run(status, uid)
  }
}

export function deleteCandidate(uid: string): void {
  getDatabase().prepare('DELETE FROM llm_candidate WHERE uid=?').run(uid)
}

export function getCandidateStats(): { pending: number; accepted: number; rejected: number; modified: number } {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT review_status, COUNT(*) as cnt
    FROM llm_candidate
    GROUP BY review_status
  `).all() as Array<{ review_status: string; cnt: number }>
  const stats = { pending: 0, accepted: 0, rejected: 0, modified: 0 }
  for (const r of rows) {
    if (r.review_status in stats) stats[r.review_status as keyof typeof stats] = r.cnt
  }
  return stats
}
