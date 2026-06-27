import { generateUid } from '../utils/uuid'
import { getDatabase } from '../db/database'
import { getCurrentProjectRoot } from '../project/project-manager'
import { getEventBus } from '../events/event-bus'
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { JobRecord, JobStatus, BatchType } from '../../../src/types/d2d-api'

export type { JobRecord, JobStatus, BatchType }

export interface StartJobOptions {
  batchType: BatchType
  settingsJson?: string
  executedBy?: string
}

function projectUid(): string {
  const db = getDatabase()
  const row = db.prepare('SELECT uid FROM project LIMIT 1').get() as { uid: string } | undefined
  if (!row) throw new Error('No project in database')
  return row.uid
}

function logDir(): string {
  const root = getCurrentProjectRoot()
  if (!root) throw new Error('No project is open')
  return join(root, 'logs', 'jobs')
}

function appendLog(jobUid: string, line: string): void {
  const dir = logDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString()
  appendFileSync(join(dir, `${jobUid}.log`), `[${ts}] ${line}\n`, 'utf-8')
}

export function createJob(opts: StartJobOptions): JobRecord {
  const db = getDatabase()
  const uid = generateUid()
  const pUid = projectUid()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO batch_operation_info
     (uid, project_uid, batch_type, status, settings_json, executed_by, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?)`
  ).run(uid, pUid, opts.batchType, opts.settingsJson ?? null, opts.executedBy ?? null, now)

  const job = db.prepare('SELECT * FROM batch_operation_info WHERE uid = ?').get(uid) as JobRecord
  appendLog(uid, `Job created: ${opts.batchType}`)
  getEventBus().emitAndForward('job.queued', { jobUid: uid, batchType: opts.batchType })
  return job
}

export function startJob(jobUid: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(
    `UPDATE batch_operation_info SET status = 'running', started_at = ? WHERE uid = ?`
  ).run(now, jobUid)
  appendLog(jobUid, 'Job started')
  getEventBus().emitAndForward('job.started', { jobUid })
}

export function progressJob(jobUid: string, message: string): void {
  appendLog(jobUid, message)
  getEventBus().emitAndForward('job.progress', { jobUid, message })
}

export function completeJob(jobUid: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(
    `UPDATE batch_operation_info SET status = 'success', completed_at = ? WHERE uid = ?`
  ).run(now, jobUid)
  appendLog(jobUid, 'Job completed successfully')
  getEventBus().emitAndForward('job.completed', { jobUid })
}

export function failJob(jobUid: string, reason: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(
    `UPDATE batch_operation_info SET status = 'failed', completed_at = ? WHERE uid = ?`
  ).run(now, jobUid)
  appendLog(jobUid, `Job failed: ${reason}`)
  getEventBus().emitAndForward('job.failed', { jobUid, reason })
}

export function cancelJob(jobUid: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  const job = db.prepare('SELECT status FROM batch_operation_info WHERE uid = ?').get(jobUid) as
    | { status: JobStatus }
    | undefined
  if (!job) throw new Error(`Job not found: ${jobUid}`)
  if (job.status !== 'pending' && job.status !== 'running') {
    throw new Error(`Cannot cancel job in status: ${job.status}`)
  }
  db.prepare(
    `UPDATE batch_operation_info SET status = 'cancelled', completed_at = ? WHERE uid = ?`
  ).run(now, jobUid)
  appendLog(jobUid, 'Job cancelled')
  getEventBus().emitAndForward('job.cancelled', { jobUid })
}

export function listJobs(limit = 50): JobRecord[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM batch_operation_info ORDER BY created_at DESC LIMIT ?')
    .all(limit) as JobRecord[]
}

export function getJobLog(jobUid: string): string {
  const logPath = join(logDir(), `${jobUid}.log`)
  if (!existsSync(logPath)) return ''
  return readFileSync(logPath, 'utf-8')
}
