import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    host: true,
    watch: {
      // public/data 下是静态星表与 HiPS 银河瓦片（数千个文件），开发时不会变动，
      // 无需 HMR 监听。忽略它们以避免耗尽系统 inotify watch 上限（ENOSPC）。
      ignored: ['**/public/data/**'],
    },
  },
});
