import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isIndependentWindow,
  isWindowPinned,
  toggleWindowPin,
  hideCurrentWindow,
  closeCurrentWindow
} from './windowControls';

describe('windowControls 窗口控制及置顶逻辑单测', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      }
    };

    (globalThis as any).window = {
      location: {
        pathname: '/',
        search: ''
      },
      close: vi.fn()
    };

    isWindowPinned.value = false;
  });

  it('isIndependentWindow 正确判断当前是否在插件独立窗口中', () => {
    expect(isIndependentWindow()).toBe(false);

    (window as any).bridge = { label: 'plugin-moment-notes-main' };
    expect(isIndependentWindow()).toBe(true);

    delete (window as any).bridge;
    (window as any).location.pathname = '/path/to/pluginwin.html';
    expect(isIndependentWindow()).toBe(true);
  });

  it('toggleWindowPin 切换置顶状态并同步 localStorage', async () => {
    const mockBus = { publish: vi.fn().mockResolvedValue(undefined) };
    (window as any).bridge = {
      label: 'plugin-moment-notes-main',
      bus: mockBus
    };

    expect(isWindowPinned.value).toBe(false);

    await toggleWindowPin();
    expect(isWindowPinned.value).toBe(true);
    expect(localStorage.getItem('moment_notes_window_pinned')).toBe('true');
    expect(mockBus.publish).toHaveBeenCalledWith('moment-notes:control-window', {
      label: 'plugin-moment-notes-main',
      op: 'alwaysOnTop',
      value: true
    });

    await toggleWindowPin();
    expect(isWindowPinned.value).toBe(false);
    expect(localStorage.getItem('moment_notes_window_pinned')).toBe('false');
    expect(mockBus.publish).toHaveBeenCalledWith('moment-notes:control-window', {
      label: 'plugin-moment-notes-main',
      op: 'alwaysOnTop',
      value: false
    });
  });

  it('hideCurrentWindow 向宿主发布 hide 指令', async () => {
    const mockBus = { publish: vi.fn().mockResolvedValue(undefined) };
    (window as any).bridge = {
      label: 'plugin-moment-notes-main',
      bus: mockBus
    };

    await hideCurrentWindow();
    expect(mockBus.publish).toHaveBeenCalledWith('moment-notes:control-window', {
      label: 'plugin-moment-notes-main',
      op: 'hide'
    });
  });

  it('closeCurrentWindow 优先调用 bridge.close，失败时走 bus 兜底', async () => {
    const mockClose = vi.fn().mockResolvedValue(undefined);
    (window as any).bridge = {
      label: 'plugin-moment-notes-main',
      close: mockClose
    };

    await closeCurrentWindow();
    expect(mockClose).toHaveBeenCalled();
  });
});
