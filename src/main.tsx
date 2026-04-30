import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

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
    <App />
  </StrictMode>,
)
