import { ref, onUnmounted, getCurrentInstance } from 'vue';

export interface UseSidebarResizeOptions {
  defaultWidth?: number;
  minWidth?: number;
  storageKey?: string;
}

/**
 * 侧边栏拖拽调宽与持久化 Hook
 * 解耦组件内的底层 DOM 鼠标事件与尺寸计算
 */
export function useSidebarResize(options: UseSidebarResizeOptions = {}) {
  const {
    defaultWidth = 220,
    minWidth = 160,
    storageKey = 'sidebar-width'
  } = options;

  const sidebarWidth = ref(defaultWidth);
  const isResizing = ref(false);

  // 从本地存储初始化宽度
  if (typeof localStorage !== 'undefined') {
    const savedWidth = localStorage.getItem(storageKey);
    if (savedWidth) {
      const width = parseInt(savedWidth, 10);
      if (!isNaN(width) && width >= minWidth) {
        sidebarWidth.value = width;
      }
    }
  }

  const handleResize = (e: MouseEvent) => {
    if (!isResizing.value) return;
    let newWidth = e.clientX;
    if (newWidth < minWidth) {
      newWidth = minWidth;
    }
    // 限制最大宽度为窗口宽度的 50%
    if (typeof window !== 'undefined') {
      const maxWidth = window.innerWidth * 0.5;
      if (newWidth > maxWidth) {
        newWidth = maxWidth;
      }
    }
    sidebarWidth.value = newWidth;
  };

  const stopResize = () => {
    if (!isResizing.value) return;
    isResizing.value = false;

    if (typeof document !== 'undefined') {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey, sidebarWidth.value.toString());
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', stopResize);
    }
  };

  const startResize = (e: MouseEvent) => {
    e.preventDefault();
    isResizing.value = true;

    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', handleResize);
      window.addEventListener('mouseup', stopResize);
    }
  };

  if (getCurrentInstance() && typeof window !== 'undefined') {
    onUnmounted(() => {
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', stopResize);
    });
  }

  return {
    sidebarWidth,
    isResizing,
    startResize
  };
}
