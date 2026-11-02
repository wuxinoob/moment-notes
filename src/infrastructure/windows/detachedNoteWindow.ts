import { getToolkitCtx } from '@utils/storage';

export const DETACHED_NOTE_VIEW = 'detached-note';
export const DETACHED_NOTE_REFRESH_TOPIC = 'moment-notes:detached-note-refresh';
export const DETACHED_NOTE_CHANGED_TOPIC = 'moment-notes:detached-note-changed';

const DEFAULT_WINDOW_WIDTH = 520;
const DEFAULT_WINDOW_HEIGHT = 640;

export interface DetachedNoteWindowOptions {
  id: string;
  title?: string;
  backgroundColor?: string;
}

export type DetachedNoteWindowOpenResult = 'created' | 'focused' | 'browser' | 'failed';

// 广播信道 (浏览器原生 fallback)
let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel('moment-notes-sync');
  } catch (e) {
    console.warn('[BroadcastChannel] not supported:', e);
  }
}

export const getDetachedNoteId = (search = window.location.search): string | null => {
  const params = new URLSearchParams(search);
  if (params.get('view') !== DETACHED_NOTE_VIEW) return null;

  const noteId = params.get('noteId')?.trim();
  return noteId || null;
};

export const isDetachedNoteWindow = (search = window.location.search): boolean => {
  return getDetachedNoteId(search) !== null;
};

export const buildDetachedNoteWindowPath = (noteId: string): string => {
  const params = new URLSearchParams({
    view: DETACHED_NOTE_VIEW,
    noteId
  });
  return `index.html?${params.toString()}`;
};

export const buildDetachedNoteWindowBrowserUrl = (
  noteId: string,
  currentUrl = window.location.href
): string => {
  const params = new URLSearchParams({
    view: DETACHED_NOTE_VIEW,
    noteId
  });

  const url = new URL(currentUrl);
  url.search = params.toString();
  url.hash = '';
  return url.toString();
};

const openBrowserFallback = (options: DetachedNoteWindowOptions): boolean => {
  const noteWindow = window.open(
    buildDetachedNoteWindowBrowserUrl(options.id, window.location.href),
    `moment-notes-${options.id}`,
    `popup,width=${DEFAULT_WINDOW_WIDTH},height=${DEFAULT_WINDOW_HEIGHT},resizable=yes`
  );
  noteWindow?.focus();
  return noteWindow !== null;
};

/**
 * 打开或聚焦独立便签悬浮窗口
 * 优先在 Toolkit 宿主下调用 ctx.windows.create，浏览器环境下降级为 window.open
 */
export const openDetachedNoteWindow = async (
  options: DetachedNoteWindowOptions
): Promise<DetachedNoteWindowOpenResult> => {
  const ctx = getToolkitCtx();

  // 1. Toolkit 插件环境
  if (ctx?.windows) {
    const label = `plugin-moment-notes-note-${options.id}`;
    try {
      const exists = await ctx.windows.exists?.(label);
      if (exists) {
        return 'focused';
      }

      const url = `pluginwin.html?plugin=${encodeURIComponent(
        ctx.id || 'custom.moment-notes'
      )}&label=${encodeURIComponent(label)}&view=${DETACHED_NOTE_VIEW}&noteId=${encodeURIComponent(options.id)}`;

      const res = await ctx.windows.create(label, {
        url,
        title: options.title?.trim() || '拾光便签',
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        transparent: true,
        decorations: false,
        shadow: true,
        alwaysOnTop: true,
        resizable: true,
        center: true
      });

      return res === 'created' ? 'created' : 'focused';
    } catch (err) {
      console.error('[DetachedNoteWindow] ctx.windows.create failed:', err);
    }
  }

  // 2. 如果在二级窗口运行 (bridge 上仅有 bus)，向主窗口发送开窗请求
  if (ctx?.bus) {
    try {
      await ctx.bus.publish('moment-notes:open-window', {
        type: 'detached',
        noteId: options.id,
        title: options.title
      });
      return 'created';
    } catch (e) {
      console.warn('[DetachedNoteWindow] Failed to request via bus:', e);
    }
  }

  // 3. 浏览器降级
  return openBrowserFallback(options) ? 'browser' : 'failed';
};

/**
 * 广播便签数据刷新事件至所有独立窗口
 */
export const refreshDetachedNoteWindows = () => {
  const ctx = getToolkitCtx();
  if (ctx?.bus) {
    ctx.bus.publish(DETACHED_NOTE_REFRESH_TOPIC, { timestamp: Date.now() }).catch(() => {});
  }
  if (broadcastChannel) {
    broadcastChannel.postMessage({ type: DETACHED_NOTE_REFRESH_TOPIC, timestamp: Date.now() });
  }
};

/**
 * 通知主窗口该便签已变更
 */
export const notifyDetachedNoteChanged = (noteId: string) => {
  const ctx = getToolkitCtx();
  if (ctx?.bus) {
    ctx.bus.publish(DETACHED_NOTE_CHANGED_TOPIC, { noteId, timestamp: Date.now() }).catch(() => {});
  }
  if (broadcastChannel) {
    broadcastChannel.postMessage({ type: DETACHED_NOTE_CHANGED_TOPIC, noteId, timestamp: Date.now() });
  }
};

/**
 * 订阅独立窗口相关广播事件
 */
export const subscribeDetachedNoteEvents = (
  onRefresh: () => void,
  onChildChanged?: (noteId: string) => void
): (() => void) => {
  const disposers: Array<() => void> = [];
  const ctx = getToolkitCtx();

  if (ctx?.bus) {
    const unsubRefresh = ctx.bus.subscribe(DETACHED_NOTE_REFRESH_TOPIC, () => {
      onRefresh();
    });
    disposers.push(() => {
      Promise.resolve(unsubRefresh).then(off => typeof off === 'function' && off()).catch(() => {});
    });

    if (onChildChanged) {
      const unsubChanged = ctx.bus.subscribe(DETACHED_NOTE_CHANGED_TOPIC, (env: any) => {
        const payload = env?.p ?? env?.payload ?? env;
        const noteId = payload?.noteId;
        if (noteId) onChildChanged(noteId);
      });
      disposers.push(() => {
        Promise.resolve(unsubChanged).then(off => typeof off === 'function' && off()).catch(() => {});
      });
    }
  }

  if (broadcastChannel) {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === DETACHED_NOTE_REFRESH_TOPIC) {
        onRefresh();
      } else if (event.data?.type === DETACHED_NOTE_CHANGED_TOPIC && onChildChanged) {
        onChildChanged(event.data.noteId);
      }
    };
    broadcastChannel.addEventListener('message', handler);
    disposers.push(() => broadcastChannel?.removeEventListener('message', handler));
  }

  return () => {
    disposers.forEach(d => d());
  };
};
