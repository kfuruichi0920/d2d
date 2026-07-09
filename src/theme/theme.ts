/**
 * テーマ適用（P3-3、UI-001/027）。
 * 表示モード（light/dark/system）と Serendie カラーテーマを DOM 属性へ反映する。
 */

export const COLOR_THEMES = ['konjo', 'asagi', 'sumire', 'tsutsuji', 'kurikawa'] as const
export type ColorTheme = (typeof COLOR_THEMES)[number]

export const DISPLAY_MODES = ['light', 'dark', 'system'] as const
export type DisplayMode = (typeof DISPLAY_MODES)[number]

export interface ThemeState {
  displayMode: DisplayMode
  colorTheme: ColorTheme
}

export const DEFAULT_THEME: ThemeState = { displayMode: 'dark', colorTheme: 'konjo' }

function resolveMode(mode: DisplayMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** DOM へテーマ属性を適用する。Serendie は konjo のみダーク変種を持つ（konjo-dark） */
export function applyTheme(theme: ThemeState): void {
  const mode = resolveMode(theme.displayMode)
  const root = document.documentElement
  root.setAttribute('data-d2d-mode', mode)
  const pandaTheme = theme.colorTheme === 'konjo' && mode === 'dark' ? 'konjo-dark' : theme.colorTheme
  root.setAttribute('data-panda-theme', pandaTheme)
}

/** system モード時の OS 設定変化を追従する。解除関数を返す */
export function watchSystemTheme(getTheme: () => ThemeState): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = (): void => {
    const theme = getTheme()
    if (theme.displayMode === 'system') applyTheme(theme)
  }
  mq.addEventListener('change', listener)
  return () => mq.removeEventListener('change', listener)
}
