import { ref } from 'vue';

/**
 * 窗口控制通用工具函数
 * 提供跨平台、多模式下的窗口拖拽、置顶、隐藏与关闭控制机制
 */

const PIN_STORAGE_KEY = 'moment_notes_window_pinned';

/**
 * 窗口是否处于置顶固定状态 (响应式状态，自动持久化至本地存储)
 * - 未置顶：表现为轻量悬浮窗，失焦 (点击其他地方) 自动隐藏
 * - 已置顶：保持在最前端，点击其他地方不隐藏
 */
export const isWindowPinned = ref<boolean>(
  typeof window !== 'undefined' ? localStorage.getItem(PIN_STORAGE_KEY) === 'true' : false
);

export const isIndependentWindow = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    Boolean((window as any).bridge) ||
    window.location.pathname.includes('pluginwin.html') ||
    window.location.search.includes('mode=pluginwin')
  );
};

export const dragCurrentWindow = (e?: MouseEvent) => {
  if (typeof window === 'undefined') return;
  if (e && e.buttons !== 1) return;

  const bridge = (window as any).bridge;
  if (bridge?.drag) {
    try {
      bridge.drag();
    } catch (err) {
      console.warn('[WindowControl] bridge.drag() failed:', err);
    }
  }
};

/**
 * 设置当前独立窗口的置顶状态 (通过跨窗口事件委托主窗口执行 ctx.windows.control)
 */
export const setWindowAlwaysOnTop = async (alwaysOnTop: boolean) => {
  if (typeof window === 'undefined') return;
  const bridge = (window as any).bridge;
  const label = bridge?.label;
  if (bridge?.bus && label) {
    try {
      await bridge.bus.publish('moment-notes:control-window', {
        label,
        op: 'alwaysOnTop',
        value: alwaysOnTop
      });
    } catch (err) {
      console.warn('[WindowControl] setWindowAlwaysOnTop failed:', err);
    }
  }
};

/**
 * 切换窗口置顶状态并同步持久化
 */
export const toggleWindowPin = async () => {
  isWindowPinned.value = !isWindowPinned.value;
  if (typeof window !== 'undefined') {
    localStorage.setItem(PIN_STORAGE_KEY, String(isWindowPinned.value));
  }
  await setWindowAlwaysOnTop(isWindowPinned.value);
};

/**
 * 隐藏当前窗口 (用于失焦自动隐藏或 Esc 退出)
 */
export const hideCurrentWindow = async () => {
  if (typeof window === 'undefined') return;
  const bridge = (window as any).bridge;
  const label = bridge?.label;
  if (bridge?.bus && label) {
    try {
      await bridge.bus.publish('moment-notes:control-window', {
        label,
        op: 'hide'
      });
    } catch (err) {
      console.warn('[WindowControl] hideCurrentWindow failed:', err);
    }
  }
};

export const closeCurrentWindow = async () => {
  if (typeof window === 'undefined') return;

  const bridge = (window as any).bridge;
  const label = bridge?.label;

  // 1. 优先调用 bridge.close() (通过 Tauri allow-close 原生关闭)
  try {
    if (bridge?.close) {
      const res = bridge.close();
      if (res && typeof res.then === 'function') {
        await res;
      }
      return;
    }
  } catch (err) {
    console.warn('[WindowControl] bridge.close() failed, falling back to bus:', err);
  }

  // 2. 跨窗口 EventBus 通知宿主主窗口通过 ctx.windows.control(label, 'close') 强制关闭
  try {
    if (bridge?.bus && label) {
      await bridge.bus.publish('moment-notes:close-window', { label });
      return;
    }
  } catch (err) {
    console.warn('[WindowControl] bus publish close-window failed:', err);
  }

  // 3. 浏览器原生 window.close() 兜底
  try {
    window.close();
  } catch (e) {
    console.warn('[WindowControl] window.close() failed:', e);
  }
};
