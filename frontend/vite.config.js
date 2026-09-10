import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // 把体积大且稳定的第三方库拆成独立 chunk（BUG-21）：既缩小首屏入口，
        // 也让这些不常变的库独立缓存，业务代码更新时不必重新下载。
        manualChunks: {
          three: ['three'],
          motion: ['framer-motion', 'gsap'],
          graph: ['d3-force'],
          markdown: ['react-markdown'],
        },
      },
    },
  },
  server: {
    host: true, // listen on 0.0.0.0 so phones on the same LAN can connect
    port: 5173,
    proxy: {
      // 用 127.0.0.1 而非 localhost：后端默认只绑 IPv4 回环（HOST=127.0.0.1），
      // 而 localhost 在 Node 里优先解析为 ::1，会让每次代理请求先白试一次 IPv6；
      // 在不启用 autoSelectFamily 的环境下则会直接连不上。nginx 那边同样用 127.0.0.1。
      '/api': 'http://127.0.0.1:4000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: false,
    server: {
      deps: {
        inline: ['axios'],
      },
    },
  },
});
