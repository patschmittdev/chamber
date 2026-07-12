import '@fontsource-variable/inter';
import './renderer/index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './renderer/App';
import { installBrowserApi } from './browserApi';
import { startAppearanceSync } from './renderer/lib/appearanceStore';

installBrowserApi();
// The blocking bootstrap in index.html handles first paint. The store keeps
// appearance synchronized for the rest of the app session before React mounts.
startAppearanceSync();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
