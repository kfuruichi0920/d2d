/** Title Bar（P3-1、UI-041）。Command入口と外周パネルの表示切替を右側へ集約する。 */
import { useProjectStore } from '../../stores/project-store'
import { useWorkbenchStore } from '../../stores/workbench-store'

export function TitleBar(): React.JSX.Element {
  const project = useProjectStore((state) => state.project)
  const setPaletteOpen = useWorkbenchStore((state) => state.setPaletteOpen)
  const sideBarVisible = useWorkbenchStore((state) => state.sideBarVisible)
  const secondaryVisible = useWorkbenchStore((state) => state.secondaryVisible)
  const panelVisible = useWorkbenchStore((state) => state.panelVisible)
  const toggleSideBar = useWorkbenchStore((state) => state.toggleSideBar)
  const toggleSecondary = useWorkbenchStore((state) => state.toggleSecondary)
  const togglePanel = useWorkbenchStore((state) => state.togglePanel)

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
      <div className="wb-layout-controls" aria-label="パネル表示切替">
        <button
          type="button"
          className={sideBarVisible ? 'active' : ''}
          data-testid="toggle-primary-sidebar"
          aria-label="Primary Side Barの表示切替"
          aria-pressed={sideBarVisible}
          title="Primary Side Barの表示切替（Ctrl+B）"
          onClick={toggleSideBar}
        >
          ◧ Primary
        </button>
        <button
          type="button"
          className={secondaryVisible ? 'active' : ''}
          data-testid="toggle-secondary-sidebar"
          aria-label="Secondary Side Barの表示切替"
          aria-pressed={secondaryVisible}
          title="Secondary Side Barの表示切替"
          onClick={toggleSecondary}
        >
          Secondary ◨
        </button>
        <button
          type="button"
          className={panelVisible ? 'active' : ''}
          data-testid="toggle-panel"
          aria-label="下段Panelの表示切替"
          aria-pressed={panelVisible}
          title="下段Panelの表示切替（Ctrl+@）"
          onClick={togglePanel}
        >
          ▤ Panel
        </button>
      </div>
    </header>
  )
}
