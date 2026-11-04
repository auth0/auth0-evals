import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Barkbook's own API (sessions, data) runs on :4000.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
