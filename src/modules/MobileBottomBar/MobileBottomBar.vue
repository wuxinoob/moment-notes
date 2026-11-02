<script lang="ts" setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useStickyNotesStore } from '@stores/stickyNotes';
import { Folder, Sun, Moon, Plus, Settings } from '@lucide/vue';
import SortPopover from '@modules/ActionBar/SortPopover.vue';

const store = useStickyNotesStore();

// 排序下拉弹窗激活状态
const isSortOpen = ref(false);

const toggleSort = () => {
  isSortOpen.value = !isSortOpen.value;
};

const closeSort = () => {
  isSortOpen.value = false;
};

// 新建便签
const handleAddNote = () => {
  store.addNote(store.currentCategoryId, '', '');
  store.showToast('已新建空便签，可以直接编辑');
};

onMounted(() => {
  document.addEventListener('click', closeSort);
});

onUnmounted(() => {
  document.removeEventListener('click', closeSort);
});
</script>

<template>
  <nav class="mobile-bottom-bar" @click.stop>
    <!-- 分类抽屉触发按钮 -->
    <button
      class="nav-tab-btn"
      :class="{ active: store.isMobileSidebarOpen }"
      @click="store.toggleMobileSidebar"
    >
      <Folder class="tab-icon" />
      <span class="tab-label">分类</span>
    </button>

    <!-- 排序方式弹窗 (向上弹出) -->
    <div class="nav-tab-wrapper">
      <SortPopover
        :is-open="isSortOpen"
        placement="top"
        @toggle="toggleSort"
        @close="closeSort"
      />
      <span class="tab-label">排序</span>
    </div>

    <!-- 居中高亮的新建便签大按钮 (FAB 黄金触控区) -->
    <div class="center-fab-wrapper">
      <button
        class="center-fab-btn"
        aria-label="新建便签"
        data-tooltip="新建便签"
        @click="handleAddNote"
      >
        <Plus class="fab-icon" />
      </button>
    </div>

    <!-- 主题切换 -->
    <button class="nav-tab-btn" @click="store.toggleTheme">
      <Sun v-if="store.isDark" class="tab-icon" />
      <Moon v-else class="tab-icon" />
      <span class="tab-label">{{ store.isDark ? '浅色' : '深色' }}</span>
    </button>

    <!-- 设置 -->
    <button class="nav-tab-btn" @click="store.openSettings">
      <Settings class="tab-icon" />
      <span class="tab-label">设置</span>
    </button>
  </nav>
</template>

<style lang="scss" scoped>
.mobile-bottom-bar {
  display: none;
}

@media (max-width: $screen-mobile) {
  .mobile-bottom-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: calc(56px + env(safe-area-inset-bottom, 0px));
    padding: 0 16px env(safe-area-inset-bottom, 0px) 16px;
    background: var(--dock-bg, rgba(18, 24, 38, 0.92));
    border-top: 1px solid var(--panel-border);
    backdrop-filter: var(--glass-blur-dock, blur(24px) saturate(180%));
    -webkit-backdrop-filter: var(--glass-blur-dock, blur(24px) saturate(180%));
    z-index: $z-index-popover;
    display: flex;
    align-items: center;
    justify-content: space-around;
    box-sizing: border-box;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.16);
  }

  .nav-tab-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    padding: 4px 10px;
    border-radius: 8px;
    cursor: pointer;
    min-width: 48px;
    transition: color 0.15s ease, transform 0.15s ease;

    &:active {
      transform: scale(0.92);
    }

    &.active {
      color: var(--accent-color);
    }

    .tab-icon {
      width: 19px;
      height: 19px;
    }
  }

  .nav-tab-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    position: relative;
    min-width: 48px;

    :deep(.icon-btn) {
      width: auto;
      height: auto;
      background: transparent;
      border: none;
      padding: 0;
      color: var(--text-secondary);

      &:hover {
        background: transparent;
      }

      &.active {
        color: var(--accent-color);
        background: transparent;
      }

      .btn-icon {
        width: 19px;
        height: 19px;
      }
    }
  }

  .tab-label {
    font-size: 10px;
    font-weight: 500;
    line-height: 1;
    color: inherit;
    user-select: none;
  }

  .center-fab-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    margin-top: -12px; // 略微向上突出，形成经典现代移动底栏 FAB
  }

  .center-fab-btn {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--accent-color);
    color: #ffffff;
    border: 3px solid var(--body-bg, #181b24);
    box-shadow: 0 4px 14px -2px rgba(99, 102, 241, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;

    &:active {
      transform: scale(0.9);
      box-shadow: 0 2px 8px -2px rgba(99, 102, 241, 0.4);
    }

    .fab-icon {
      width: 24px;
      height: 24px;
      stroke-width: 2.5;
    }
  }
}
</style>
