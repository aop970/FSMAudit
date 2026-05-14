import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import './index.css'
import App from './App.tsx'
import { msalConfig } from './auth/msalConfig.ts'
import { AuthGate } from './auth/AuthGate.tsx'

const msalInstance = new PublicClientApplication(msalConfig)

// ── Theme initialization ──────────────────────────────────────────────────
// Priority: URL param > localStorage > default (dark)
function applyTheme(t: string) {
  if (t === 'light') {
    document.body.classList.add('light-mode');
    localStorage.setItem('fsm-theme', 'light');
  } else {
    document.body.classList.remove('light-mode');
    localStorage.setItem('fsm-theme', 'dark');
  }
}

const urlTheme = new URLSearchParams(window.location.search).get('theme');
const storedTheme = localStorage.getItem('fsm-theme');
applyTheme(urlTheme ?? storedTheme ?? 'dark');

// ── postMessage listener (Mission Control sends theme:light / theme:dark) ─
window.addEventListener('message', (e: MessageEvent) => {
  if (e.data === 'theme:light') {
    applyTheme('light');
  } else if (e.data === 'theme:dark') {
    applyTheme('dark');
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MsalProvider instance={msalInstance}>
      <AuthGate>
        <App />
      </AuthGate>
    </MsalProvider>
  </StrictMode>,
)
