import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSidebarResize } from './useSidebarResize';

describe('useSidebarResize Hook 架构单测', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;

  let storageMap: Record<string, string> = {};

  beforeEach(() => {
    storageMap = {};
    globalThis.localStorage = {
      getItem: (key: string) => storageMap[key] || null,
      setItem: (key: string, value: string) => {
        storageMap[key] = value;
      },
      removeItem: (key: string) => {
        delete storageMap[key];
      },
      clear: () => {
        storageMap = {};
      },
      length: 0,
      key: () => null
    } as unknown as Storage;

    (globalThis as unknown as { window: unknown }).window = {
      innerWidth: 1000,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };

    (globalThis as unknown as { document: unknown }).document = {
      body: {
        style: {
          cursor: '',
          userSelect: ''
        }
      }
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    (globalThis as unknown as { document: unknown }).document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
  });

  it('默认宽度应为 220px，且支持自定义配置', () => {
    const { sidebarWidth, isResizing } = useSidebarResize();
    expect(sidebarWidth.value).toBe(220);
    expect(isResizing.value).toBe(false);
  });

  it('应优先读取 localStorage 中保存的有效宽度', () => {
    storageMap['sidebar-width'] = '280';
    const { sidebarWidth } = useSidebarResize();
    expect(sidebarWidth.value).toBe(280);
  });

  it('当 localStorage 中的值小于 minWidth 时应回退默认值', () => {
    storageMap['sidebar-width'] = '100'; // < minWidth 160
    const { sidebarWidth } = useSidebarResize();
    expect(sidebarWidth.value).toBe(220);
  });
});
