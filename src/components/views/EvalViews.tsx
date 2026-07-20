/**
 * 評価ハーネス UI（EVAL-001〜003）。Reports サイドバーの「評価」セクション。
 * サンプルデータ投入 → 設計モデル/DSL のマニュアルチューニング → 評価実行 → レポート確認の
 * 半自動ループを支援する。実行と結果出力は自動、チューニングは既存GUI（設計モデル設定）で行う。
 */
import { useState } from 'react'
import { invoke } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { confirmDialog } from '../common/ConfirmDialog'

interface SeedResult {
  documentCount: number
  chunkCount: number
  elementCount: number
  relationCount: number
}

interface ImpactEvalApiResult {
  fileName: string
  caseCount: number
  f1: number
  durationMs: number
}

export function EvalSection(): React.JSX.Element {
  const openResource = useEditorStore((s) => s.openResource)
  const notify = useJobsStore((s) => s.notify)
  const [busy, setBusy] = useState<'seed' | 'impact' | 'conversion' | null>(null)

  const seed = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: '評価用サンプルデータの投入',
      message:
        '現在のプロジェクトへ評価用サンプル「温度監視装置」（原本2文書・チャンク7件・正解設計モデル43件・関係約80件）を投入します。よろしいですか？'
    })
    if (!ok) return
    setBusy('seed')
    const result = await invoke<SeedResult>('eval.seedSample')
    setBusy(null)
    if (result.ok) {
      notify(
        'info',
        `サンプルデータを投入しました（文書${result.result.documentCount}・チャンク${result.result.chunkCount}・要素${result.result.elementCount}・関係${result.result.relationCount}）`
      )
    } else {
      notify('error', 'サンプルデータの投入に失敗しました', result.error.message)
    }
  }

  const runImpact = async (): Promise<void> => {
    setBusy('impact')
    const result = await invoke<ImpactEvalApiResult>('eval.runImpact')
    setBusy(null)
    if (result.ok) {
      notify(
        'info',
        `評価②が完了しました: F1=${result.result.f1.toFixed(3)}（${result.result.caseCount}ケース / ${result.result.durationMs}ms）`
      )
      openResource(`report://${result.result.fileName}`, '評価②レポート', { preview: false })
    } else {
      notify('error', '評価②の実行に失敗しました', result.error.message)
    }
  }

  const runConversion = async (): Promise<void> => {
    // LLM 送信を伴うため実行前に確認する（LLM-040 の送信前確認方針）
    const ok = await confirmDialog({
      title: '評価①の実行（LLM送信）',
      message:
        '設定済みのLLM Providerへサンプル7チャンクの候補生成を送信し、期待値と照合します。外部Providerの場合は外部送信許可（プロジェクト設定）が必要です。実行しますか？'
    })
    if (!ok) return
    setBusy('conversion')
    const enq = await invoke<{ jobId: string }>('eval.runConversion')
    if (!enq.ok) {
      setBusy(null)
      return notify('error', '評価①を開始できません', enq.error.message)
    }
    for (let i = 0; i < 720; i++) {
      const got = await invoke<{
        status: string
        output?: { fileName: string; f1: number }
        error?: { message: string }
      }>('job.get', { jobId: enq.result.jobId })
      if (got.ok && got.result.status === 'success' && got.result.output) {
        notify('info', `評価①が完了しました: F1=${got.result.output.f1.toFixed(3)}`)
        openResource(`report://${got.result.output.fileName}`, '評価①レポート', { preview: false })
        setBusy(null)
        return
      }
      if (got.ok && ['failed', 'aborted', 'partial'].includes(got.result.status)) {
        setBusy(null)
        return notify('error', '評価①の実行に失敗しました', got.result.error?.message)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    setBusy(null)
    notify('error', '評価①がタイムアウトしました（ジョブパネルで状態を確認してください）')
  }

  return (
    <div data-testid="eval-section">
      <hr style={{ border: 'none', borderTop: '1px solid var(--d2d-border)', margin: '10px 0' }} />
      <div style={{ fontWeight: 600, marginBottom: 2 }}>評価（サンプルプロジェクト）</div>
      <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 11, margin: '2px 0' }}>
        同梱サンプル「温度監視装置」で、①LLM変換精度と②影響分析精度を評価します。
        設計モデル・DSLのチューニングは設計モデル設定で行い、ここから実行と結果レポート出力を自動化します。
      </p>
      <button
        type="button"
        className="d2d-btn"
        style={{ width: '100%', marginTop: 4 }}
        disabled={busy !== null}
        onClick={() => void seed()}
        data-testid="eval-seed"
        title="評価用サンプル（原本docx・②③・チャンク・正解④モデルと関係・期待値）を現在のプロジェクトへ投入します"
      >
        {busy === 'seed' ? '投入中…' : 'サンプルデータを投入'}
      </button>
      <button
        type="button"
        className="d2d-btn"
        style={{ width: '100%', marginTop: 4 }}
        disabled={busy !== null}
        onClick={() => void runImpact()}
        data-testid="eval-run-impact"
        title="仕様変更3ケースの影響範囲分析を実行し、期待値との正答率と分析時間をレポート出力します（LLM不要）"
      >
        {busy === 'impact' ? '実行中…' : '評価②: 影響分析精度を実行'}
      </button>
      <button
        type="button"
        className="d2d-btn"
        style={{ width: '100%', marginTop: 4 }}
        disabled={busy !== null}
        onClick={() => void runConversion()}
        data-testid="eval-run-conversion"
        title="チャンク毎にLLMで④候補を生成し、期待値との正答率・入力トークン数をレポート出力します（LLM Provider設定が必要）"
      >
        {busy === 'conversion' ? '実行中…' : '評価①: LLM変換精度を実行'}
      </button>
    </div>
  )
}
