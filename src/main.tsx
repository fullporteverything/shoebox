import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { SessionProvider } from './lib/session.js'
import './lib/motion.js'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <SessionProvider>
    <App />
  </SessionProvider>,
)
