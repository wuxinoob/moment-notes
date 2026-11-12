import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { Note, NoteType } from '@type';
import { storage } from '@utils/storage';
import { useUiStore } from './uiStore';
import { useCategoryStore } from './categoryStore';
import { COLOR_PRESETS } from './colorPresets';
import { SearchTarget } from './stickyNotesAlgorithms';
import {
  SEARCH_DEBOUNCE_THRESHOLD,
  SEARCH_DEBOUNCE_MS
} from '../domain/search/NoteSearchIndex';
import { noteRepository } from '../infrastructure/storage/Repository';
import { eventBus } from '../domain/events/DomainEventBus';
import { imageLifecycleService } from '../infrastructure/sync/ImageLifecycleService';
import { webdavSyncEngine, WebdavClient } from '../infrastructure/sync/WebdavSyncEngine';

export const useNoteStore = defineStore('noteStore', () => {
  const allNotes = ref<Note[]>([]);
  const notes = ref<Note[]>([]);
  const currentCategoryId = ref<string>('all');
  const searchQuery = ref<string>('');
  const appliedSearchQuery = ref<string>('');
  const searchTarget = ref<SearchTarget[]>(['all']);
  const sortMode = ref<'date' | 'title' | 'tag' | 'custom' | 'useCount'>('date');
  const sortOrder = ref<'asc' | 'desc'>('desc');
  const draggedNoteId = ref<string | null>(null);
  const editingNoteId = ref<string | null>(null);
  const isLoadingNotes = ref(false);

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // 监听原始搜索输入，按数据量自适应防抖或立即生效
  watch(searchQuery, (newQuery) => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    const trimmed = newQuery.trim();
    if (!trimmed || notes.value.length <= SEARCH_DEBOUNCE_THRESHOLD) {
      appliedSearchQuery.value = newQuery;
      return;
    }

    searchDebounceTimer = setTimeout(() => {
      appliedSearchQuery.value = newQuery;
      searchDebounceTimer = null;
    }, SEARCH_DEBOUNCE_MS);
  });

  const syncCurrentCategoryNotes = () => {
    const categoryId = currentCategoryId.value;
    const allNotesList = allNotes.value;
    const categoryStore = useCategoryStore();

    let result = allNotesList;
    if (categoryId === 'trash') {
      result = result.filter(n => n.isDeleted === true && !n.isPurged);
    } else if (categoryId === 'recent') {
      result = result.filter(n => n.isDeleted !== true && !n.isPurged && n.lastUsedAt !== undefined);
    } else {
      result = result.filter(n => n.isDeleted !== true && !n.isPurged);
      if (categoryId !== 'all') {
        const descendants = categoryStore.getCategoryDescendants(categoryId);
        result = result.filter(
          n => n.categoryId === categoryId || descendants.has(n.categoryId)
        );
      }
    }
    notes.value = result;
  };

  const loadNotesForCurrentCategory = (_immediate = true) => {
    syncCurrentCategoryNotes();
    isLoadingNotes.value = false;
  };

  const applyCategoryViewSettings = (categoryId: string) => {
    const uiStore = useUiStore();
    if (!uiStore.categoryIndependentToolbar) return;

    const setting = uiStore.categoryViewSettings[categoryId];
    if (setting) {
      if (setting.sortMode) {
        sortMode.value = setting.sortMode;
      }
      if (setting.sortOrder) {
        sortOrder.value = setting.sortOrder;
      }
      if (setting.gridColumns) {
        uiStore.gridColumns = setting.gridColumns;
      }
    }
  };

  watch(currentCategoryId, (newId) => {
    if (newId) {
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
        appliedSearchQuery.value = searchQuery.value;
      }
      storage.setItem('sticky_notes_last_category_id', newId);
      applyCategoryViewSettings(newId);
      loadNotesForCurrentCategory();
    }
  });

  watch(sortOrder, (newOrder) => {
    const uiStore = useUiStore();
    if (uiStore.categoryIndependentToolbar && currentCategoryId.value) {
      uiStore.updateCategoryViewSetting(currentCategoryId.value, {
        sortOrder: newOrder
      });
    }
  });

  watch(sortMode, (newMode) => {
    const uiStore = useUiStore();
    if (uiStore.categoryIndependentToolbar && currentCategoryId.value) {
      uiStore.updateCategoryViewSetting(currentCategoryId.value, {
        sortMode: newMode
      });
    }
  });

  const saveNotes = () => {
    noteRepository.saveAll(allNotes.value);
  };

  let lastRandomColor = '';
  const newlyCreatedNoteIds = ref<Set<string>>(new Set());

  const isNewlyCreatedNote = (id: string) => newlyCreatedNoteIds.value.has(id);

  const markNoteAsSaved = (id: string) => {
    newlyCreatedNoteIds.value.delete(id);
  };

  const discardNewNote = (id: string) => {
    newlyCreatedNoteIds.value.delete(id);
    if (editingNoteId.value === id) {
      editingNoteId.value = null;
    }
    const index = allNotes.value.findIndex(n => n.id === id);
    if (index !== -1) {
      allNotes.value.splice(index, 1);
      saveNotes();
      syncCurrentCategoryNotes();
      eventBus.emit('NOTE_DELETED', id);
    }
  };

  const addNote = (categoryId: string, content = '', title = '', color?: string, type?: NoteType) => {
    const uiStore = useUiStore();
    let finalColor = color || uiStore.defaultNoteColor || 'random';
    if (finalColor === 'random') {
      const presetKeys = Object.keys(COLOR_PRESETS);
      const availableKeys = presetKeys.length > 1
        ? presetKeys.filter(k => k !== lastRandomColor)
        : presetKeys;
      finalColor = availableKeys[Math.floor(Math.random() * availableKeys.length)];
      lastRandomColor = finalColor;
    }
    const finalType = type || uiStore.defaultNoteType || 'text';
    const newNote: Note = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      categoryId,
      title: title.trim(),
      content: content,
      type: finalType,
      color: finalColor,
      isPinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: []
    };

    allNotes.value.unshift(newNote);
    newlyCreatedNoteIds.value.add(newNote.id);
    saveNotes();
    syncCurrentCategoryNotes();

    editingNoteId.value = newNote.id;
    eventBus.emit('NOTE_CREATED', newNote);
    return newNote;
  };

  const deleteNote = (id: string) => {
    newlyCreatedNoteIds.value.delete(id);
    const note = allNotes.value.find(n => n.id === id);
    if (!note) return;

    if (note.isDeleted) {
      note.isPurged = true;
      note.purgedAt = Date.now();
      eventBus.requestToast('已彻底删除便签', 'success');
    } else {
      note.isDeleted = true;
      note.deletedAt = Date.now();
      note.isPinned = false;
      eventBus.requestToast('已将便签移至最近删除', 'success');
    }
    saveNotes();
    syncCurrentCategoryNotes();
    eventBus.emit('NOTE_DELETED', id);
  };

  const restoreNote = (id: string) => {
    const note = allNotes.value.find(n => n.id === id);
    if (note) {
      note.isDeleted = false;
      note.isPurged = false;
      delete note.deletedAt;
      delete note.purgedAt;
      note.updatedAt = Date.now();
      saveNotes();
      syncCurrentCategoryNotes();
      eventBus.requestToast('已成功恢复便签', 'success');
      eventBus.emit('NOTE_RESTORED', id);
    }
  };

  const clearTrash = () => {
    const now = Date.now();
    allNotes.value.forEach(n => {
      if (n.isDeleted && !n.isPurged) {
        n.isPurged = true;
        n.purgedAt = now;
      }
    });
    saveNotes();
    syncCurrentCategoryNotes();
    eventBus.requestToast('已清空最近删除的所有便签', 'success');

    // 异步触发孤儿图片垃圾回收
    const cfg = webdavSyncEngine.config.value;
    const client = cfg.enabled ? new WebdavClient(cfg) : undefined;
    imageLifecycleService.performImageGC(allNotes.value, client, {
      gracePeriodDays: 7,
      remoteDir: cfg.imagesRemoteDir || '/toolkit/moment_notes_images'
    }).catch(e => console.warn('[NoteStore] Image GC error:', e));
  };

  const trashNotesCount = ref(0);
  watch(
    () => allNotes.value,
    (notesList) => {
      trashNotesCount.value = notesList.filter(n => n.isDeleted === true && !n.isPurged).length;
    },
    { deep: true, immediate: true }
  );

  const updateNote = (
    id: string,
    fields: Partial<Omit<Note, 'id' | 'createdAt'>>,
    updateTimestamp = true
  ) => {
    newlyCreatedNoteIds.value.delete(id);
    const note = allNotes.value.find(n => n.id === id);
    if (note) {
      Object.assign(note, fields);
      if (updateTimestamp) {
        note.updatedAt = Date.now();
      }
      saveNotes();
      syncCurrentCategoryNotes();
      eventBus.emit('NOTE_UPDATED', note);
    }
  };

  const clearNotes = (categoryId: string, descendants?: Set<string>) => {
    if (categoryId === 'all') {
      allNotes.value.forEach(n => {
        if (!n.isDeleted && !n.isPurged) {
          n.isDeleted = true;
          n.deletedAt = Date.now();
          n.isPinned = false;
        }
      });
    } else if (categoryId === 'trash') {
      clearTrash();
      return;
    } else {
      allNotes.value.forEach(n => {
        if (
          (n.categoryId === categoryId || (descendants && descendants.has(n.categoryId))) &&
          !n.isDeleted && !n.isPurged
        ) {
          n.isDeleted = true;
          n.deletedAt = Date.now();
          n.isPinned = false;
        }
      });
    }
    saveNotes();
    syncCurrentCategoryNotes();
    eventBus.requestToast('已清空当前分类下的便签', 'success');
  };

  const setSortMode = (mode: 'date' | 'title' | 'tag' | 'custom' | 'useCount') => {
    if (mode === sortMode.value) {
      if (mode !== 'custom') {
        sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
      }
    } else {
      sortMode.value = mode;
      if (mode === 'date') {
        sortOrder.value = 'desc';
      } else if (mode === 'title') {
        sortOrder.value = 'asc';
      } else if (mode === 'tag') {
        sortOrder.value = 'asc';
      } else if (mode === 'useCount') {
        sortOrder.value = 'desc';
      }
    }
    storage.setItem('sticky_notes_sort_mode', sortMode.value);
    storage.setItem('sticky_notes_sort_order', sortOrder.value);
  };

  let lastMoveTime = 0;

  const moveNote = (draggedId: string, targetId: string) => {
    const now = Date.now();
    if (now - lastMoveTime < 100) {
      return;
    }
    const fromIndex = notes.value.findIndex(n => n.id === draggedId);
    const toIndex = notes.value.findIndex(n => n.id === targetId);
    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      const fromNote = notes.value[fromIndex];
      const toNote = notes.value[toIndex];
      if (fromNote.isPinned === toNote.isPinned) {
        if (currentCategoryId.value !== 'all' && currentCategoryId.value !== 'trash') {
          if (fromNote.categoryId !== toNote.categoryId) {
            fromNote.categoryId = toNote.categoryId;
            fromNote.updatedAt = Date.now();
            const allFrom = allNotes.value.find(n => n.id === draggedId);
            if (allFrom) {
              allFrom.categoryId = toNote.categoryId;
              allFrom.updatedAt = Date.now();
            }
          }
        }
        const [movedNote] = notes.value.splice(fromIndex, 1);
        notes.value.splice(toIndex, 0, movedNote);

        const allFromIndex = allNotes.value.findIndex(n => n.id === draggedId);
        const allToIndex = allNotes.value.findIndex(n => n.id === targetId);
        if (allFromIndex !== -1 && allToIndex !== -1 && allFromIndex !== allToIndex) {
          const [movedAllNote] = allNotes.value.splice(allFromIndex, 1);
          allNotes.value.splice(allToIndex, 0, movedAllNote);
        }
        lastMoveTime = now;
        saveNotes();
      }
    }
  };

  const solidifyCurrentOrderAsCustom = (orderedList?: Note[]) => {
    const listToSolidify = orderedList || notes.value;
    if (listToSolidify.length > 0) {
      const idOrder = new Map(listToSolidify.map((n, i) => [n.id, i]));

      notes.value = [...notes.value].sort((a, b) => {
        const idxA = idOrder.get(a.id) ?? 999999;
        const idxB = idOrder.get(b.id) ?? 999999;
        return idxA - idxB;
      });

      allNotes.value = [...allNotes.value].sort((a, b) => {
        const idxA = idOrder.get(a.id) ?? 999999;
        const idxB = idOrder.get(b.id) ?? 999999;
        return idxA - idxB;
      });

      saveNotes();
    }
    sortMode.value = 'custom';
    storage.setItem('sticky_notes_sort_mode', 'custom');
  };

  const updateNoteLastUsed = (id: string) => {
    const note = allNotes.value.find(n => n.id === id);
    if (note) {
      note.lastUsedAt = Date.now();
      note.useCount = (note.useCount || 0) + 1;
      saveNotes();
      syncCurrentCategoryNotes();
    }
  };

  return {
    allNotes,
    notes,
    currentCategoryId,
    searchQuery,
    appliedSearchQuery,
    searchTarget,
    sortMode,
    sortOrder,
    draggedNoteId,
    editingNoteId,
    isLoadingNotes,
    saveNotes,
    addNote,
    deleteNote,
    discardNewNote,
    isNewlyCreatedNote,
    markNoteAsSaved,
    newlyCreatedNoteIds,
    restoreNote,
    clearTrash,
    trashNotesCount,
    updateNote,
    clearNotes,
    setSortMode,
    solidifyCurrentOrderAsCustom,
    moveNote,
    updateNoteLastUsed,
    loadNotesForCurrentCategory,
    syncCurrentCategoryNotes,
    applyCategoryViewSettings
  };
});
