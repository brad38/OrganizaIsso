import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        cadastro: resolve(process.cwd(), 'cadastro.html'),
        termos: resolve(process.cwd(), 'termos.html'),
        privacidade: resolve(process.cwd(), 'privacidade.html'),
      },
    },
  },
});
