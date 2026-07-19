/** 空タブEditor（P3-1、UI-057）。 */
export function EmptyEditor(): React.JSX.Element {
  return (
    <div className="d2d-empty-editor" data-testid="empty-editor">
      <h1>新しいタブ</h1>
      <p>上部のアドレスバーへResource URIを入力してください。</p>
      <p>
        <code>help</code> と入力してEnterを押すと、指定可能な書式を確認できます。
      </p>
    </div>
  )
}
