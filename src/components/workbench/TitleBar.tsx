import { useProjectStore } from '../../stores/project-store'
import { useWorkbenchStore } from '../../stores/workbench-store'

export function TitleBar(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const setPaletteOpen = useWorkbenchStore((s) => s.setPaletteOpen)

  return (
    <header className="wb-titlebar">
      <span className="wb-app-name">D2D</span>
      <span data-testid="title-project">
        {project ? (
          <>
            {project.name} <span style={{ color: 'var(--d2d-fg-muted)' }}>schema: {project.schemaVersion}</span>
          </>
        ) : (
          <span style={{ color: 'var(--d2d-fg-muted)' }}>プロジェクト未選択</span>
        )}
      </span>
      <button
        type="button"
        className="wb-command-center"
        data-testid="command-center"
        onClick={() => setPaletteOpen(true)}
      >
        コマンドパレット（Ctrl+Shift+P）
      </button>
      <span style={{ width: 120 }} />
    </header>
  )
}
