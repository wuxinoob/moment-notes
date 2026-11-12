<script lang="ts" setup>
import { onMounted, onUnmounted } from 'vue';
import { useStickyNotesStore } from '@stores/stickyNotes';
import { initStorage, getToolkitCtx } from '@utils/storage';
import { webdavSyncEngine } from './infrastructure/sync/WebdavSyncEngine';
import Dashboard from '@views/Dashboard.vue';
import ImagePreviewModal from '@components/ImagePreviewModal.vue';
import NotePreviewModal from '@components/NotePreviewModal.vue';
import { eventBus } from './domain/events/DomainEventBus';
import {
  refreshDetachedNoteWindows,
  subscribeDetachedNoteEvents
} from './infrastructure/windows/detachedNoteWindow';
import {
  isIndependentWindow,
  isWindowPinned,
  hideCurrentWindow,
  setWindowAlwaysOnTop
} from '@utils/windowControls';

const store = useStickyNotesStore();
const unsubscribeCallbacks: Array<() => void> = [];

onMounted(async () => {
  const isDevMode =
    import.meta.env.DEV ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  if (isDevMode) {
    (window as any).resetTags = store.devResetTags;
    (window as any).resetNotes = store.devResetNotes;
    (window as any).resetAllData = store.devResetAllData;
    console.log('%c[Dev Helper] 已挂载开发重置控制台指令: ', 'color: #3b82f6; font-weight: bold;');
    console.log('- resetTags(): 清空所有便签的标签(tags)');
    console.log('- resetNotes(): 重置所有便签内容为默认欢迎便签');
    console.log('- resetAllData(): 清空缓存，完全重置分类与便签数据');
  }

  // 1. 同步加载本地已有数据与主题，秒级呈现首屏
  store.loadData();
  store.initTheme();

  // 2. 后台异步预热远程存储层，完成后若有改动则自动静默刷新
  initStorage().then(() => {
    store.reloadNotes();
  }).catch(() => {});

  // 3. 监听来自宿主快捷键呼出时的同步探测请求 (插件模式事件驱动无感同步)
  const toolkitCtx = getToolkitCtx();
  if (toolkitCtx?.bus) {
    toolkitCtx.bus.subscribe('moment-notes:sync-check', () => {
      webdavSyncEngine.triggerSyncCheck({ silent: true, minIntervalMs: 5000 }).catch(() => {});
    });
  }

  // 4. 插件悬浮窗生命周期：初始化置顶状态与失焦自动隐藏 (当未置顶时点击其他地方自动隐藏)
  if (isIndependentWindow() && isWindowPinned.value) {
    setWindowAlwaysOnTop(true).catch(() => {});
  }

  let blurTimer: number | null = null;
  let pendingHideRetryTimer: number | null = null;

  const isMemoryDestroyEnabled = () => {
    try {
      return localStorage.getItem('moment_notes_memory_destroy_on_hide') === 'true';
    } catch {
      return false;
    }
  };

  const handleWindowBlur = () => {
    if (!isIndependentWindow()) return;
    // 若处于置顶固定状态，失焦不自动隐藏
    if (isWindowPinned.value) return;
    // 若正在唤起系统文件选择框，失焦不隐藏
    if ((window as any).__isFileDialogActive) return;

    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = window.setTimeout(async () => {
      blurTimer = null;
      if (
        typeof document !== 'undefined' &&
        !document.hasFocus() &&
        !isWindowPinned.value &&
        !(window as any).__isFileDialogActive
      ) {
        // 省内存销毁模式下，若正在进行 WebDAV 同步，延后隐藏/销毁以避免截断上传请求
        if (webdavSyncEngine.isSyncing.value && isMemoryDestroyEnabled()) {
          if (pendingHideRetryTimer) clearTimeout(pendingHideRetryTimer);
          pendingHideRetryTimer = window.setTimeout(() => {
            pendingHideRetryTimer = null;
            handleWindowBlur();
          }, 400);
          return;
        }
        await hideCurrentWindow();
      }
    }, 120);
  };

  const handleWindowFocus = () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    if (pendingHideRetryTimer) {
      clearTimeout(pendingHideRetryTimer);
      pendingHideRetryTimer = null;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      webdavSyncEngine.triggerSyncCheck({ silent: true, minIntervalMs: 15000 }).catch(() => {});
    }
  };

  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (webdavSyncEngine.isSyncing.value) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isIndependentWindow()) {
      const hasModal = document.querySelector('.modal-backdrop, .preview-modal-overlay, .image-preview-overlay');
      if (!hasModal && !store.editingNoteId) {
        if (webdavSyncEngine.isSyncing.value && isMemoryDestroyEnabled()) {
          store.showToast('正在向云端写入数据，请稍候片刻...', 'info');
          return;
        }
        hideCurrentWindow();
      }
    }
  };

  document.addEventListener('visibilitychange', handleWindowFocus);
  window.addEventListener('focus', handleWindowFocus);
  window.addEventListener('blur', handleWindowBlur);
  window.addEventListener('keydown', handleGlobalKeyDown);
  window.addEventListener('beforeunload', handleBeforeUnload);

  unsubscribeCallbacks.push(() => {
    if (blurTimer) clearTimeout(blurTimer);
    if (pendingHideRetryTimer) clearTimeout(pendingHideRetryTimer);
    document.removeEventListener('visibilitychange', handleWindowFocus);
    window.removeEventListener('focus', handleWindowFocus);
    window.removeEventListener('blur', handleWindowBlur);
    window.removeEventListener('keydown', handleGlobalKeyDown);
    window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  // 5. 监听独立便签窗口与跨窗口同步事件
  unsubscribeCallbacks.push(
    subscribeDetachedNoteEvents(
      () => {
        store.reloadNotes();
      },
      (_noteId: string) => {
        store.reloadNotes();
        refreshDetachedNoteWindows();
      }
    )
  );

  // 6. 监听领域事件，向其他窗口广播刷新
  unsubscribeCallbacks.push(
    eventBus.subscribe('NOTE_CREATED', refreshDetachedNoteWindows),
    eventBus.subscribe('NOTE_UPDATED', refreshDetachedNoteWindows),
    eventBus.subscribe('NOTE_DELETED', refreshDetachedNoteWindows),
    eventBus.subscribe('NOTE_RESTORED', refreshDetachedNoteWindows)
  );
});

onUnmounted(() => {
  unsubscribeCallbacks.splice(0).forEach(unsubscribe => unsubscribe());
});
</script>

<template>
  <div class="app-wrapper">
    <Dashboard />
    <ImagePreviewModal />
    <NotePreviewModal />
  </div>
</template>

<style lang="scss">
.app-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background-color: #181b24;
  background: linear-gradient(135deg, var(--bg-gradient-start, #1e222e) 0%, var(--bg-gradient-end, #141720) 100%);
  border-radius: $window-radius;
  border: 1px solid var(--panel-border, rgba(255, 255, 255, 0.08));
  box-sizing: border-box;

  .dashboard-layout {
    flex: 1;
    min-height: 0;
  }
}
</style>
