/**
 * テーマ適用（P3-3、UI-001/027）。
 * 表示モード（light/dark/system）と Serendie カラーテーマを DOM 属性へ反映する。
 */

export const COLOR_THEMES = ['konjo', 'asagi', 'sumire', 'tsutsuji', 'kurikawa'] as const
export type ColorTheme = (typeof COLOR_THEMES)[number]

export const DISPLAY_MODES = ['light', 'dark', 'system'] as const
export type DisplayMode = (typeof DISPLAY_MODES)[number]

export const WORKBENCH_COLOR_DEFINITIONS = [
  { key: 'workbenchBackground', label: 'Workbench背景', cssVariable: '--d2d-bg' },
  { key: 'surfaceBackground', label: 'パネル・サーフェス', cssVariable: '--d2d-surface' },
  { key: 'foreground', label: '文字', cssVariable: '--d2d-fg' },
  { key: 'mutedForeground', label: '補助文字', cssVariable: '--d2d-fg-muted' },
  { key: 'border', label: '境界線', cssVariable: '--d2d-border' },
  { key: 'accent', label: 'アクセント', cssVariable: '--d2d-accent' },
  { key: 'selectionBackground', label: '選択背景', cssVariable: '--d2d-selection-bg' },
  { key: 'buttonBackground', label: 'ボタン背景', cssVariable: '--d2d-button-bg' },
  { key: 'buttonForeground', label: 'ボタン文字', cssVariable: '--d2d-button-fg' },
  { key: 'buttonBorder', label: 'ボタン境界', cssVariable: '--d2d-button-border' }
] as const

export type WorkbenchColorKey = (typeof WORKBENCH_COLOR_DEFINITIONS)[number]['key']
export type WorkbenchColors = Partial<Record<WorkbenchColorKey, string>>

/** 設定済みのWorkbench色だけをCSSカスタムプロパティへ変換する。 */
export function getWorkbenchColorVariables(colors: WorkbenchColors): Record<string, string> {
  return Object.fromEntries(
    WORKBENCH_COLOR_DEFINITIONS.flatMap((definition) => {
      const value = colors[definition.key]
      return value ? [[definition.cssVariable, value]] : []
    })
  )
}

export interface ThemeState {
  displayMode: DisplayMode
  colorTheme: ColorTheme
  /** ツール全体の基準文字サイズ（UI-037） */
  fontSize: number
  /** UI-049: Workbench共通パーツのユーザ上書き色。未指定はテーマトークンを使う。 */
  customColors: WorkbenchColors
}

export const DEFAULT_THEME: ThemeState = {
  displayMode: 'dark',
  colorTheme: 'konjo',
  fontSize: 13,
  customColors: {}
}

function resolveMode(mode: DisplayMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** DOM へテーマ属性を適用する。Serendie は konjo のみダーク変種を持つ（konjo-dark） */
export function applyTheme(theme: ThemeState): void {
  const mode = resolveMode(theme.displayMode)
  const root = document.documentElement
  root.setAttribute('data-d2d-mode', mode)
  root.style.setProperty('--d2d-font-size', Math.max(10, Math.min(20, theme.fontSize)) + 'px')
  const pandaTheme = theme.colorTheme === 'konjo' && mode === 'dark' ? 'konjo-dark' : theme.colorTheme
  root.setAttribute('data-panda-theme', pandaTheme)
  const variables = getWorkbenchColorVariables(theme.customColors)
  for (const definition of WORKBENCH_COLOR_DEFINITIONS) {
    const value = variables[definition.cssVariable]
    if (value) root.style.setProperty(definition.cssVariable, value)
    else root.style.removeProperty(definition.cssVariable)
  }
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
