<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useStickyNotesStore } from '@stores/stickyNotes';
import { Plus, Trash2, Sun, Moon, Cloud, RefreshCw, Pin, PinOff, Menu } from '@lucide/vue';
import { isIndependentWindow, isWindowPinned, toggleWindowPin, dragCurrentWindow } from '@utils/windowControls';
import { webdavSyncEngine } from '../../infrastructure/sync/WebdavSyncEngine';
import SearchSection from './SearchSection.vue';
import SortPopover from './SortPopover.vue';
import GridColumnsPopover from './GridColumnsPopover.vue';

const store = useStickyNotesStore();

// 移动端当前分类显示名称
const currentCategoryDisplayName = computed(() => {
  if (store.currentCategoryId === 'all') return '全部便签';
  if (store.currentCategoryId === 'recent') return '最近使用';
  if (store.currentCategoryId === 'trash') return '最近删除';
  const found = store.categories.find(c => c.id === store.currentCategoryId);
  return found ? found.name : '全部便签';
});

// 独立窗口状态与窗口控制
const isWindow = computed(() => isIndependentWindow());

const pinTooltip = computed(() => {
  return isWindowPinned.value
    ? '已置顶固定 (失焦不隐藏，点击取消置顶)'
    : '未置顶 (点击其他地方自动隐藏，点击置顶固定)';
});

const handleTogglePin = async () => {
  await toggleWindowPin();
  store.showToast(isWindowPinned.value ? '已置顶固定 (失焦不隐藏)' : '已取消置顶 (点击外部自动隐藏)');
};

const handleContainerDrag = (e: MouseEvent) => {
  if (e.target === e.currentTarget) {
    dragCurrentWindow(e);
  }
};

// 当前处于展开状态的下拉菜单：'sort' | 'columns' | null
const activePopover = ref<'sort' | 'columns' | null>(null);

const togglePopover = (type: 'sort' | 'columns') => {
  activePopover.value = activePopover.value === type ? null : type;
};

const closePopover = () => {
  activePopover.value = null;
};

// 动态清空按钮的提示文字
const clearTooltip = computed(() => {
  if (store.currentCategoryId === 'trash') {
    return '清空便签';
  }
  return store.currentCategoryId === 'all' ? '清空所有便签' : '清空当前分类便签';
});

const webdavConfig = webdavSyncEngine.config;
const webdavSyncState = webdavSyncEngine.syncState;

const webdavTooltip = computed(() => {
  if (!webdavConfig.value.enabled) return 'WebDAV 未启用 (前往设置开启)';
  if (webdavSyncState.value === 'syncing') return '正在同步中...';
  if (webdavSyncState.value === 'error') return `同步异常: ${webdavConfig.value.lastSyncMessage || '点击重试'}`;
  const timeStr = webdavConfig.value.lastSyncTime ? new Date(webdavConfig.value.lastSyncTime).toLocaleTimeString() : '尚未同步';
  return `WebDAV 已就绪 (上次同步: ${timeStr}，点击立即同步)`;
});

const handleWebdavSync = async () => {
  if (!webdavConfig.value.enabled) {
    store.openSettings();
    return;
  }
  const res = await store.syncWithWebdav();
  if (res.success) {
    store.showToast('✅ WebDAV 同步成功！');
  } else {
    store.showToast(`❌ ${res.message}`);
  }
};

// 初始化主题与事件监听
onMounted(() => {
  // 监听全局点击以关闭所有下拉菜单
  document.addEventListener('click', closePopover);

  // 初始化主题并自动读取存储/系统设置
  store.initTheme();
});

onUnmounted(() => {
  document.removeEventListener('click', closePopover);
});

// 清空当前分类便签
const handleClear = async () => {
  if (store.currentCategoryId === 'trash') {
    const ok = await store.askConfirm(
      '确认清空便签吗？',
      '⚠️ 警告：清空便签将彻底从设备删除其中所有的便签，此操作不可逆，数据无法找回！'
    );
    if (ok) {
      store.clearTrash();
    }
    return;
  }

  const currentCat = store.categories.find(c => c.id === store.currentCategoryId);
  const catName = store.currentCategoryId === 'all'
    ? '"全部便签"'
    : (currentCat ? `"${currentCat.name}"` : '当前分类');

  const ok = await store.askConfirm(
    '确认删除便签',
    `⚠️ 警告：确定要清空 ${catName} 下的所有便签吗？这些便签将被移动到最近删除。`
  );
  if (ok) {
    store.clearNotes(store.currentCategoryId);
    store.showToast('已将所有便签移至最近删除');
  }
};

// 创建新便签
const handleAddNote = () => {
  // 创建一个空便签，放在最前端
  store.addNote(store.currentCategoryId, '', '');
  store.showToast('已新建空便签，可以直接编辑');
};
</script>

<template>
  <div class="action-bar-container" data-tauri-drag-region @mousedown="handleContainerDrag">
    <!-- 移动端分类抽屉触发按钮 + 当前分类名 (桌面端隐藏) -->
    <button
      class="mobile-category-trigger"
      aria-label="打开分类菜单"
      data-tooltip="打开分类菜单"
      @click="store.toggleMobileSidebar"
    >
      <Menu class="mobile-menu-icon" />
      <span class="mobile-category-name">{{ currentCategoryDisplayName }}</span>
    </button>

    <!-- 搜索区域 -->
    <SearchSection />

    <!-- 按钮操作区 -->
    <div class="actions-wrapper">
      <!-- WebDAV 云同步快捷按钮 -->
      <button
        v-if="webdavConfig.enabled"
        class="icon-btn webdav-sync-btn"
        :class="webdavSyncState"
        :data-tooltip="webdavTooltip"
        :disabled="webdavSyncState === 'syncing'"
        @click="handleWebdavSync"
      >
        <RefreshCw v-if="webdavSyncState === 'syncing'" class="btn-icon spin" />
        <Cloud v-else class="btn-icon" />
      </button>

      <!-- 切换主题 (移动端在底栏展示) -->
      <button
        v-if="store.enabledActionBarButtons.includes('theme-toggle')"
        class="icon-btn theme-toggle desktop-only-action"
        data-tooltip="切换主题"
        @click="store.toggleTheme"
      >
        <Sun v-if="store.isDark" class="btn-icon" />
        <Moon v-else class="btn-icon" />
      </button>

      <!-- 排序选择 (移动端在底栏展示) -->
      <SortPopover
        v-if="store.enabledActionBarButtons.includes('sort-select')"
        class="desktop-only-action"
        :is-open="activePopover === 'sort'"
        @toggle="togglePopover('sort')"
        @close="closePopover"
      />

      <!-- 列数设置 (桌面端顶栏快速切换，移动端可在设置中统一调整) -->
      <GridColumnsPopover
        v-if="store.enabledActionBarButtons.includes('columns-select')"
        class="desktop-only-action"
        :is-open="activePopover === 'columns'"
        @toggle="togglePopover('columns')"
        @close="closePopover"
      />

      <!-- 清空当前分类 (垃圾箱分类和最近使用分类下隐藏) -->
      <button
        v-if="store.currentCategoryId !== 'trash' && store.currentCategoryId !== 'recent' && store.enabledActionBarButtons.includes('clear-notes')"
        class="icon-btn danger"
        :disabled="store.filteredNotes.length === 0"
        :data-tooltip="clearTooltip"
        @click="handleClear"
      >
        <Trash2 class="btn-icon" />
      </button>

      <!-- 清空最近删除 (在垃圾箱分类下显示) -->
      <button
        v-if="store.currentCategoryId === 'trash' && store.enabledActionBarButtons.includes('clear-notes')"
        class="primary-btn danger-btn"
        :disabled="store.filteredNotes.length === 0"
        data-tooltip="清空便签"
        @click="handleClear"
      >
        <Trash2 class="btn-icon-plus" />
        <span>清空便签</span>
      </button>

      <!-- 新建便签 (移动端在底栏居中展示 FAB) -->
      <button
        v-if="store.currentCategoryId !== 'trash' && store.currentCategoryId !== 'recent'"
        class="primary-btn add-btn desktop-only-action"
        data-tooltip="新建便签"
        @click="handleAddNote"
      >
        <Plus class="btn-icon-plus" />
        <span>新建便签</span>
      </button>

      <!-- 独立窗口置顶固定按钮 (右上角关闭改为置顶pin) -->
      <div v-if="isWindow" class="window-control-wrapper">
        <div class="window-control-divider"></div>
        <button
          class="icon-btn window-pin-btn"
          :class="{ 'is-pinned': isWindowPinned }"
          :data-tooltip="pinTooltip"
          :title="pinTooltip"
          @click.stop="handleTogglePin"
        >
          <Pin v-if="isWindowPinned" class="btn-icon pinned" />
          <PinOff v-else class="btn-icon" />
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped src="./ActionBar.scss"></style>
