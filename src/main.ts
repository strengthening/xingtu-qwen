import './styles.css';

import { App } from './app';

function boot(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('missing #app container');
  const application = new App(app);
  application.start();
  (window as unknown as { xingtu: App }).xingtu = application;
}

function showBootError(error: unknown): void {
  const box = document.getElementById('boot-error');
  if (!box) return;
  box.hidden = false;
  box.textContent = `启动失败：${error instanceof Error ? error.message : String(error)}`;
}

try {
  boot();
} catch (error) {
  showBootError(error);
  throw error;
}
