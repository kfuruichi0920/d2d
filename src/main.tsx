import React from 'react'
import ReactDOM from 'react-dom/client'
import '@serendie/ui/styles.css'
import './index.css'
import App from './App'
import { AppProviders } from './providers/AppProviders'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>
)
