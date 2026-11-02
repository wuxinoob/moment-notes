<script lang="ts" setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { Note } from '@type';
import { useStickyNotesStore, COLOR_PRESETS } from '@stores/stickyNotes';
import NoteCardHeader from './NoteCardHeader.vue';
import NoteCardBody from './NoteCardBody.vue';
import NoteCardTagEditor from './NoteCardTagEditor.vue';
import NoteCardFooter from './NoteCardFooter.vue';
import { getContainerSelectedText } from '@utils/selection';
import { executeDoubleClickNoteAction } from '../../domain/noteInteractions/DoubleClickNoteActionRegistry';

const props = withDefaults(
  defineProps<{
    note: Note;
    isFullScreen?: boolean;
    isImmersiveFullScreen?: boolean;
  }>(),
  {
    isFullScreen: false,
    isImmersiveFullScreen: false
  }
);

const store = useStickyNotesStore();

// 是否处于编辑模式
const isEditing = ref(false);
const editTitle = ref(props.note.title || '');
const editContent = ref(props.note.content);
const editTags = ref<string[]>([]);

// 子组件 Ref 引用
const bodyRef = ref<InstanceType<typeof NoteCardBody> | null>(null);
const tagEditorRef = ref<InstanceType<typeof NoteCardTagEditor> | null>(null);
const footerRef = ref<InstanceType<typeof NoteCardFooter> | null>(null);

const handleAddAttachment = () => {
  bodyRef.value?.triggerFileInput();
};

// 是否有处于激活状态的下拉面板 (如颜色选择、分类移动等)
const hasActivePopover = ref(false);
const handlePopoverStateChange = (isOpen: boolean) => {
  hasActivePopover.value = isOpen;
};

// 获取当前便签颜色的样式配置
const colorStyle = computed(() => {
  const preset = COLOR_PRESETS[props.note.color] || COLOR_PRESETS.yellow;
  return {
    '--card-bg': preset.lightBg,
    '--card-border': preset.lightBorder,
    '--card-text': preset.lightText,
    '--card-bg-dark': preset.darkBg,
    '--card-border-dark': preset.darkBorder,
    '--card-text-dark': preset.darkText,
    '--card-btn-hover-bg': preset.lightBtnHoverBg,
    '--card-btn-hover-color': preset.lightBtnHoverColor,
    '--card-btn-hover-bg-dark': preset.darkBtnHoverBg,
    '--card-btn-hover-color-dark': preset.darkBtnHoverColor
  };
});

// 进入编辑模式
const enterEditMode = () => {
  if (!props.isFullScreen && store.defaultEditMode === 'fullscreen') {
    store.editingNoteId = props.note.id;
    store.openedFullscreenForEditNoteId = props.note.id;
    store.openNotePreview(props.note.id);
    return;
  }
  isEditing.value = true;
  editTitle.value = props.note.title || '';
  editContent.value = props.note.content;
  editTags.value = props.note.tags ? [...props.note.tags] : [];
  store.editingNoteId = props.note.id;
};

// 保存编辑
const saveEdit = () => {
  tagEditorRef.value?.addTag();

  const titleChanged = editTitle.value.trim() !== (props.note.title || '').trim();
  const contentChanged = editContent.value !== props.note.content;
  const originalTags = props.note.tags || [];
  const tagsChanged =
    editTags.value.length !== originalTags.length ||
    !editTags.value.every((t, i) => t === originalTags[i]);

  if (titleChanged || contentChanged || tagsChanged) {
    store.updateNote(props.note.id, {
      title: editTitle.value.trim(),
      content: editContent.value,
      tags: [...editTags.value]
    });
    isEditing.value = false;
  } else {
    cancelEdit();
    return;
  }

  if (store.editingNoteId === props.note.id) {
    store.editingNoteId = null;
  }

  if (store.openedFullscreenForEditNoteId === props.note.id) {
    store.closeNotePreview();
  }
};

// 取消编辑
const cancelEdit = () => {
  isEditing.value = false;
  editTitle.value = props.note.title || '';
  editContent.value = props.note.content;
  editTags.value = [];

  if (store.editingNoteId === props.note.id) {
    store.editingNoteId = null;
  }

  if (store.openedFullscreenForEditNoteId === props.note.id) {
    store.closeNotePreview();
  }
};

const handleSwitchToMarkdown = () => {
  if (props.note.type !== 'markdown') {
    store.updateNote(props.note.id, { type: 'markdown' }, false);
  }
};

// 切换全屏显示/收起 (若处于编辑状态则先保存当前编辑)
const handleTogglePreview = () => {
  const wasOpenedForEdit = store.openedFullscreenForEditNoteId === props.note.id;
  if (isEditing.value) {
    saveEdit();
  }
  if (!wasOpenedForEdit) {
    store.toggleNotePreview(props.note.id);
  }
};

// 划词结束 200ms 防抖自动复制逻辑
let autoCopyTimer: number | null = null;
let lastAutoCopiedText = '';

const handleSelectionChange = () => {
  if (!store.enableAutoCopySelection || isEditing.value || props.note.isDeleted) return;

  const selectedText = getContainerSelectedText(cardRef.value);

  if (!selectedText) {
    if (autoCopyTimer) {
      clearTimeout(autoCopyTimer);
      autoCopyTimer = null;
    }
    lastAutoCopiedText = '';
    return;
  }

  if (selectedText === lastAutoCopiedText) return;

  if (autoCopyTimer) {
    clearTimeout(autoCopyTimer);
  }

  autoCopyTimer = window.setTimeout(async () => {
    autoCopyTimer = null;
    const currentText = getContainerSelectedText(cardRef.value);
    if (!currentText || currentText !== selectedText) return;

    lastAutoCopiedText = currentText;
    try {
      await navigator.clipboard.writeText(currentText);
      store.updateNoteLastUsed(props.note.id);
    } catch (err) {
      console.error('Auto copy failed:', err);
    }
  }, 200);
};

const handleDoubleClick = () => {
  if (isEditing.value) return;

  executeDoubleClickNoteAction(store.doubleClickNoteAction, {
    copyAndPaste: () => store.handlePasteNote(props.note.content, props.note.id),
    openFullscreen: handleTogglePreview,
    deleteNote: () => store.deleteNote(props.note.id)
  });
};

// 切换置顶
const togglePin = () => {
  if (props.note.isDeleted) return;
  store.updateNote(
    props.note.id,
    {
      isPinned: !props.note.isPinned
    },
    false
  );
  store.showToast(props.note.isPinned ? '便签已置顶' : '取消置顶');
};

// 拖拽排序逻辑 (基于现代化 Pointer Events 引擎，完美适配 WebView2 / Tauri 窗口)
let pointerDownX = 0;
let pointerDownY = 0;
let cardInitialRect: DOMRect | null = null;
let pointerOffsetX = 0;
let pointerOffsetY = 0;
let isPointerActive = false;
let isDragSessionStarted = false;
let ghostElement: HTMLElement | null = null;
let lastPinnedWarningTime = 0;

const cleanupDragSession = () => {
  if (ghostElement) {
    if (ghostElement.parentNode) {
      ghostElement.parentNode.removeChild(ghostElement);
    }
    ghostElement = null;
  }

  if (store.draggedNoteId === props.note.id) {
    store.draggedNoteId = null;
  }

  isPointerActive = false;
  isDragSessionStarted = false;
  cardInitialRect = null;

  document.body.style.userSelect = '';
  document.body.style.cursor = '';

  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerUp);
  window.removeEventListener('pointercancel', onGlobalPointerUp);
  window.removeEventListener('mouseup', onGlobalPointerUp);
  window.removeEventListener('blur', onGlobalPointerUp);
  window.removeEventListener('keydown', onGlobalKeyDown);
};

const onGlobalKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isDragSessionStarted) {
    cleanupDragSession();
  }
};

const handlePointerDown = (e: PointerEvent) => {
  // 仅响应鼠标左键或触控主按键
  if (e.button !== 0) return;
  if (isEditing.value || props.note.isDeleted || props.isFullScreen || store.currentCategoryId === 'recent') {
    return;
  }

  if (!cardRef.value) return;

  isPointerActive = true;
  isDragSessionStarted = false;
  pointerDownX = e.clientX;
  pointerDownY = e.clientY;

  cardInitialRect = cardRef.value.getBoundingClientRect();
  pointerOffsetX = e.clientX - cardInitialRect.left;
  pointerOffsetY = e.clientY - cardInitialRect.top;

  window.addEventListener('pointermove', onGlobalPointerMove, { passive: false });
  window.addEventListener('pointerup', onGlobalPointerUp);
  window.addEventListener('pointercancel', onGlobalPointerUp);
  window.addEventListener('mouseup', onGlobalPointerUp);
  window.addEventListener('blur', onGlobalPointerUp);
  window.addEventListener('keydown', onGlobalKeyDown);
};

const onGlobalPointerMove = (e: PointerEvent) => {
  if (!isPointerActive) return;

  const moveDistance = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);

  // 1. 未触发拖拽前：必须位移超过 5px 才正式激活拖拽，杜绝点按误触与虚化
  if (!isDragSessionStarted) {
    if (moveDistance < 5) return;

    isDragSessionStarted = true;

    // 若当前非自定义排序，必须将当前视图顺序固化为自定义基础排序
    if (store.sortMode !== 'custom') {
      store.solidifyCurrentOrderAsCustom(store.filteredNotes);
      store.showToast('已自动切换为自定义排序，可自由拖拽调整顺序', 'info');
    }

    // 设置全局拖拽 ID，使原卡片变为虚化占位符
    store.draggedNoteId = props.note.id;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    // 2. 创建真实可见的 DOM 浮动 Ghost 节点
    if (cardRef.value && cardInitialRect) {
      const ghost = cardRef.value.cloneNode(true) as HTMLElement;
      ghost.classList.remove('dragging');
      ghost.classList.add('note-card-drag-ghost');

      // 移除 ghost 内多余事件或 ID，保证纯视觉跟随
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));

      ghost.style.position = 'fixed';
      ghost.style.width = `${cardInitialRect.width}px`;
      ghost.style.height = `${cardInitialRect.height}px`;
      ghost.style.left = `${e.clientX - pointerOffsetX}px`;
      ghost.style.top = `${e.clientY - pointerOffsetY}px`;
      ghost.style.margin = '0';
      ghost.style.zIndex = '999999';
      ghost.style.pointerEvents = 'none';
      ghost.style.touchAction = 'none';
      ghost.style.userSelect = 'none';
      ghost.style.cursor = 'grabbing';
      ghost.style.setProperty('--card-max-height', `${store.noteMaxHeight}px`);

      document.body.appendChild(ghost);
      ghostElement = ghost;
    }
  }

  e.preventDefault();

  // 3. 实时更新 Ghost 绝对位置
  if (ghostElement) {
    ghostElement.style.left = `${e.clientX - pointerOffsetX}px`;
    ghostElement.style.top = `${e.clientY - pointerOffsetY}px`;
  }

  // 4. 碰撞检测与换位
  if (store.sortMode !== 'custom') return;

  // 通过 elementFromPoint 穿透 ghost（因 ghost 具有 pointer-events: none）精准捕获鼠标底下的目标卡片
  const underElement = document.elementFromPoint(e.clientX, e.clientY);
  const targetCardElement = underElement?.closest('.note-card[data-note-id]') as HTMLElement | null;
  if (!targetCardElement) return;

  const targetId = targetCardElement.getAttribute('data-note-id');
  if (!targetId || targetId === props.note.id) return;

  const dragIndex = store.filteredNotes.findIndex(n => n.id === props.note.id);
  const hoverIndex = store.filteredNotes.findIndex(n => n.id === targetId);
  if (dragIndex === -1 || hoverIndex === -1) return;

  const targetNote = store.filteredNotes[hoverIndex];
  // 置顶与非置顶便签不允许跨组交换，跨越边界时给予友好提示
  if (targetNote.isPinned !== props.note.isPinned) {
    const now = Date.now();
    if (now - lastPinnedWarningTime > 2500) {
      lastPinnedWarningTime = now;
      store.showToast(
        props.note.isPinned
          ? '置顶便签仅支持在置顶区域内调整顺序'
          : '普通便签无法直接插入置顶区域',
        'info'
      );
    }
    return;
  }

  const targetRect = targetCardElement.getBoundingClientRect();
  const currentCardRect = cardRef.value ? cardRef.value.getBoundingClientRect() : cardInitialRect;

  let shouldSwap = false;
  if (currentCardRect) {
    const isTargetBelow = targetRect.top > currentCardRect.top + 30;
    const isTargetAbove = targetRect.top < currentCardRect.top - 30;

    if (isTargetBelow) {
      shouldSwap = e.clientY > targetRect.top + 25;
    } else if (isTargetAbove) {
      shouldSwap = e.clientY < targetRect.bottom - 25;
    } else {
      // 同一行横向拖拽
      if (dragIndex < hoverIndex) {
        shouldSwap = e.clientX > targetRect.left + (targetRect.width * 0.35);
      } else {
        shouldSwap = e.clientX < targetRect.right - (targetRect.width * 0.35);
      }
    }
  } else {
    const midX = targetRect.left + targetRect.width / 2;
    const midY = targetRect.top + targetRect.height / 2;
    if (dragIndex < hoverIndex) {
      shouldSwap = e.clientX > midX || e.clientY > midY;
    } else {
      shouldSwap = e.clientX < midX || e.clientY < midY;
    }
  }

  if (shouldSwap) {
    store.moveNote(props.note.id, targetId);
  }
};

const onGlobalPointerUp = () => {
  cleanupDragSession();
};

// 鼠标移出卡片时，自动关闭已打开的选择面板
const handleMouseLeave = () => {
  footerRef.value?.closePopovers();
};

// 点击卡片其他区域时，马上收起已打开的选择面板
const handleCardClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (target && !target.closest('.base-popover-wrapper') && !target.closest('.action-popover-wrapper')) {
    footerRef.value?.closePopovers();
  }
};

// 用于判断外部点击的 Ref 引用
const cardRef = ref<HTMLElement | null>(null);

let mousedownTarget: Node | null = null;

const handleMousedown = (event: MouseEvent) => {
  mousedownTarget = event.target as Node;
};

const handleClickOutside = (event: MouseEvent) => {
  if (!isEditing.value || !cardRef.value) return;

  const clickTarget = event.target as Node;
  const isMousedownInside = cardRef.value.contains(mousedownTarget);
  const isClickInside = cardRef.value.contains(clickTarget);

  if (!isMousedownInside && !isClickInside) {
    saveEdit();
  }
};

watch(isEditing, editing => {
  if (editing) {
    nextTick(() => {
      document.addEventListener('mousedown', handleMousedown, true);
      document.addEventListener('click', handleClickOutside, true);
    });
  } else {
    document.removeEventListener('mousedown', handleMousedown, true);
    document.removeEventListener('click', handleClickOutside, true);
    mousedownTarget = null;
  }
});

onBeforeUnmount(() => {
  cleanupDragSession();
  if (autoCopyTimer) {
    clearTimeout(autoCopyTimer);
    autoCopyTimer = null;
  }
  if (isEditing.value) {
    saveEdit();
  }
  if (store.editingNoteId === props.note.id) {
    store.editingNoteId = null;
  }
  document.removeEventListener('mousedown', handleMousedown, true);
  document.removeEventListener('click', handleClickOutside, true);
  document.removeEventListener('selectionchange', handleSelectionChange);
});

const cardMaxHeightStyle = computed(() => {
  return {
    '--card-max-height': `${store.noteMaxHeight}px`
  };
});

onMounted(() => {
  document.addEventListener('selectionchange', handleSelectionChange);
  if (store.editingNoteId === props.note.id) {
    enterEditMode();
  }
});
</script>

<template>
  <div
    ref="cardRef"
    class="note-card"
    :data-note-id="note.id"
    :class="{
      pinned: note.isPinned,
      editing: isEditing,
      dragging: store.draggedNoteId === note.id,
      'is-in-trash': note.isDeleted,
      'has-active-popover': hasActivePopover,
      'enable-hover-anim': store.enableHoverAnimation && !isFullScreen && store.draggedNoteId !== note.id,
      'is-full-screen': isFullScreen,
      'is-immersive-full-screen': isFullScreen && isImmersiveFullScreen
    }"
    :style="[colorStyle, cardMaxHeightStyle]"
    @dblclick="handleDoubleClick"
    @mouseleave="handleMouseLeave"
    @click.capture="handleCardClick"
  >
    <!-- 拖拽手柄区域 (现代化 Pointer Events 拖拽，支持平滑跟随与排序) -->
    <div
      v-if="!isEditing && !note.isDeleted && !isFullScreen && store.currentCategoryId !== 'recent'"
      class="note-drag-handle"
      data-tooltip="按住拖动调整位置"
      @pointerdown="handlePointerDown"
      @dblclick.stop
    ></div>

    <NoteCardHeader
      v-model:title="editTitle"
      :note="note"
      :is-editing="isEditing"
      :is-full-screen="isFullScreen"
      :is-immersive-full-screen="isFullScreen && isImmersiveFullScreen"
      @toggle-pin="togglePin"
      @enter-edit="enterEditMode"
      @save-edit="saveEdit"
      @cancel-edit="cancelEdit"
      @toggle-preview="handleTogglePreview"
    />

    <NoteCardBody
      ref="bodyRef"
      v-model:content="editContent"
      :note="note"
      :is-editing="isEditing"
      :is-full-screen="isFullScreen"
      @cancel-edit="cancelEdit"
      @save-edit="saveEdit"
      @switch-to-markdown="handleSwitchToMarkdown"
    />

    <NoteCardTagEditor v-if="isEditing" ref="tagEditorRef" v-model:tags="editTags" />

    <NoteCardFooter
      ref="footerRef"
      :note="note"
      :is-editing="isEditing"
      @save-edit="saveEdit"
      @cancel-edit="cancelEdit"
      @add-attachment="handleAddAttachment"
      @popover-state-change="handlePopoverStateChange"
    />
  </div>
</template>

<style lang="scss" scoped src="./NoteCard.scss"></style>
