import { ref, readonly } from 'vue';

// 响应式屏幕断点常量 (与 SCSS $screen-* 变量保持同步)
export const SCREEN_BREAKPOINTS = {
  mobile: 599,
  tablet: 869,
  compact: 1049
} as const;

// 共享的单例状态，避免多个组件创建大量冗余的 resize 监听器
const isMobile = ref(false);
const isTablet = ref(false);
const isCompact = ref(false);
const isTouch = ref(false);
let isInitialized = false;

function updateResponsiveState() {
  if (typeof window === 'undefined') return;

  const width = window.innerWidth;
  isMobile.value = width <= SCREEN_BREAKPOINTS.mobile;
  isTablet.value = width <= SCREEN_BREAKPOINTS.tablet;
  isCompact.value = width <= SCREEN_BREAKPOINTS.compact;

  const hasTouchPoints = typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0;
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  isTouch.value = hasTouchPoints || isCoarsePointer;
}

function initListeners() {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  updateResponsiveState();

  // 监听窗口尺寸变化
  window.addEventListener('resize', updateResponsiveState, { passive: true });

  // 监听交互指针特性变化 (如外接鼠标或分离键盘)
  if (window.matchMedia) {
    const pointerQuery = window.matchMedia('(pointer: coarse)');
    if (pointerQuery.addEventListener) {
      pointerQuery.addEventListener('change', updateResponsiveState);
    }
  }
}

/**
 * 响应式设备与断点 Hook
 * 提供集中、低开销的跨端状态响应
 */
export function useResponsive() {
  initListeners();
  updateResponsiveState();

  return {
    isMobile: readonly(isMobile),
    isTablet: readonly(isTablet),
    isCompact: readonly(isCompact),
    isTouch: readonly(isTouch),
    breakpoints: SCREEN_BREAKPOINTS
  };
}

export function _resetResponsiveForTesting() {
  isInitialized = false;
}

