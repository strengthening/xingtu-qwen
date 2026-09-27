import './styles.css';

import { App } from './app';

function boot(): void {
  const ui = document.getElementById('ui');
  if (!ui) throw new Error('missing #ui container');
  const app = new App(ui);
  app.start();
  (window as unknown as { xingtu: App }).xingtu = app;
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
