import '@fontsource-variable/inter';
import './renderer/index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './renderer/App';
import { installBrowserApi } from './browserApi';
import { initializeAppearance } from './renderer/lib/appearance';

installBrowserApi();
// Restore the saved theme, font scale, and density before React mounts so a
// reload does not flash the default appearance.
initializeAppearance();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
