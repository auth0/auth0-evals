import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3000,
    // Barkbook's own API (sessions, data) runs on :4000.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
