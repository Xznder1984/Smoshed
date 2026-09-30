import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { App } from './App'
import { AuthProvider } from './context/AuthContext'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/post.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element is missing')

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <Analytics />
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
