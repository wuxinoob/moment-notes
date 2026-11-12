import { createApp, type App as VueApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import DetachedNoteWindow from './views/DetachedNoteWindow.vue';
import ToolkitSettingsView from './views/ToolkitSettingsView.vue';
import './styles/main.scss';
import { initTooltip } from './utils/tooltip';
import { initStorage } from './utils/storage';

export const manifest = {
  id: 'custom.moment-notes',
  name: '拾光便签',
  version: '2.1.0',
  api: 3,
  description: '高颜值 WebDAV 便签，支持独立置顶悬浮窗与跨窗口双向同步',
  contributes: {
    views: [
      { id: 'main', slot: 'tool', title: '拾光便签', icon: 'lucide:sticky-note' }
    ],
    hotkeys: [
      { key: 'ctrl+alt+n', action: 'open' }
    ]
  },
  permissions: [
    'rpc:storage',
    'rpc:bus',
    'win:manage'
  ]
};

let activeVueApp: VueApp | null = null;
let isMainWindowVisible = false;

const MEMORY_DESTROY_KEY = 'moment_notes_memory_destroy_on_hide';
let memoryDestroyOnHide =
  typeof localStorage !== 'undefined'
    ? localStorage.getItem(MEMORY_DESTROY_KEY) === 'true'
    : false;

function isMemoryDestroyEnabled(): boolean {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(MEMORY_DESTROY_KEY) === 'true';
  }
  return memoryDestroyOnHide;
}

/**
 * 打开或创建主悬浮窗 (若窗口已被销毁则重新创建并渲染)
 */
async function openMainWindow(ctx: any) {
  if (!ctx?.windows) return;
  const label = 'plugin-moment-notes-main';
  try {
    const exists = await ctx.windows.exists?.(label);
    if (!exists) {
      // 依据 Toolkit 最新规范：插件独立窗口页面统一采用 pluginwin.html
      const url = `pluginwin.html?plugin=${encodeURIComponent(
        ctx.id || 'custom.moment-notes'
      )}&label=${encodeURIComponent(label)}`;

      await ctx.windows.create(label, {
        url,
        title: '拾光便签',
        width: 1020,
        height: 720,
        center: true,
        decorations: false,
        transparent: true,
        shadow: true,
        skipTaskbar: true,
        resizable: true
      });
    }

    // 呼出独立窗口采用 raise (unminimize -> show -> focus)
    await ctx.windows.control(label, 'raise', true);
    isMainWindowVisible = true;
    ctx.log?.info?.('Notes floating window summoned');
  } catch (err) {
    ctx.log?.error?.(`Failed to open main floating window: ${err}`);
  }
}

/**
 * 切换主悬浮窗的显隐状态 (快捷键呼出/收起)
 * 若启用省内存优化：不可见时直接关闭销毁 Webview 进程；呼出时重新创建渲染
 */
async function toggleMainWindow(ctx: any) {
  if (!ctx?.windows) return;
  const label = 'plugin-moment-notes-main';
  try {
    const exists = await ctx.windows.exists?.(label);
    if (!exists) {
      await openMainWindow(ctx);
      return;
    }

    if (isMainWindowVisible) {
      if (isMemoryDestroyEnabled()) {
        await ctx.windows.control(label, 'close');
        isMainWindowVisible = false;
        ctx.log?.info?.('Notes floating window destroyed via hotkey (memory saving)');
      } else {
        await ctx.windows.control(label, 'hide');
        isMainWindowVisible = false;
        ctx.log?.info?.('Notes floating window hidden via hotkey');
      }
    } else {
      await ctx.windows.control(label, 'raise', true);
      isMainWindowVisible = true;
      ctx.log?.info?.('Notes floating window raised via hotkey');
    }
  } catch (err) {
    ctx.log?.error?.(`Failed to toggle main window: ${err}`);
    isMainWindowVisible = false;
    await openMainWindow(ctx);
  }
}

async function openDetachedWindow(ctx: any, noteId: string, title?: string) {
  if (!ctx?.windows) return;
  const label = `plugin-moment-notes-note-${noteId}`;
  try {
    const exists = await ctx.windows.exists?.(label);
    if (exists) {
      await ctx.windows.control(label, 'raise', true);
      return;
    }

    const url = `pluginwin.html?plugin=${encodeURIComponent(
      ctx.id || 'custom.moment-notes'
    )}&label=${encodeURIComponent(label)}&view=detached-note&noteId=${encodeURIComponent(noteId)}`;

    await ctx.windows.create(label, {
      url,
      title: title || '拾光便签',
      width: 520,
      height: 640,
      center: true,
      decorations: false,
      transparent: true,
      shadow: true,
      alwaysOnTop: true,
      resizable: true
    });
    await ctx.windows.control(label, 'raise', true);
    ctx.log?.info?.(`Detached note window created for ${noteId}`);
  } catch (err) {
    ctx.log?.error?.(`Failed to open detached note window: ${err}`);
  }
}

export default {
  manifest,

  async activate(ctx: any) {
    window.__TOOLKIT_CTX__ = ctx;
    await initStorage(ctx);

    // 监听全局快捷键：按键呼出 / 切换悬浮窗
    const handleHotkeySummon = () => {
      ctx.log?.info?.('Summon hotkey triggered');
      toggleMainWindow(ctx);
      // 呼出时向便签窗口广播静默同步检查请求 (事件驱动无感同步)
      ctx.bus?.publish?.('moment-notes:sync-check', { timestamp: Date.now() });
    };
    ctx.onHotkey?.('open', handleHotkeySummon);
    ctx.onHotkey?.('quick-note', handleHotkeySummon);

    // 监听来自子窗口的窗口开辟与通信请求
    ctx.bus?.subscribe?.('moment-notes:open-window', (env: any) => {
      const payload = env?.p ?? env?.payload ?? env;
      const { type, noteId, title } = payload || {};
      if (type === 'main') {
        openMainWindow(ctx);
      } else if (type === 'detached' && noteId) {
        openDetachedWindow(ctx, noteId, title);
      }
    });

    // 监听来自子窗口的关闭请求 (主窗口持有 win:manage，予以双重保险关闭)
    ctx.bus?.subscribe?.('moment-notes:close-window', async (env: any) => {
      const payload = env?.p ?? env?.payload ?? env;
      const targetLabel = payload?.label;
      if (targetLabel && ctx?.windows) {
        try {
          await ctx.windows.control(targetLabel, 'close');
          ctx.log?.info?.(`Closed window ${targetLabel} via bus control`);
          if (targetLabel === 'plugin-moment-notes-main') {
            isMainWindowVisible = false;
          }
        } catch (err) {
          ctx.log?.warn?.(`Failed to close window ${targetLabel}: ${err}`);
        }
      }
    });

    // 监听来自子窗口的窗口控制指令 (如置顶 alwaysOnTop、hide、show 等)
    ctx.bus?.subscribe?.('moment-notes:control-window', async (env: any) => {
      const payload = env?.p ?? env?.payload ?? env;
      const { label, op, value } = payload || {};
      if (label && op && ctx?.windows) {
        try {
          if (label === 'plugin-moment-notes-main' && op === 'hide') {
            if (isMemoryDestroyEnabled()) {
              await ctx.windows.control(label, 'close');
              isMainWindowVisible = false;
              ctx.log?.info?.(`Window ${label} closed on hide to optimize memory`);
              return;
            }
            await ctx.windows.control(label, 'hide');
            isMainWindowVisible = false;
            return;
          }

          await ctx.windows.control(label, op, value);
          if (label === 'plugin-moment-notes-main') {
            if (op === 'show' || op === 'raise') {
              isMainWindowVisible = true;
            }
          }
        } catch (err) {
          ctx.log?.warn?.(`Failed to control window ${label} (${op}): ${err}`);
        }
      }
    });

    // 监听配置变更事件 (实时更新内存优化等偏好)
    ctx.bus?.subscribe?.('moment-notes:config-changed', (env: any) => {
      const payload = env?.p ?? env?.payload ?? env;
      if (payload?.key === MEMORY_DESTROY_KEY) {
        memoryDestroyOnHide = Boolean(payload.value);
        ctx.log?.info?.(`[Toolkit] Memory destroy on hide setting updated: ${memoryDestroyOnHide}`);
      }
    });

    // 挂载主窗口二级工具页：仅显示原生设置与控制台
    ctx.registerView('main', (root: HTMLElement) => {
      if (activeVueApp) {
        activeVueApp.unmount();
        activeVueApp = null;
      }
      root.innerHTML = '';
      const container = document.createElement('div');
      container.className = 'moment-notes-plugin-root';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.overflowY = 'auto';
      root.appendChild(container);

      const app = createApp(ToolkitSettingsView);
      app.mount(container);
      activeVueApp = app;
    });
  },

  deactivate() {
    if (activeVueApp) {
      activeVueApp.unmount();
      activeVueApp = null;
    }
    window.__TOOLKIT_CTX__ = null;
  }
};

/**
 * 供 Toolkit pluginwin-host 调用的独立窗口挂载入口
 * 在独立 Webview 窗口中执行，隔离 DOM 与样式沙箱
 */
export async function mountWindow(bridge: any) {
  (window as any).bridge = bridge;
  window.__TOOLKIT_CTX__ = bridge;

  // 1. 依据 Toolkit Host API v3 规范：pluginwin.html 采用 0 KB CSS 纯净空白画布 (Zero-CSS Blank Canvas)
  // 宿主彻底移除 plugin.css 与 Tailwind preflight，窗口样式完全由插件自供 `<style>` 闭环驱动
  if (typeof (window as any).__injectMomentNotesStyles === 'function') {
    (window as any).__injectMomentNotesStyles(document);
  }

  // 2. 异步预热远程存储层 (非阻塞执行，优先直接利用本地已有的同步 localStorage 秒级挂载首屏)
  initStorage(bridge).catch(e => console.warn('[Mount] initStorage background error:', e));

  // 3. 严格判断窗口形态（精准匹配前缀，防止 'notes-' 包含 'note-' 造成假阳性误判）
  const q = new URLSearchParams(window.location.search);
  const isDetached =
    q.get('view') === 'detached-note' ||
    bridge?.label?.startsWith('plugin-moment-notes-note-') ||
    bridge?.label?.includes('detached');

  // 4. 清理 body 并保证视口、盒模型与透明底色契合无边框窗口规范
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;background:transparent;';
  document.documentElement.style.background = 'transparent';

  const container = document.createElement('div');
  container.id = 'moment-notes-app-root';
  container.style.cssText = 'width:100%;height:100%;overflow:hidden;background:transparent;';
  document.body.appendChild(container);

  let targetComponent: any = App;
  if (isDetached) {
    document.documentElement.classList.add('detached-note-window');
    document.body.classList.add('detached-note-window');
    targetComponent = DetachedNoteWindow;
  } else {
    document.documentElement.classList.add('moment-notes-main-window');
    document.body.classList.add('moment-notes-main-window');
    targetComponent = App;
  }

  const app = createApp(targetComponent);
  const pinia = createPinia();
  app.use(pinia);
  initTooltip();
  app.mount(container);

  // 5. 登记退场清理钩子 (在 bridge dispose / 窗口销毁时有序注销 Vue 应用)
  if (typeof bridge?.cleanup === 'function') {
    bridge.cleanup(() => {
      try {
        app.unmount();
      } catch {
        // ignore unmount errors
      }
    });
  }
}
