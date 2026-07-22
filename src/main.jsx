import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { migrateFromLegacy } from './db.js';

// Đăng ký service worker (PWA). virtual module do vite-plugin-pwa cung cấp.
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

// KHÔNG auto-seed dự án mặc định: nhiều thiết bị seed id ngẫu nhiên khác nhau → sync ra trùng.
migrateFromLegacy().finally(() => {
  createRoot(document.getElementById('root')).render(<App />);
});
