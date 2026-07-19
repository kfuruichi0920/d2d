/**
 * Editor タブの Resource 種別アイコン（UI点検対応、UI-005/037）。
 * Explorer のファイル系アイコン体系（DocumentsTree）と同じ Serendie Symbols を使い、
 * URI スキームから種別を判定する。未知スキームは汎用ファイルアイコンへフォールバックする。
 */
import type { ComponentType } from 'react'
import {
  SerendieSymbolArticle,
  SerendieSymbolBookOpen,
  SerendieSymbolCube,
  SerendieSymbolData,
  SerendieSymbolFile,
  SerendieSymbolFileText,
  SerendieSymbolGear,
  SerendieSymbolHistory,
  SerendieSymbolHome,
  SerendieSymbolListBullet,
  SerendieSymbolListNumber,
  SerendieSymbolPackage,
  SerendieSymbolPieChart,
  SerendieSymbolQuestion,
  SerendieSymbolShuffle,
  SerendieSymbolStickyNote,
  SerendieSymbolTerminal
} from '@serendie/symbols'

type IconComponent = ComponentType<{ width?: number; height?: number; className?: string }>

/** URI スキーム → アイコン。Explorer の 原本=File / 抽出=Data / 中間=Article と揃える */
const SCHEME_ICONS: Record<string, IconComponent> = {
  original: SerendieSymbolFile,
  extracted: SerendieSymbolData,
  intermediate: SerendieSymbolArticle,
  chunk: SerendieSymbolListBullet,
  resource: SerendieSymbolFileText,
  stage: SerendieSymbolListNumber,
  design: SerendieSymbolCube,
  model: SerendieSymbolCube,
  candidate: SerendieSymbolStickyNote,
  glossary: SerendieSymbolBookOpen,
  trace: SerendieSymbolShuffle,
  report: SerendieSymbolPieChart,
  settings: SerendieSymbolGear,
  'project-settings': SerendieSymbolGear,
  project: SerendieSymbolHome,
  help: SerendieSymbolQuestion,
  store: SerendieSymbolPackage,
  log: SerendieSymbolTerminal,
  diff: SerendieSymbolHistory
}

export function TabIcon({ uri }: { uri: string }): React.JSX.Element {
  const scheme = uri.slice(0, Math.max(uri.indexOf('://'), 0))
  const Icon = SCHEME_ICONS[scheme] ?? SerendieSymbolFile
  return (
    <span className="tab-icon" aria-hidden="true">
      <Icon width={13} height={13} />
    </span>
  )
}
