import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import DetachedNoteWindow from '@views/DetachedNoteWindow.vue';
import '@styles/main.scss';
import { initTooltip } from '@utils/tooltip';
import { isDetachedNoteWindow } from './infrastructure/windows/detachedNoteWindow';
import { registerSW } from 'virtual:pwa-register';

if (isDetachedNoteWindow()) {
  document.documentElement.classList.add('detached-note-window');
  document.body.classList.add('detached-note-window');
}

const app = createApp(isDetachedNoteWindow() ? DetachedNoteWindow : App);
const pinia = createPinia();

app.use(pinia);

// 初始化全局 Tooltip
initTooltip();

app.mount('#app');

// 注册 Service Worker 实现 PWA 离线运行与自动增量更新
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

// 自动向浏览器申请持久化存储 (防止浏览器在磁盘紧缺时清退 IndexedDB 中的附件和便签)
if (typeof window !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persisted().then(persisted => {
    if (!persisted) {
      navigator.storage.persist().catch(() => {});
    }
  }).catch(() => {});
}
