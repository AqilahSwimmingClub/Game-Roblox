import { defineConfig } from 'vite';

// Saat pengembangan, API & Socket.IO diteruskan ke server Node (port 3000).
export default defineConfig({
  base: '/',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: { main: 'index.html', demo: 'demo.html' }, output: { manualChunks: { three: ['three'] } } },
  },
});
