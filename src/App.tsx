import React, { useEffect, useState } from 'react'
import { Workbench } from './components/workbench/Workbench'
import { ProjectStartScreen } from './pages/ProjectStartScreen'
import { useWorkbenchStore } from './stores/workbenchStore'
import type { ProjectInfo } from './types/d2d-api'

function App(): React.JSX.Element {
  const [project, setProject] = useState<ProjectInfo | null | 'loading'>('loading')

  useEffect(() => {
    window.api.project.getCurrent()
      .then((info) => setProject(info))
      .catch(() => setProject(null))
  }, [])

  const handleCloseProject = () => {
    // Zustand 永続化タブをすべてクリア
    const store = useWorkbenchStore.getState()
    for (const tab of [...store.tabs]) {
      store.closeTab(tab.id)
    }
    setProject(null)
  }

  if (project === 'loading') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontSize: 14, color: '#888',
        background: 'var(--srd-color-surface, #f8fafc)',
      }}>
        起動中...
      </div>
    )
  }

  if (!project) {
    return <ProjectStartScreen onProjectOpened={(info) => setProject(info)} />
  }

  return <Workbench onCloseProject={handleCloseProject} />
}

export default App
