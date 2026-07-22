import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/burstflow/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'BurstFlow',
        short_name: 'BurstFlow',
        description: 'Sprint/burst focus manager — 1 deliverable + 1 task moi block, xoay du an, WIP-lock',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      }
    })
  ]
}));
