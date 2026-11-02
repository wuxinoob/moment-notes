<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Copy, Minus, Pin, Square, X } from '@lucide/vue';
import NoteCard from '@modules/NoteCard/NoteCard.vue';
import Toast from '@components/Toast.vue';
import ConfirmModal from '@components/ConfirmModal.vue';
import ImagePreviewModal from '@components/ImagePreviewModal.vue';
import { COLOR_PRESETS, useStickyNotesStore } from '@stores/stickyNotes';
import { getToolkitCtx, initStorage, isToolkit } from '@utils/storage';
import { closeCurrentWindow, dragCurrentWindow } from '@utils/windowControls';
import { eventBus } from '../domain/events/DomainEventBus';
import {
  getDetachedNoteId,
  notifyDetachedNoteChanged,
  subscribeDetachedNoteEvents
} from '../infrastructure/windows/detachedNoteWindow';
import type { Note } from '@type';

const store = useStickyNotesStore();
const noteId = getDetachedNoteId();
const isReady = ref(false);
const isAlwaysOnTop = ref(false);
const isMaximized = ref(false);
const isEntered = ref(false);
const unsubscribeCallbacks: Array<() => void> = [];

const playEnterAnimation = () => {
  if (isEntered.value) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      isEntered.value = true;
    });
  });
};

const note = computed(() => {
  if (!noteId) return null;
  return store.allNotes.find(item => item.id === noteId && !item.isDeleted) || null;
});

const windowColorStyle = computed(() => {
  const preset = COLOR_PRESETS[note.value?.color || 'yellow'] || COLOR_PRESETS.yellow;
  return {
    '--detached-note-bg': preset.lightBg,
    '--detached-note-bg-dark': preset.darkBg,
    '--detached-note-border': preset.lightBorder,
    '--detached-note-border-dark': preset.darkBorder,
    '--detached-note-text': preset.lightText,
    '--detached-note-text-dark': preset.darkText,
    '--detached-note-btn-hover-bg': preset.lightBtnHoverBg,
    '--detached-note-btn-hover-color': preset.lightBtnHoverColor,
    '--detached-note-btn-hover-bg-dark': preset.darkBtnHoverBg,
    '--detached-note-btn-hover-color-dark': preset.darkBtnHoverColor
  };
});

const closeWindow = () => {
  closeCurrentWindow();
};

const minimizeWindow = () => {
  const ctx = getToolkitCtx();
  const label = noteId ? `plugin-moment-notes-note-${noteId}` : undefined;
  if (ctx?.windows && label) {
    ctx.windows.control(label, 'minimize').catch(() => {});
  } else if (ctx?.bus && label) {
    ctx.bus.publish('moment-notes:control-window', {
      label,
      op: 'minimize'
    }).catch(() => {});
  }
};

const toggleAlwaysOnTop = () => {
  if (!noteId) return;
  isAlwaysOnTop.value = !isAlwaysOnTop.value;

  const ctx = getToolkitCtx();
  const label = `plugin-moment-notes-note-${noteId}`;
  if (ctx?.windows) {
    ctx.windows.control(label, 'alwaysOnTop', isAlwaysOnTop.value).catch(() => {});
  } else if (ctx?.bus) {
    ctx.bus.publish('moment-notes:control-window', {
      label,
      op: 'alwaysOnTop',
      value: isAlwaysOnTop.value
    }).catch(() => {});
  }
};

const toggleMaximize = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {
      isMaximized.value = !isMaximized.value;
    });
  } else {
    document.exitFullscreen?.().catch(() => {
      isMaximized.value = false;
    });
  }
};

const notifyParentChanged = () => {
  if (!noteId) return;
  notifyDetachedNoteChanged(noteId);
};

const handleDragStart = (e: MouseEvent) => {
  dragCurrentWindow(e);
};

onMounted(async () => {
  document.documentElement.classList.add('detached-note-window');
  document.body.classList.add('detached-note-window');

  // 同步直接加载，秒级呈现
  store.loadData();
  store.initTheme();
  isReady.value = true;
  playEnterAnimation();

  initStorage().then(() => {
    store.reloadNotes();
  }).catch(() => {});

  unsubscribeCallbacks.push(
    subscribeDetachedNoteEvents(() => {
      store.reloadNotes();
    })
  );

  const handleFullscreenChange = () => {
    isMaximized.value = !!document.fullscreenElement;
  };
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  unsubscribeCallbacks.push(() => document.removeEventListener('fullscreenchange', handleFullscreenChange));

  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const hasModal = document.querySelector('.modal-backdrop, .preview-modal-overlay, .image-preview-overlay');
      if (!hasModal && !store.editingNoteId) {
        closeWindow();
      }
    }
  };
  window.addEventListener('keydown', handleGlobalKeyDown);
  unsubscribeCallbacks.push(() => window.removeEventListener('keydown', handleGlobalKeyDown));

  unsubscribeCallbacks.push(
    eventBus.subscribe<Note>('NOTE_UPDATED', event => {
      if (event.payload.id === noteId) {
        notifyParentChanged();
      }
    }),
    eventBus.subscribe<string>('NOTE_DELETED', event => {
      if (event.payload !== noteId) return;
      notifyParentChanged();
      window.setTimeout(closeWindow, 0);
    })
  );
});

onUnmounted(() => {
  unsubscribeCallbacks.splice(0).forEach(unsubscribe => unsubscribe());
  document.documentElement.classList.remove('detached-note-window');
  document.body.classList.remove('detached-note-window');
});
</script>

<template>
  <main
    class="detached-note-shell"
    :class="{ 'is-maximized': isMaximized, 'is-entered': isEntered }"
    :style="windowColorStyle"
  >
    <div class="window-drag-region" aria-hidden="true" data-tauri-drag-region @mousedown="handleDragStart"></div>

    <div class="window-controls">
      <button
        v-if="isToolkit()"
        class="window-control pin-btn"
        :class="{ active: isAlwaysOnTop }"
        :aria-label="isAlwaysOnTop ? '取消窗口置顶' : '窗口置顶'"
        :data-tooltip="isAlwaysOnTop ? '取消窗口置顶' : '窗口置顶'"
        @click="toggleAlwaysOnTop"
      >
        <Pin class="window-control-icon pin-icon" />
      </button>
      <button
        class="window-control minimize-btn"
        aria-label="最小化到任务栏"
        data-tooltip="最小化到任务栏"
        @click="minimizeWindow"
      >
        <Minus class="window-control-icon minimize-icon" />
      </button>
      <button
        class="window-control maximize-btn"
        :class="{ active: isMaximized }"
        :aria-label="isMaximized ? '向下还原' : '最大化'"
        :data-tooltip="isMaximized ? '向下还原' : '最大化'"
        @click="toggleMaximize"
      >
        <Copy v-if="isMaximized" class="window-control-icon restore-icon" />
        <Square v-else class="window-control-icon maximize-icon" />
      </button>
      <button
        class="window-control close-btn"
        aria-label="关闭便签"
        data-tooltip="关闭便签"
        @click="closeWindow"
      >
        <X class="window-control-icon" />
      </button>
    </div>

    <div v-if="isReady && note" class="note-window-content">
      <NoteCard :note="note" :is-full-screen="true" />
    </div>

    <div v-else-if="isReady" class="note-missing-state">
      <p>便签不存在或已被删除</p>
      <button class="close-missing-btn" @click="closeWindow">
        关闭
      </button>
    </div>

    <Toast />
    <ConfirmModal />
    <ImagePreviewModal />
  </main>
</template>

<style lang="scss" scoped>
:global(html.detached-note-window),
:global(body.detached-note-window) {
  background: transparent !important;
  background-color: transparent !important;
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: none !important;
}

:global(#moment-notes-app-root) {
  background: transparent !important;
  background-color: transparent !important;
  box-sizing: border-box;
  padding: 0;
  margin: 0;
  width: 100%;
  height: 100%;
}

.detached-note-shell {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  border-radius: $window-radius;
  box-sizing: border-box;
  background: var(--detached-note-bg);
  border: 1px solid var(--detached-note-border);
  color: var(--text-primary);
  box-shadow: none;
  opacity: 0;
  transform: scale(0.94);
  transform-origin: center center;
  transition:
    border-radius 0.15s ease,
    border-color 0.15s ease,
    opacity $transition-slow,
    transform $transition-bounce;

  &.is-entered {
    opacity: 1;
    transform: scale(1);
  }

  &.is-maximized {
    border-radius: 0;
    border: none;
    box-shadow: none;
    opacity: 1;
    transform: none;
  }

  .dark-theme &,
  &.dark-theme {
    background: var(--detached-note-bg-dark);
    border-color: var(--detached-note-border-dark);
    box-shadow: none;

    &.is-maximized {
      border: none;
      box-shadow: none;
    }
  }
}

.window-drag-region {
  position: absolute;
  inset: 0 160px auto 0;
  height: 42px;
  z-index: 120;
  -webkit-app-region: drag;
}

.window-controls {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 130;
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.window-control {
  width: 28px;
  height: 28px;
  padding: 6px;
  border-radius: $radius-round;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--detached-note-border);
  color: var(--detached-note-text);
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.2s, color 0.2s;

  .dark-theme & {
    background: var(--detached-note-border-dark);
    color: var(--detached-note-text-dark);
  }

  &.pin-btn {
    &:hover {
      transform: scale(1.1) rotate(15deg);
      background: var(--detached-note-btn-hover-bg);
      color: var(--detached-note-btn-hover-color);

      .dark-theme & {
        background: var(--detached-note-btn-hover-bg-dark);
        color: var(--detached-note-btn-hover-color-dark);
      }
    }

    &.active {
      transform: scale(1.05);
      background: var(--detached-note-btn-hover-bg);
      color: var(--detached-note-btn-hover-color);

      .dark-theme & {
        background: var(--detached-note-btn-hover-bg-dark);
        color: var(--detached-note-btn-hover-color-dark);
      }

      .pin-icon {
        transform: rotate(45deg);
        fill: currentColor;
      }
    }
  }

  &.minimize-btn,
  &.maximize-btn {
    &:hover {
      transform: scale(1.1);
      background: var(--detached-note-btn-hover-bg);
      color: var(--detached-note-btn-hover-color);

      .dark-theme & {
        background: var(--detached-note-btn-hover-bg-dark);
        color: var(--detached-note-btn-hover-color-dark);
      }
    }
  }

  &.close-btn {
    &:hover {
      transform: scale(1.1);
      background: var(--danger-hover-bg);
      color: var(--danger-color);
    }
  }
}

.window-control-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.note-window-content {
  width: 100%;
  height: 100%;
}

.note-window-content :deep(.note-card.is-full-screen) {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  background: transparent !important;
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  padding-top: 48px;
}

.note-window-content :deep(.absolute-edit-btn) {
  top: 46px;
}

.note-missing-state {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
}

.close-missing-btn {
  padding: 7px 16px;
  border-radius: 7px;
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--text-primary);

  &:hover {
    background: var(--btn-hover-bg);
    border-color: var(--btn-hover-border);
  }
}
</style>
