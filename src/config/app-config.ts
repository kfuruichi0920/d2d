/**
 * アプリ表示設定（P3-1、UI-059）。
 * d2d.config.json はビルド時に読み込み、Title Bar等の製品情報へ一貫して利用する。
 */
import config from '../../d2d.config.json'

export const APP_VERSION = config.appVersion
