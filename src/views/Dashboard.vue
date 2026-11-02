<script lang="ts" setup>
import { onMounted, onUnmounted } from 'vue';
import { useStickyNotesStore } from '@stores/stickyNotes';
import { useShortcutStore } from '@stores/shortcutStore';
import CategorySidebar from '@modules/CategorySidebar/CategorySidebar.vue';
import ActionBar from '@modules/ActionBar/ActionBar.vue';
import NoteGrid from '@modules/NoteGrid.vue';
import Toast from '@components/Toast.vue';
import ConfirmModal from '@components/ConfirmModal.vue';
import SettingsModal from '@modules/SettingsModal/SettingsModal.vue';
import ExportModal from '@modules/DataModal/ExportModal.vue';
import ImportModal from '@modules/DataModal/ImportModal.vue';
import MobileBottomBar from '@modules/MobileBottomBar/MobileBottomBar.vue';


const store = useStickyNotesStore();
const shortcutStore = useShortcutStore();

const handleGlobalKeyDown = (e: KeyboardEvent) => {
  shortcutStore.handleKeyDown(e);
};

onMounted(() => {
  // 加载存储中的便签和分类数据
  store.loadData();

  // 监听全局快捷键 (开发者/键盘流效率增强)
  window.addEventListener('keydown', handleGlobalKeyDown);
});

onUnmounted(() => {
  // 注销全局监听，杜绝内存泄漏 (安全防线)
  window.removeEventListener('keydown', handleGlobalKeyDown);
});
</script>

<template>
  <div class="dashboard-layout">
    <!-- 移动端侧边栏半透明遮罩背景 -->
    <Transition name="drawer-fade">
      <div
        v-if="store.isMobileSidebarOpen"
        class="mobile-sidebar-backdrop"
        @click="store.closeMobileSidebar"
      ></div>
    </Transition>

    <!-- 左侧分类侧边栏 (移动端自适应为侧滑抽屉) -->
    <CategorySidebar />

    <!-- 右侧内容主面板 -->
    <main class="main-panel">
      <!-- 顶部操作条 -->
      <ActionBar />

      <!-- 便签网格内容区 (带切换过渡动画) -->
      <Transition name="fade-slide" mode="out-in">
        <NoteGrid v-if="store.isInitialized" :key="store.currentCategoryId" />
      </Transition>

      <!-- 方案 B：移动端底部集成操作栏 (Bottom App Bar) -->
      <MobileBottomBar />
    </main>

    <!-- 全局状态提示 -->
    <Toast />

    <!-- 全局确认弹窗 -->
    <ConfirmModal />

    <!-- 全局设置弹窗 -->
    <SettingsModal />

    <!-- 数据导出与导入弹窗 -->
    <ExportModal />
    <ImportModal />
  </div>
</template>

<style lang="scss" scoped>
.dashboard-layout {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
}

.main-panel {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.01);
  min-width: 0;
  position: relative;
}

.mobile-sidebar-backdrop {
  display: none;
}

@media (max-width: $screen-mobile) {
  .mobile-sidebar-backdrop {
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    z-index: calc(#{$z-index-modal-level1} - 1);
    cursor: pointer;
  }
}

/* 抽屉遮罩淡入淡出动画 */
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

/* 分类切换时的淡入淡出滑动过渡 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
