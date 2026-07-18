/**
 * Glossary Editor（P10-6、V-14、EDIT-050〜056）。
 * 用語一覧・登録・同義語・承認、揺れ検出、③本文からの候補抽出→登録。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import { pushUndo } from '../../services/undo-service'
import { confirmDialog } from '../common/ConfirmDialog'

interface GlossaryTerm {
  uid: string
  code: string
  status: string
  term_text: string
  definition: string | null
  abbreviation: string | null
  is_prohibited: number
  synonyms: { uid: string; synonym_text: string; synonym_kind: string }[]
}

interface VariantGroup {
  normalized: string
  variants: { uid: string; text: string; source: string }[]
}

export function GlossaryEditor(): React.JSX.Element {
  const [terms, setTerms] = useState<GlossaryTerm[]>([])
  const [variants, setVariants] = useState<VariantGroup[]>([])
  const [candidates, setCandidates] = useState<string[]>([])
  const [newTerm, setNewTerm] = useState('')
  const [newDefinition, setNewDefinition] = useState('')
  const notify = useJobsStore((s) => s.notify)

  const refresh = useCallback(async () => {
    const [termsRes, variantsRes] = await Promise.all([
      invoke<GlossaryTerm[]>('glossary.list'),
      invoke<VariantGroup[]>('glossary.detectVariants')
    ])
    if (termsRes.ok) setTerms(termsRes.result)
    if (variantsRes.ok) setVariants(variantsRes.result)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const addTerm = async (term: string, definition?: string): Promise<void> => {
    const res = await invoke('glossary.addTerm', { term, definition })
    if (res.ok) {
      notify('info', `用語候補を登録しました: ${term}`)
      setNewTerm('')
      setNewDefinition('')
      setCandidates((prev) => prev.filter((c) => c !== term))
      await refresh()
    } else {
      notify('error', '用語を登録できませんでした', res.error.message)
    }
  }

  const setStatus = async (uid: string, status: string): Promise<void> => {
    // 破壊的操作の確認（NFR-013）
    if (
      status === 'deleted' &&
      !(await confirmDialog({ message: 'この用語を削除しますか？', okLabel: '削除', danger: true }))
    )
      return
    const entry = terms.find((term) => term.uid === uid)
    const previousStatus = entry?.status
    const res = await invoke('glossary.setStatus', { uid, status })
    if (res.ok) {
      await refresh()
      // W4（NFR-012）: 状態変更・削除を Ctrl+Z で戻せるようにする。
      if (previousStatus && previousStatus !== status) {
        pushUndo({
          label: `用語「${entry?.term_text ?? uid}」の状態変更（${previousStatus} → ${status}）`,
          undo: async () => {
            const undone = await invoke('glossary.setStatus', { uid, status: previousStatus })
            if (!undone.ok) throw new Error(undone.error.message)
          },
          redo: async () => {
            const redone = await invoke('glossary.setStatus', { uid, status })
            if (!redone.ok) throw new Error(redone.error.message)
          }
        })
      }
    }
  }

  const addSynonym = async (uid: string): Promise<void> => {
    const input = document.getElementById(`syn-${uid}`) as HTMLInputElement | null
    if (!input?.value) return
    const res = await invoke('glossary.addSynonym', { glossaryUid: uid, synonymText: input.value })
    if (res.ok) {
      input.value = ''
      await refresh()
    } else {
      notify('error', '同義語を登録できませんでした', res.error.message)
    }
  }

  /** ③中間データ本文からの用語候補抽出（EDIT-051/055） */
  const extractFromIntermediate = async (): Promise<void> => {
    const docs = await invoke<{ uid: string }[]>('intermediate.list')
    if (!docs.ok || docs.result.length === 0) {
      notify('warning', '③中間データがありません')
      return
    }
    const md = await invoke<{ markdown: string }>('intermediate.getMarkdown', {
      uid: docs.result[0]!.uid,
      variant: 'clean'
    })
    if (!md.ok) return
    const res = await invoke<{ candidates: string[] }>('glossary.extractCandidates', { text: md.result.markdown })
    if (res.ok) {
      setCandidates(res.result.candidates)
      notify('info', `用語候補を ${res.result.candidates.length} 件抽出しました`)
    }
  }

  const rowStyle: React.CSSProperties = { borderBottom: '1px solid var(--d2d-border)', padding: '4px 0' }

  return (
    <div style={{ padding: 16, overflow: 'auto', height: '100%' }} data-testid="glossary-editor">
      <h1 style={{ fontSize: 15, marginTop: 0 }}>用語集（{terms.length}）</h1>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          placeholder="用語"
          title="登録する用語を入力します（例: トレーサビリティ）。登録直後は承認待ちの候補になります"
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          data-testid="glossary-term-input"
        />
        <input
          placeholder="定義"
          title="用語の定義文を入力します（例: 要求と設計・試験の対応関係を追跡できる性質）"
          style={{ flex: 1 }}
          value={newDefinition}
          onChange={(e) => setNewDefinition(e.target.value)}
          data-testid="glossary-def-input"
        />
        <button
          type="button"
          className="d2d-btn primary small"
          disabled={!newTerm.trim()}
          onClick={() => void addTerm(newTerm.trim(), newDefinition.trim() || undefined)}
          data-testid="glossary-add"
        >
          登録
        </button>
        <button
          type="button"
          className="d2d-btn small"
          onClick={() => void extractFromIntermediate()}
          data-testid="glossary-extract"
        >
          ③から候補抽出
        </button>
      </div>

      {candidates.length > 0 && (
        <div style={{ marginBottom: 10, display: 'flex', gap: 4, flexWrap: 'wrap' }} data-testid="glossary-candidates">
          {candidates.slice(0, 30).map((candidate) => (
            <button key={candidate} type="button" className="d2d-btn small" onClick={() => void addTerm(candidate)}>
              + {candidate}
            </button>
          ))}
        </div>
      )}

      {variants.length > 0 && (
        <div style={{ marginBottom: 10 }} data-testid="glossary-variants">
          <div style={{ color: 'var(--d2d-warning)', fontWeight: 700 }}>表記揺れの疑い（EDIT-052）</div>
          {variants.map((group) => (
            <div key={group.normalized} style={{ color: 'var(--d2d-warning)', fontSize: 12 }}>
              ⚠ {group.variants.map((v) => v.text).join(' / ')}
            </div>
          ))}
        </div>
      )}

      {terms.map((term) => (
        <div key={term.uid} style={rowStyle} data-testid={`glossary-term-${term.code}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ReviewStatusBadge status={reviewStateFromEntityStatus(term.status)} />
            <strong>{term.term_text}</strong>
            {term.is_prohibited === 1 && <span className="d2d-badge status-failed">禁止語</span>}
            <span style={{ color: 'var(--d2d-fg-muted)', flex: 1 }}>{term.definition}</span>
            {term.status !== 'approved' && (
              <button
                type="button"
                className="d2d-btn small"
                onClick={() => void setStatus(term.uid, 'approved')}
                data-testid={`approve-${term.code}`}
              >
                承認
              </button>
            )}
            <button type="button" className="d2d-btn small" onClick={() => void setStatus(term.uid, 'deleted')}>
              削除
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 24, fontSize: 12 }}>
            <span style={{ color: 'var(--d2d-fg-muted)' }}>
              同義語: {term.synonyms.map((s) => s.synonym_text).join(', ') || 'なし'}
            </span>
            <input
              id={`syn-${term.uid}`}
              placeholder="同義語を追加"
              title={`「${term.term_text}」の同義語・略語を入力します（例: 追跡性）`}
              style={{ width: 140 }}
            />
            <button type="button" className="d2d-btn small" onClick={() => void addSynonym(term.uid)}>
              +
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
