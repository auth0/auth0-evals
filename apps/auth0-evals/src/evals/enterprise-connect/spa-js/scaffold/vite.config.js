import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    // Barkbook's own API (sessions, data) runs on :4000.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
