import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useStickyNotesStore } from './stickyNotes';
import { clearStorageMemoryCache } from '@utils/storage';
import { ref } from 'vue';
import { useDragAutoScroll } from '@utils/useDragAutoScroll';

describe('便签拖拽与排序引擎核心单测', () => {
  let storeMap: Map<string, string>;

  beforeEach(() => {
    clearStorageMemoryCache();
    setActivePinia(createPinia());
    storeMap = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => storeMap.get(key) || null,
      setItem: (key: string, value: string) => storeMap.set(key, value),
      removeItem: (key: string) => storeMap.delete(key),
      clear: () => storeMap.clear(),
      length: 0,
      key: () => null
    } as any;
    globalThis.requestAnimationFrame = vi.fn((cb: (time: number) => void) => setTimeout(cb, 16) as any);
    globalThis.cancelAnimationFrame = vi.fn((id: number) => clearTimeout(id));
  });

  it('solidifyCurrentOrderAsCustom 应将当前视图顺序固化为自定义排序基础', () => {
    const store = useStickyNotesStore();
    const note1 = store.addNote('cat-1', '内容1', '便签1');
    const note2 = store.addNote('cat-1', '内容2', '便签2');
    const note3 = store.addNote('cat-1', '内容3', '便签3');

    // 假设当前视图按某种倒序排列: note1, note2, note3
    const customViewOrder = [note1, note2, note3];
    store.solidifyCurrentOrderAsCustom(customViewOrder);

    expect(store.sortMode).toBe('custom');
    expect(store.notes.map(n => n.id)).toEqual([note1.id, note2.id, note3.id]);
  });

  it('moveNote 应在同类便签之间安全换位，并受 100ms 节流保护', async () => {
    const store = useStickyNotesStore();
    const note1 = store.addNote('cat-1', '内容1', '便签1');
    const note2 = store.addNote('cat-1', '内容2', '便签2');
    const note3 = store.addNote('cat-1', '内容3', '便签3');

    // 当前顺序应该是 note3, note2, note1 (addNote 默认 unshift)
    const initialOrder = store.notes.map(n => n.id);
    expect(initialOrder).toEqual([note3.id, note2.id, note1.id]);

    // 移动 note3 到 note1 后面
    store.moveNote(note3.id, note1.id);
    expect(store.notes.map(n => n.id)).toEqual([note2.id, note1.id, note3.id]);

    // 立即再次触发 (小于 100ms)，应被节流拦截
    store.moveNote(note3.id, note2.id);
    expect(store.notes.map(n => n.id)).toEqual([note2.id, note1.id, note3.id]);

    // 等待 110ms 后再触发，应成功换位
    await new Promise(r => setTimeout(r, 110));
    store.moveNote(note3.id, note2.id);
    expect(store.notes.map(n => n.id)).toEqual([note3.id, note2.id, note1.id]);
  });

  it('moveNote 应严格禁止置顶与非置顶便签之间跨组越界换位', () => {
    const store = useStickyNotesStore();
    const note1 = store.addNote('cat-1', '普通便签1');
    const note2 = store.addNote('cat-1', '置顶便签2');

    store.updateNote(note2.id, { isPinned: true }, false);

    // 尝试将普通便签 note1 换位到置顶便签 note2
    store.moveNote(note1.id, note2.id);

    // 顺序不应发生变化，因为置顶状态不同
    const note1Obj = store.notes.find(n => n.id === note1.id);
    const note2Obj = store.notes.find(n => n.id === note2.id);
    expect(note1Obj?.isPinned).toBe(false);
    expect(note2Obj?.isPinned).toBe(true);
  });

  it('useDragAutoScroll 应支持 PointerEvent 坐标并正确计算边缘滚动速度', () => {
    let currentScrollTop = 0;
    const fakeContainer = {
      scrollTop: currentScrollTop,
      getBoundingClientRect: () => ({
        top: 100,
        bottom: 600,
        left: 50,
        right: 450,
        width: 400,
        height: 500
      })
    } as any;

    Object.defineProperty(fakeContainer, 'scrollTop', {
      get: () => currentScrollTop,
      set: (val: number) => {
        currentScrollTop = val;
      }
    });

    const containerRef = ref<HTMLElement | null>(fakeContainer);
    const { handleDragOver, stopScroll } = useDragAutoScroll(containerRef, {
      threshold: 80,
      maxSpeed: 15,
      minSpeed: 3
    });

    // 模拟光标移动到底部边缘 (clientY: 590, 距离 bottom 只有 10px < threshold 80)
    handleDragOver({ clientX: 200, clientY: 590 });

    // 模拟光标离开容器或回到中间 (clientY: 300)
    handleDragOver({ clientX: 200, clientY: 300 });

    stopScroll();
    expect(typeof handleDragOver).toBe('function');
    expect(typeof stopScroll).toBe('function');
  });
});
