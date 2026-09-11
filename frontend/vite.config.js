import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendSrc = fileURLToPath(new URL('../backend/src/', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // IMPROVE-19：扩展名分类表以**后端白名单为唯一来源**。extPolicy.js 是纯数据模块
    // （无 node 依赖），前端直接读它，不再手抄副本；改名后构建期即报错，不会静默漂移。
    alias: { '@backend': backendSrc },
  },
  build: {
    rollupOptions: {
      output: {
        // 把体积大且稳定的第三方库拆成独立 chunk（BUG-21）：既缩小首屏入口，
        // 也让这些不常变的库独立缓存，业务代码更新时不必重新下载。
        // gsap 与 framer-motion 分开（IMPROVE-23）：前者由 StaggeredMenu 动态 import，
        // 合并进同一个 chunk 会让「打开页面」顺带预加载 gsap。
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('node_modules\\three')) return 'three';
          if (id.includes('node_modules/d3-force')) return 'graph';
          if (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark')
            || id.includes('node_modules/rehype') || id.includes('node_modules/mdast')
            || id.includes('node_modules/micromark') || id.includes('node_modules/unified')
            || id.includes('node_modules/hast')) return 'markdown';
          if (id.includes('node_modules/framer-motion') || id.includes('node_modules\\framer-motion')) return 'motion';
          if (id.includes('node_modules/gsap')) return 'gsap';
          return undefined;
        },
      },
    },
  },
  server: {
    host: true, // listen on 0.0.0.0 so phones on the same LAN can connect
    port: 5173,
    watch: {
      // BUG-38：编辑器/agent 工具常以「临时文件 + 原子替换」的方式写源码，会在
      // 被改文件旁留下 `<file>.<pid>.<guid>.tmpdir/xxx.tmp`。这类路径寿命只有几毫秒，
      // Vite 的 watcher 一旦抢在它被删除前监听就会抛 EBUSY，且该错误是 FSWatcher 的
      // 'error' 事件——未捕获，会直接**让整个 dev server 退出**。忽略这些模式即可。
      ignored: ['**/*.tmpdir/**', '**/*.tmp', '**/.*.tmpdir/**'],
    },
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
