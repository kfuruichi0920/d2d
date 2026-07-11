import { useEffect, useState } from 'react'
import { invoke } from '../../services/backend'

export function SearchEngineSettingsSection(): React.JSX.Element {
  const [mecabPath, setMecabPath] = useState('')
  const [dictionaryPath, setDictionaryPath] = useState('')
  const [userDictionaries, setUserDictionaries] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void invoke<Record<string, unknown>>('settings.getProjectSettings').then((result) => {
      if (!result.ok) return
      setMecabPath(String(result.result['search.mecabPath'] ?? ''))
      setDictionaryPath(String(result.result['search.dictionaryPath'] ?? ''))
      const paths = result.result['search.userDictionaryPaths']
      setUserDictionaries(Array.isArray(paths) ? paths.join('\n') : '')
    })
  }, [])

  const save = async (): Promise<void> => {
    setMessage('')
    const values: [string, unknown][] = [
      ['search.mecabPath', mecabPath.trim()],
      ['search.dictionaryPath', dictionaryPath.trim()],
      [
        'search.userDictionaryPaths',
        userDictionaries
          .split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean)
      ]
    ]
    for (const [key, value] of values) {
      const result = await invoke('settings.setProjectSetting', { key, value })
      if (!result.ok) {
        setMessage(result.error.message)
        return
      }
    }
    setMessage('検索エンジン設定を保存しました。')
  }

  const fieldStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '150px 1fr',
    gap: 8,
    margin: '7px 0',
    alignItems: 'start'
  }
  return (
    <section data-testid="search-engine-settings">
      <h2 style={{ fontSize: 14, marginTop: 20 }}>検索エンジン（MeCab / UniDic）</h2>
      <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 11.5 }}>
        MeCab検索の有効／無効はSearchサイドバーで検索ごとに選択します。既定は無効です。
      </p>
      <label style={fieldStyle}>
        <span>MeCab実行ファイル</span>
        <input
          value={mecabPath}
          onChange={(e) => setMecabPath(e.target.value)}
          placeholder="C:\\Program Files\\MeCab\\bin\\mecab.exe"
          data-testid="setting-mecab-path"
        />
      </label>
      <label style={fieldStyle}>
        <span>UniDicディレクトリ</span>
        <input
          value={dictionaryPath}
          onChange={(e) => setDictionaryPath(e.target.value)}
          placeholder="...\\dic\\unidic"
          data-testid="setting-unidic-path"
        />
      </label>
      <label style={fieldStyle}>
        <span>
          ユーザ辞書
          <br />
          <small>1行1ファイル</small>
        </span>
        <textarea
          rows={4}
          value={userDictionaries}
          onChange={(e) => setUserDictionaries(e.target.value)}
          data-testid="setting-user-dictionaries"
        />
      </label>
      <button type="button" className="d2d-btn primary" onClick={() => void save()} data-testid="setting-search-save">
        検索エンジン設定を保存
      </button>
      {message && <div style={{ marginTop: 6, fontSize: 11.5 }}>{message}</div>}
    </section>
  )
}
