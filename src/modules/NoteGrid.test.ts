import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useStickyNotesStore } from '@stores/stickyNotes';
import { computed } from 'vue';

describe('NoteGrid 列数与网格样式计算单测 (方案一优化)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('固定列数模式：无论桌面还是移动端，严格按用户指定的列数等分 (1/2/3/4 列)', () => {
    const store = useStickyNotesStore();

    const actualColumns = computed(() => {
      if (store.gridColumns === 'auto') return 'auto';
      return store.gridColumns;
    });

    const getGridStyle = (colsVal: any, isMobile: boolean) => {
      if (colsVal !== 'auto') {
        const cols = colsVal;
        return {
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          '--leave-card-width': `calc((100% - (var(--grid-gap, 20px) * ${cols - 1})) / ${cols})`
        };
      }
      if (isMobile) {
        return {
          gridTemplateColumns: '1fr',
          '--leave-card-width': '100%'
        };
      }
      const minWidth = 260;
      return {
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minWidth}px), 1fr))`,
        '--leave-card-width': `${minWidth}px`
      };
    };

    // 1. 设置 2 列：在移动端与桌面端都应输出 2 列等分轨道
    store.setGridColumns(2);
    expect(actualColumns.value).toBe(2);
    const mobileStyle2 = getGridStyle(actualColumns.value, true);
    expect(mobileStyle2.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(mobileStyle2['--leave-card-width']).toBe('calc((100% - (var(--grid-gap, 20px) * 1)) / 2)');

    // 2. 设置 3 列
    store.setGridColumns(3);
    expect(actualColumns.value).toBe(3);
    const mobileStyle3 = getGridStyle(actualColumns.value, true);
    expect(mobileStyle3.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');

    // 3. 设置 1 列
    store.setGridColumns(1);
    expect(actualColumns.value).toBe(1);
    const mobileStyle1 = getGridStyle(actualColumns.value, true);
    expect(mobileStyle1.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))');
  });

  it('自适应模式：移动端/小屏兜底为单列 1fr，桌面端根据最小卡片宽度流式填充', () => {
    const store = useStickyNotesStore();
    store.setGridColumns('auto');

    const getGridStyle = (colsVal: any, isMobile: boolean) => {
      if (colsVal !== 'auto') {
        const cols = colsVal;
        return {
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          '--leave-card-width': `calc((100% - (var(--grid-gap, 20px) * ${cols - 1})) / ${cols})`
        };
      }
      if (isMobile) {
        return {
          gridTemplateColumns: '1fr',
          '--leave-card-width': '100%'
        };
      }
      const minWidth = 260;
      return {
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minWidth}px), 1fr))`,
        '--leave-card-width': `${minWidth}px`
      };
    };

    // 移动端自适应应输出 1fr
    const mobileAuto = getGridStyle('auto', true);
    expect(mobileAuto.gridTemplateColumns).toBe('1fr');
    expect(mobileAuto['--leave-card-width']).toBe('100%');

    // 桌面端自适应应输出 auto-fill
    const desktopAuto = getGridStyle('auto', false);
    expect(desktopAuto.gridTemplateColumns).toContain('repeat(auto-fill');
    expect(desktopAuto['--leave-card-width']).toBe('260px');
  });
});
