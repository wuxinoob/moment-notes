<script lang="ts" setup>
import { ref, watch, nextTick } from 'vue';
import { Note } from '@type';
import { useStickyNotesStore } from '@stores/stickyNotes';
import { useShortcutStore } from '@stores/shortcutStore';
import { useNoteTagMeasure } from '@utils/useNoteTagMeasure';
import { getFilesFromEvent, processAttachmentFile } from '@utils/imageHandler';
import MarkdownRenderer from './MarkdownRenderer.vue';

const props = withDefaults(
  defineProps<{
    note: Note;
    isEditing: boolean;
    isFullScreen?: boolean;
  }>(),
  {
    isFullScreen: false
  }
);

const content = defineModel<string>('content', { default: '' });

const emit = defineEmits<{
  (e: 'cancel-edit'): void;
  (e: 'save-edit'): void;
  (e: 'switch-to-markdown'): void;
}>();

const store = useStickyNotesStore();
const shortcutStore = useShortcutStore();

const contentInputRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const isDragOver = ref(false);

// 插入多个文件 (图片、音频、视频、文档附件)
const insertFiles = async (files: File[]) => {
  if (!files || files.length === 0) return;

  try {
    store.showToast(files.length > 1 ? `正在处理 ${files.length} 个附件...` : '正在处理附件...', 'info');

    const markdownSnippets: string[] = [];
    for (const file of files) {
      const result = await processAttachmentFile(file);
      markdownSnippets.push(result.markdownText);
    }
    const combinedMarkdown = markdownSnippets.join('\n');

    emit('switch-to-markdown');

    if (props.isEditing) {
      const textarea = contentInputRef.value;
      if (textarea) {
        const start = textarea.selectionStart ?? content.value.length;
        const end = textarea.selectionEnd ?? content.value.length;
        const currentVal = content.value || '';
        const newVal = currentVal.substring(0, start) + combinedMarkdown + currentVal.substring(end);
        content.value = newVal;

        await nextTick();
        const newCursorPos = start + combinedMarkdown.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        adjustTextareaHeight();
      } else {
        content.value = (content.value || '') + combinedMarkdown;
      }
    } else {
      // 浏览模式下直接向便签追加附件
      const updatedContent = (props.note.content ? `${props.note.content}\n` : '') + combinedMarkdown.trim();
      store.updateNote(props.note.id, {
        content: updatedContent,
        type: 'markdown'
      });
    }

    store.showToast(files.length > 1 ? `已插入 ${files.length} 个附件` : '附件已插入', 'success');
  } catch (err: any) {
    console.error('Failed to process files:', err);
    store.showToast(`附件处理失败: ${err.message || '未知异常'}`, 'error');
  }
};

// 触发隐藏的本地文件选择弹窗
const triggerFileInput = () => {
  if (typeof window !== 'undefined') {
    (window as any).__isFileDialogActive = true;
  }
  fileInputRef.value?.click();
};

const handleFileInputChange = async (e: Event) => {
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      (window as any).__isFileDialogActive = false;
    }, 500);
  }
  const input = e.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  const files = Array.from(input.files);
  input.value = ''; // 重置以支持重复选择相同文件
  await insertFiles(files);
};

const handleFileInputCancel = () => {
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      (window as any).__isFileDialogActive = false;
    }, 300);
  }
};

// 处理粘贴文件 (图片、音频、文档等)
const handlePaste = async (e: ClipboardEvent) => {
  const files = getFilesFromEvent(e);
  if (!files || files.length === 0) return;

  e.preventDefault();
  e.stopPropagation();
  await insertFiles(files);
};

// 处理拖拽文件悬浮
const handleDragOver = (e: DragEvent) => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    isDragOver.value = true;
  }
};

const handleDragLeave = (e: DragEvent) => {
  if (!e.currentTarget || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
    isDragOver.value = false;
  }
};

// 处理拖拽文件放下
const handleDrop = async (e: DragEvent) => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
    e.preventDefault();
    e.stopPropagation();
    isDragOver.value = false;
    const files = getFilesFromEvent(e);
    if (files.length > 0) {
      await insertFiles(files);
    }
  }
};

const handleKeyDown = (e: KeyboardEvent) => {
  const keyString = shortcutStore.getEventKeyString(e);
  if (!keyString) return;

  const matched = shortcutStore.shortcuts.find(s => s.currentKey === keyString);
  if (matched) {
    if (matched.id === 'saveEdit') {
      e.preventDefault();
      e.stopPropagation();
      emit('save-edit');
    } else if (matched.id === 'cancelEdit') {
      e.preventDefault();
      e.stopPropagation();
      emit('cancel-edit');
    }
  }
};

// 复制标签逻辑
const copyTag = async (tag: string) => {
  try {
    await navigator.clipboard.writeText(tag);
    store.showToast(`已复制标签: ${tag}`, 'success');
  } catch (err) {
    console.error('Failed to copy tag:', err);
    store.showToast('复制失败', 'error');
  }
};

// 自适应调整输入框高度
const adjustTextareaHeight = () => {
  const el = contentInputRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

// 提取的标签溢出测量 Hook
const {
  measureContainerRef,
  measureEllipsisRef,
  visibleTags,
  hasMore,
  allTagsText,
  calculateVisibleTags
} = useNoteTagMeasure(() => props.note);

// 监听编辑状态
watch(
  () => props.isEditing,
  async newVal => {
    if (newVal) {
      await nextTick();
      contentInputRef.value?.focus();
      adjustTextareaHeight();
    } else {
      // 退出编辑时强制重新计算一次
      calculateVisibleTags(true);
    }
  }
);

defineExpose({
  triggerFileInput
});
</script>

<template>
  <div
    class="card-body"
    :class="{
      'is-view-mode': !isEditing,
      'is-full-screen': isFullScreen,
      'is-drag-over': isDragOver
    }"
    @paste="handlePaste"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- 隐藏的通用附件文件选择器 -->
    <input
      ref="fileInputRef"
      type="file"
      multiple
      style="display: none"
      @change="handleFileInputChange"
      @cancel="handleFileInputCancel"
    />

    <textarea
      v-if="isEditing"
      ref="contentInputRef"
      v-model="content"
      :placeholder="note.type === 'markdown' ? '输入 Markdown 源码，支持粘贴/拖放图片及附件...' : '写点什么...'"
      class="content-textarea"
      :class="{ 'is-full-screen': isFullScreen }"
      @keydown="handleKeyDown"
      @input="adjustTextareaHeight"
      @paste="handlePaste"
    ></textarea>
    <template v-else>
      <div class="card-body-content">
        <!-- Markdown 类型便签渲染 -->
        <MarkdownRenderer
          v-if="note.type === 'markdown' && note.content"
          :content="note.content"
        />
        <!-- 默认纯文本便签渲染 -->
        <pre v-else class="card-content">{{
          note.content || (note.isDeleted ? '无内容' : '双击粘贴，点击右上角编辑...')
        }}</pre>
      </div>
      <!-- 便签标签展示 -->
      <div v-if="note.tags && note.tags.length > 0" class="note-tags-list">
        <span
          v-for="tag in visibleTags"
          :key="tag"
          class="note-tag-badge"
          :data-tooltip="tag"
          @click.stop="copyTag(tag)"
        >
          <span v-if="store.prefixTagWithHash" class="tag-prefix">#</span>
          <span class="tag-text">{{ tag }}</span>
        </span>
        <span v-if="hasMore" class="note-tag-badge more" :data-tooltip="allTagsText">···</span>
      </div>
      <!-- 隐藏的便签标签测量区域 -->
      <div
        v-if="note.tags && note.tags.length > 0"
        ref="measureContainerRef"
        class="note-tags-list-measure"
      >
        <span v-for="tag in note.tags" :key="'measure-' + tag" class="note-tag-badge">
          <span v-if="store.prefixTagWithHash" class="tag-prefix">#</span>
          <span class="tag-text">{{ tag }}</span>
        </span>
        <span ref="measureEllipsisRef" class="note-tag-badge more">···</span>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.card-body {
  flex: 1;
  min-height: 32px;
  padding-top: 4px;
  padding-bottom: 8px;
  overflow-y: auto;
  overflow-y: overlay;
  position: relative;
  display: flex;
  flex-direction: column;
  transition: background-color 0.2s ease, outline 0.2s ease;

  &.is-view-mode {
    overflow: hidden;
  }

  &.is-drag-over {
    outline: 2px dashed var(--accent-color);
    outline-offset: -2px;
    border-radius: 6px;
    background: rgba(var(--accent-color, 100, 100, 255), 0.06);
  }
}

.card-body-content {
  flex: 1;
  overflow-y: auto;
  overflow-y: overlay;
  overflow-x: hidden;
  background: transparent !important;
  background-color: transparent !important;

  &::-webkit-scrollbar {
    width: 6px;
    background: transparent !important;
  }

  &::-webkit-scrollbar-track,
  &::-webkit-scrollbar-track-piece,
  &::-webkit-scrollbar-corner {
    background: transparent !important;
    background-color: transparent !important;
    box-shadow: none !important;
    border: none !important;
  }

  &:hover::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.12);
  }

  .dark-theme &:hover::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
  }

  @media (prefers-color-scheme: dark) {
    &:hover::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
    }
    .light-theme &:hover::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.12);
    }
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.04);
    border-radius: 4px;

    &:hover {
      background: rgba(0, 0, 0, 0.15) !important;
    }
  }

  .dark-theme &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.04);

    &:hover {
      background: rgba(255, 255, 255, 0.18) !important;
    }
  }

  @media (prefers-color-scheme: dark) {
    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.04);

      &:hover {
        background: rgba(255, 255, 255, 0.18) !important;
      }
    }

    .light-theme &::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.04);

      &:hover {
        background: rgba(0, 0, 0, 0.15) !important;
      }
    }
  }
}

.card-content {
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-wrap: break-word;
}

.content-textarea {
  width: 100%;
  height: 100%;
  min-height: 100%;
  overflow-y: auto;
  overflow-y: overlay;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: inherit;
  resize: none;

  &.is-full-screen {
    font-size: 15px;
    line-height: 1.75;
    padding: 10px 12px;
  }

  &::-webkit-scrollbar {
    width: 6px;
    background: transparent !important;
  }

  &::-webkit-scrollbar-track,
  &::-webkit-scrollbar-track-piece,
  &::-webkit-scrollbar-corner {
    background: transparent !important;
    background-color: transparent !important;
    box-shadow: none !important;
    border: none !important;
  }

  &:focus {
    background: var(--input-bg);
    border-color: var(--card-border);

    .dark-theme & {
      border-color: var(--card-border-dark);
    }
  }

  &.is-drag-over,
  &.is-dragging-over {
    border-color: var(--accent-color) !important;
    border-style: dashed !important;
    background: rgba(99, 102, 241, 0.08) !important;
  }
}

.note-tags-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  flex-shrink: 0;
  max-height: 46px;
  overflow: hidden;
}

.note-tags-list-measure {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
  left: 0;
  right: 0;
  top: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  z-index: -9999;
  opacity: 0;
}

.note-tag-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 20px;
  padding: 0 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  background: var(--card-btn-hover-bg);
  border: 1px solid var(--card-border);
  color: inherit;
  cursor: pointer;
  user-select: none;
  max-width: 100%;
  box-sizing: border-box;
  transition:
    background-color $transition-fast,
    border-color $transition-fast,
    color $transition-fast,
    transform $transition-fast;

  .dark-theme & {
    border-color: var(--card-border-dark);
  }

  .tag-prefix {
    opacity: 0.55;
    font-weight: 600;
    line-height: 14px;
    flex-shrink: 0;
  }

  .tag-text {
    @include text-ellipsis;
    line-height: 14px;
    display: block;
  }

  &:hover {
    background: var(--card-border);
    color: var(--card-btn-hover-color);

    .dark-theme & {
      background: var(--card-border-dark);
    }
  }

  &:active {
    transform: scale(0.96);
  }

  &.more {
    cursor: help;
    padding: 0 6px;
    letter-spacing: 1px;
    font-weight: 700;
    line-height: 14px;

    &:active {
      transform: none;
    }
  }
}
</style>
