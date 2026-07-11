import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@serendie/design-token/tokens.css'
import './styles/tokens.css'
import './styles/global.css'
import './styles/workbench.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('#root が見つかりません')
}
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
