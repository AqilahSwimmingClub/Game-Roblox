import { defineConfig } from 'vite';

// Dashboard Guru disajikan server di /guru/.
export default defineConfig({
  base: '/guru/',
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: { target: 'es2020' },
});
