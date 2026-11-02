/**
 * 本地存储与运行环境适配层
 * 支持纯前端 Web 模式与 Toolkit 插件 (Tauri) 模式
 */

const STORAGE_PREFIX = '__moment_notes_';

/**
 * 获取注入的 Toolkit 上下文 (如果存在)
 */
export const getToolkitCtx = (): any | null => {
  if (typeof window !== 'undefined' && window.__TOOLKIT_CTX__) {
    return window.__TOOLKIT_CTX__;
  }
  return null;
};

/**
 * 检查当前是否在 Toolkit 插件环境中运行
 */
export const isToolkit = (): boolean => {
  return getToolkitCtx() !== null;
};

/**
 * 检查当前是否在 uTools 环境中运行 (兜底兼容)
 */
export const isUTools = (): boolean => {
  return typeof window !== 'undefined' && typeof (window as any).utools !== 'undefined';
};

// 内存镜像缓存，加速读取并桥接异步存储
const memoryCache = new Map<string, string>();

export const clearStorageMemoryCache = (): void => {
  memoryCache.clear();
};

/**
 * 初始化存储缓存
 * 如果在 Toolkit 环境下，从 ctx.storage 拉取已持久化数据
 */
export const initStorage = async (ctx?: any): Promise<void> => {
  const targetCtx = ctx || getToolkitCtx();
  if (targetCtx?.storage) {
    try {
      const keys: string[] = (await targetCtx.storage.keys()) || [];
      if (keys.length > 0) {
        // 使用 Promise.all 并行发起所有 key 的读取，消除 20+ 次串行 IPC 往返延迟
        const values = await Promise.all(keys.map(k => targetCtx.storage.get(k)));
        keys.forEach((k, i) => {
          const val = values[i];
          if (val !== null && val !== undefined) {
            memoryCache.set(k, typeof val === 'string' ? val : JSON.stringify(val));
          }
        });
      }
    } catch (err) {
      console.warn('[Storage] Failed to preload from ctx.storage:', err);
    }
  }
};

/**
 * 统一通用存储接口
 * 优先使用内存缓存与 ctx.storage，降级使用 localStorage (兼顾命名空间与原生键名兼容)
 */
export const storage = {
  getItem(key: string): string | null {
    // 1. 如果在 localStorage 中有定义，直接读取最新值 (兼容测试环境与多页面读写)
    if (typeof localStorage !== 'undefined') {
      const prefixedKey = key.startsWith(STORAGE_PREFIX) ? key : `${STORAGE_PREFIX}${key}`;
      const val = localStorage.getItem(key) ?? localStorage.getItem(prefixedKey);
      if (val !== null) {
        memoryCache.set(key, val);
        return val;
      }
    }

    // 2. 从内存缓存获取
    if (memoryCache.has(key)) {
      return memoryCache.get(key) || null;
    }

    return null;
  },

  setItem(key: string, value: string): void {
    memoryCache.set(key, value);

    // 1. 同步写入本地 localStorage (同时保留原始 key 与前缀 key)
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, value);
        if (!key.startsWith(STORAGE_PREFIX)) {
          localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
        }
      } catch (e) {
        console.warn('[Storage] localStorage.setItem failed:', e);
      }
    }

    // 2. 若在 Toolkit 环境下，异步写入插件独立存储目录 ({appData}/plugin-data/<id>/data.json)
    const ctx = getToolkitCtx();
    if (ctx?.storage) {
      let parsedValue: any = value;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        // 保留原字符串
      }
      ctx.storage.set(key, parsedValue).catch((err: any) => {
        console.warn(`[Storage] ctx.storage.set('${key}') failed:`, err);
      });
    }
  },

  removeItem(key: string): void {
    memoryCache.delete(key);

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
      if (!key.startsWith(STORAGE_PREFIX)) {
        localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
      }
    }

    const ctx = getToolkitCtx();
    if (ctx?.storage) {
      ctx.storage.remove(key).catch((err: any) => {
        console.warn(`[Storage] ctx.storage.remove('${key}') failed:`, err);
      });
    }
  }
};

/**
 * 复制文本到剪切板
 */
export const pasteTextToCursor = async (text: string): Promise<boolean> => {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return false;
    }
  } catch (e) {
    console.warn('Clipboard copy failed, fallback to textarea:', e);
  }

  // 极简降级方案：创建临时 textarea 复制
  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (err) {
      console.error('execCommand copy failed:', err);
    }
  }
  return false;
};

/**
 * 保存文本内容为本地文件 (标准浏览器 Blob 下载)
 */
export const downloadOrWriteFile = (
  content: string,
  filename: string,
  mimeType: string = 'text/plain'
): 'success' | 'canceled' | 'fallback' => {
  if (typeof document === 'undefined') {
    return 'fallback';
  }
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return 'success';
  } catch (e) {
    console.error('Browser download fallback failed:', e);
    return 'fallback';
  }
};
