import './platform.js' // first: reads and strips the ?source= launch marker before the router sees the URL
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { installErrorReporting } from './reportError.js'

installErrorReporting()

// The Google Fonts stylesheet loads as media=print (it never blocks the first paint) and is switched on here: an inline onload= handler in
// index.html would be blocked by the Content-Security-Policy.
document.getElementById('sh-fonts')?.setAttribute('media', 'all')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// The service worker (public/sw.js): installable app, offline play. Production builds only, so `npm run dev` never caches.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
