import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { progressJob } from '../jobs/job-manager'

// 開発時に .env の D2D_PYTHON を process.env に注入（一度だけ実行）
if (is.dev && !process.env.D2D_PYTHON) {
  const envPath = join(process.cwd(), '.env')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^\s*D2D_PYTHON\s*=\s*(.+)/)
      if (m) { process.env.D2D_PYTHON = m[1].trim(); break }
    }
  }
}

export interface WorkerRequest {
  job_id: string
  command: string
  parameters: Record<string, unknown>
  auth?: { api_key_ref?: string }
}

export interface WorkerResponse {
  job_id: string
  status: 'progress' | 'success' | 'error'
  data?: unknown
  message?: string
  error?: string
}

function getPythonWorkerPath(): string {
  if (is.dev) {
    // 開発時: workers/python/ ディレクトリの Python スクリプト
    return join(process.cwd(), 'workers', 'python', 'main.py')
  }
  // 本番時: extraResources にバンドルされた PyInstaller 実行ファイル
  const exePath = join(
    process.resourcesPath,
    'workers',
    'python',
    process.platform === 'win32' ? 'd2d-worker.exe' : 'd2d-worker'
  )
  return exePath
}

function getPythonBin(): string {
  if (is.dev) {
    // D2D_PYTHON 環境変数が設定されていればそれを優先（hermes venv 回避用）
    if (process.env.D2D_PYTHON) return process.env.D2D_PYTHON
    return process.platform === 'win32' ? 'python' : 'python3'
  }
  return ''
}

export function runPythonWorker(
  request: WorkerRequest,
  onProgress?: (msg: string) => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const workerPath = getPythonWorkerPath()

    let proc: ChildProcess

    // UTF-8 強制（Windows の CP932 デフォルト回避）
    const utf8Env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    }

    if (is.dev) {
      if (!existsSync(workerPath)) {
        reject(new Error(`Python worker script not found: ${workerPath}`))
        return
      }
      proc = spawn(getPythonBin(), [workerPath], { stdio: ['pipe', 'pipe', 'pipe'], env: utf8Env })
    } else {
      if (!existsSync(workerPath)) {
        reject(new Error(`Python worker executable not found: ${workerPath}`))
        return
      }
      proc = spawn(workerPath, [], { stdio: ['pipe', 'pipe', 'pipe'], env: utf8Env })
    }

    // リクエストを stdin に送信
    proc.stdin!.write(JSON.stringify(request) + '\n')
    proc.stdin!.end()

    let stdout = ''
    let stderr = ''

    proc.stdout!.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text

      // 行ごとに処理（JSONL）
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg: WorkerResponse = JSON.parse(line)
          if (msg.job_id !== request.job_id) continue

          if (msg.status === 'progress') {
            onProgress?.(msg.message ?? '')
            progressJob(request.job_id, msg.message ?? '')
          } else if (msg.status === 'success') {
            resolve(msg.data)
          } else if (msg.status === 'error') {
            reject(new Error(msg.error ?? 'Python worker error'))
          }
        } catch {
          // 非 JSON 行は無視
        }
      }
    })

    proc.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python worker exited with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to start Python worker: ${err.message}`))
    })
  })
}
