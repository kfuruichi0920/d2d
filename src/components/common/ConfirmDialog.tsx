/**
 * アプリ内確認ダイアログ共通基盤（W8、NFR-013）。
 * Electron の window.confirm はネイティブダイアログとなり E2E（Playwright）から制御できず、
 * テーマも適用されないため、破壊的操作の確認は必ずこの confirmDialog() を使う。
 * 表示は Workbench 直下の ConfirmDialogHost が一元管理する。
 */
import { useEffect, useRef, useState } from 'react'
import { useEscapeToClose } from './useEscapeToClose'

export interface ConfirmDialogOptions {
  /** 確認本文。改行は \n で指定する */
  message: string
  title?: string
  okLabel?: string
  cancelLabel?: string
  /** 破壊的操作（OKボタンを danger 表示にする） */
  danger?: boolean
}

interface ConfirmRequest {
  options: ConfirmDialogOptions
  resolve: (accepted: boolean) => void
}

const SHOW_CONFIRM_DIALOG = 'd2d:show-confirm-dialog'

/** OK で true、キャンセル・Escape・領域外クリックで false を返す */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<ConfirmRequest>(SHOW_CONFIRM_DIALOG, { detail: { options, resolve } }))
  })
}

export function ConfirmDialogHost(): React.JSX.Element | null {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onShow = (e: Event): void => {
      const next = (e as CustomEvent<ConfirmRequest>).detail
      setRequest((current) => {
        // 多重要求は前の確認をキャンセル扱いにして最新だけ表示する。
        current?.resolve(false)
        return next
      })
    }
    window.addEventListener(SHOW_CONFIRM_DIALOG, onShow)
    return () => window.removeEventListener(SHOW_CONFIRM_DIALOG, onShow)
  }, [])

  useEffect(() => {
    if (request) setTimeout(() => okRef.current?.focus(), 0)
  }, [request])

  // モーダル共通の Escape クローズ（W10）。入れ子モーダルでは最前面だけ閉じる。
  useEscapeToClose(request !== null, () => {
    request?.resolve(false)
    setRequest(null)
  })

  if (!request) return null

  const close = (accepted: boolean): void => {
    request.resolve(accepted)
    setRequest(null)
  }

  return (
    <div className="wb-confirm-overlay" data-testid="confirm-dialog" onClick={() => close(false)}>
      <div
        className="wb-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={request.options.title ?? '確認'}
        onClick={(e) => e.stopPropagation()}
      >
        {request.options.title && <h2>{request.options.title}</h2>}
        <p data-testid="confirm-message" style={{ whiteSpace: 'pre-line' }}>
          {request.options.message}
        </p>
        <div className="wb-confirm-actions">
          <button type="button" className="d2d-btn" data-testid="confirm-cancel" onClick={() => close(false)}>
            {request.options.cancelLabel ?? 'キャンセル'}
          </button>
          <button
            ref={okRef}
            type="button"
            className={`d2d-btn ${request.options.danger ? 'danger' : 'primary'}`}
            data-testid="confirm-ok"
            onClick={() => close(true)}
          >
            {request.options.okLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
