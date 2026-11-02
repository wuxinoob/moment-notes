import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useResponsive, SCREEN_BREAKPOINTS, _resetResponsiveForTesting } from './useResponsive';

describe('useResponsive Hook 架构单测', () => {
  const originalWindow = globalThis.window;
  let listeners: Record<string, ((...args: any[]) => void)[]> = {};

  const setupMockWindow = (width: number) => {
    listeners = {};
    (globalThis as unknown as { window: unknown }).window = {
      innerWidth: width,
      addEventListener: (event: string, handler: (...args: any[]) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      },
      removeEventListener: (event: string, handler: (...args: any[]) => void) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter(h => h !== handler);
        }
      },
      dispatchEvent: (event: Event) => {
        const handlers = listeners[event.type] || [];
        handlers.forEach(h => h(event));
        return true;
      },
      matchMedia: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    };
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    _resetResponsiveForTesting();
    setupMockWindow(1200);
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it('移动端断点 (<= 599px) 应将 isMobile 识别为 true', () => {
    setupMockWindow(390);
    const { isMobile, isTablet, isCompact } = useResponsive();

    expect(isMobile.value).toBe(true);
    expect(isTablet.value).toBe(true);
    expect(isCompact.value).toBe(true);
  });

  it('桌面端宽屏 (> 1049px) 应将 isMobile、isTablet、isCompact 识别为 false', () => {
    setupMockWindow(1200);
    const { isMobile, isTablet, isCompact } = useResponsive();

    expect(isMobile.value).toBe(false);
    expect(isTablet.value).toBe(false);
    expect(isCompact.value).toBe(false);
  });

  it('断点常量应符合系统定义', () => {
    expect(SCREEN_BREAKPOINTS.mobile).toBe(599);
    expect(SCREEN_BREAKPOINTS.tablet).toBe(869);
    expect(SCREEN_BREAKPOINTS.compact).toBe(1049);
  });
});
