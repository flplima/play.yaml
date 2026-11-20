import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { preloadPlayer } from './player';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Installable + offline shell. Production only: a worker under the dev server
// would cache modules Vite expects to serve fresh.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Relative to the base, so it also registers under /play.yaml/ on GitHub Pages.
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}

// Tone.js is a separate chunk: fetch it once the page is idle, ahead of the first Play.
window.addEventListener('load', preloadPlayer);
