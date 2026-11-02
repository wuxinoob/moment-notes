<script lang="ts" setup>
import { ref } from 'vue';
import { useStickyNotesStore } from '@stores/stickyNotes';
import { Settings, X } from '@lucide/vue';
import { dragCurrentWindow } from '@utils/windowControls';
import { useSidebarResize } from '@utils/useSidebarResize';
import logoUrl from '@/assets/logo.png';
import CategoryList from './CategoryList.vue';
import CategoryAdd from './CategoryAdd.vue';

const store = useStickyNotesStore();
const isAddingCategory = ref(false);

const handleHeaderDrag = (e: MouseEvent) => {
  dragCurrentWindow(e);
};

// 侧边栏拖拽尺寸与持久化
const { sidebarWidth, isResizing, startResize } = useSidebarResize();
</script>

<template>
  <aside
    class="sidebar-container"
    :class="{ 'mobile-open': store.isMobileSidebarOpen }"
    :style="{ width: sidebarWidth + 'px' }"
  >
    <div class="sidebar-header" data-tauri-drag-region @mousedown="handleHeaderDrag">
      <div class="sidebar-brand" data-tauri-drag-region>
        <img :src="logoUrl" class="logo" alt="logo" data-tauri-drag-region />
        <h2 class="header-title" data-tauri-drag-region>
          拾光便签
        </h2>
      </div>
      <button
        class="mobile-sidebar-close"
        aria-label="关闭侧边栏"
        @click="store.closeMobileSidebar"
      >
        <X class="close-icon" />
      </button>
    </div>

    <!-- 分类列表区域 -->
    <CategoryList />

    <!-- 侧边栏底部操作区 -->
    <div class="sidebar-footer">
      <div class="sidebar-footer-actions">
        <!-- 添加分类组件 -->
        <CategoryAdd v-model:is-adding="isAddingCategory" class="category-add-wrapper" />

        <!-- 设置按钮 (带微动效) -->
        <button
          class="settings-btn"
          :class="{ 'is-hidden': isAddingCategory }"
          data-tooltip="打开设置"
          @click="store.openSettings()"
        >
          <Settings class="settings-btn-icon" />
        </button>
      </div>
    </div>

    <!-- 拖拽调整宽度的手柄 -->
    <div class="resize-handle" :class="{ resizing: isResizing }" @mousedown="startResize"></div>
  </aside>
</template>

<style lang="scss" scoped>
.sidebar-container {
  height: 100%;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--panel-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}

.sidebar-header {
  padding: 18px;
  padding-bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  -webkit-app-region: drag;
  user-select: none;

  .sidebar-brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo {
    width: 30px;
    height: 30px;
    color: var(--accent-color);
  }

  .header-title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: 0.5px;
  }
}

.mobile-sidebar-close {
  display: none;
}

.sidebar-footer {
  padding: 16px 12px;
  -webkit-app-region: no-drag !important;
  // border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.sidebar-footer-actions {
  display: flex;
  align-items: center;
  width: 100%;
}

.category-add-wrapper {
  flex: 1;
}

.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--text-muted);
  cursor: pointer;
  transition:
    width 0.25s cubic-bezier(0.16, 1, 0.3, 1),
    margin-left 0.25s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1),
    background-color 0.25s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.25s cubic-bezier(0.16, 1, 0.3, 1),
    color 0.25s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
  margin-left: 8px;
  overflow: hidden;

  &:hover {
    background: var(--btn-hover-bg);
    color: var(--accent-color);
    border-color: var(--btn-hover-border);

    .settings-btn-icon {
      transform: rotate(45deg);
    }
  }

  .settings-btn-icon {
    width: 16px;
    height: 16px;
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  &.is-hidden {
    width: 0;
    margin-left: 0;
    opacity: 0;
    border-color: transparent;
    pointer-events: none;
  }
}

.resize-handle {
  position: absolute;
  top: 0;
  right: -5px;
  width: 10px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  display: flex;
  justify-content: center;
  -webkit-app-region: no-drag !important;

  &::after {
    content: '';
    width: 3px;
    height: 100%;
    background-color: transparent;
    transition: background-color 0.2s ease;
  }

  &:hover::after,
  &.resizing::after {
    background-color: var(--accent-color);
  }
}

@media (max-width: $screen-compact) {
  .sidebar-header {
    padding: 14px;
    padding-bottom: 0;
    gap: 8px;
  }

  .sidebar-footer {
    padding: 12px 8px;
  }

  .settings-btn {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    margin-left: 6px;

    .settings-btn-icon {
      width: 14px;
      height: 14px;
    }
  }
}

@media (max-width: $screen-mobile) {
  .sidebar-container {
    position: fixed !important;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(300px, 82vw) !important;
    height: 100% !important;
    z-index: $z-index-modal-level1 !important;
    transform: translateX(-100%);
    transition: transform $transition-normal;
    box-shadow: none;
    background: var(--drawer-bg, rgba(18, 24, 38, 0.95)) !important;
    backdrop-filter: var(--glass-blur-heavy, blur(28px) saturate(190%));
    -webkit-backdrop-filter: var(--glass-blur-heavy, blur(28px) saturate(190%));
    border-right: 1px solid var(--panel-border);

    &.mobile-open {
      transform: translateX(0);
      box-shadow: 0 0 40px rgba(0, 0, 0, 0.55);
    }
  }

  .sidebar-header {
    padding: 16px 14px 12px 14px;
  }

  .mobile-sidebar-close {
    display: flex !important;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: var(--btn-bg);
    border: 1px solid var(--btn-border);
    color: var(--text-muted);
    cursor: pointer;
    transition: background-color 0.2s, color 0.2s;

    &:hover,
    &:active {
      background: var(--btn-hover-bg);
      color: var(--text-primary);
    }

    .close-icon {
      width: 16px;
      height: 16px;
    }
  }

  .resize-handle {
    display: none !important;
  }
}
</style>
