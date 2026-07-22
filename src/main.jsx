import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { seedIfEmpty, migrateFromLegacy } from './db.js';

// Đăng ký service worker (PWA). virtual module do vite-plugin-pwa cung cấp.
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

migrateFromLegacy()
  .then(seedIfEmpty)
  .finally(() => {
    createRoot(document.getElementById('root')).render(<App />);
  });
