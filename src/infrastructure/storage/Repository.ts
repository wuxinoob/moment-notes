import { Category, Note, AppSettings, BackupData } from '@type';
import { storage } from '@utils/storage';

export enum StorageKeys {
  CATEGORIES = 'sticky_notes_categories',
  NOTES = 'sticky_notes_notes',
  CATEGORY_ORDER = 'sticky_notes_category_order',
  COLLAPSED_CATEGORIES = 'sticky_notes_collapsed_categories',
  SORT_MODE = 'sticky_notes_sort_mode',
  SORT_ORDER = 'sticky_notes_sort_order',
  GRID_COLUMNS = 'sticky_notes_grid_columns',
  MIN_NOTE_WIDTH = 'sticky_notes_min_note_width',
  NOTE_MAX_HEIGHT = 'sticky_notes_note_max_height',
  ENABLED_ACTION_BAR_BUTTONS = 'sticky_notes_enabled_action_bar_buttons',
  DATE_FORMAT = 'sticky_notes_date_format',
  DEFAULT_NOTE_COLOR = 'sticky_notes_default_note_color',
  DEFAULT_NOTE_TYPE = 'sticky_notes_default_note_type',
  DEFAULT_EDIT_MODE = 'sticky_notes_default_edit_mode',
  SUPER_PANEL_DEFAULT_CATEGORY = 'sticky_notes_super_panel_default_category',
  START_PAGE_MODE = 'sticky_notes_start_page_mode',
  ENABLE_HOVER_ANIMATION = 'sticky_notes_enable_hover_animation',
  ENABLE_AUTO_COPY_SELECTION = 'sticky_notes_enable_auto_copy_selection',
  SHOW_NOTE_COUNT = 'sticky_notes_show_note_count',
  PREFIX_TAG_WITH_HASH = 'sticky_notes_prefix_tag_with_hash',
  CATEGORY_INDEPENDENT_TOOLBAR = 'sticky_notes_category_independent_toolbar',
  CATEGORY_VIEW_SETTINGS = 'sticky_notes_category_view_settings',
  LAST_CATEGORY_ID = 'sticky_notes_last_category_id',
  THEME = 'sticky_notes_theme',
  SHORTCUTS = 'sticky_notes_shortcuts',
  // 专门用于暂存本地未提交到 WebDAV 的脏数据缓冲区
  DRAFT_BUFFER = 'sticky_notes_draft_buffer',
  // 上次成功与 WebDAV 握手的时间与 ETag/版本标记
  SYNC_METADATA = 'sticky_notes_sync_metadata'
}

export interface DraftBufferData {
  notes: Note[];
  categories: Category[];
  timestamp: number;
  dirty: boolean;
}

/**
 * 负责本地临时脏数据缓冲区的存取 (落盘于 ctx.storage 或 localStorage 暂存区)
 */
export class DraftBufferRepository {
  public getDraft(): DraftBufferData | null {
    const raw = storage.getItem(StorageKeys.DRAFT_BUFFER);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.notes)) {
        return parsed as DraftBufferData;
      }
      return null;
    } catch {
      return null;
    }
  }

  public saveDraft(notes: Note[], categories: Category[]): void {
    const data: DraftBufferData = {
      notes,
      categories,
      timestamp: Date.now(),
      dirty: true
    };
    storage.setItem(StorageKeys.DRAFT_BUFFER, JSON.stringify(data));
  }

  public markSynced(): void {
    const current = this.getDraft();
    if (current) {
      current.dirty = false;
      storage.setItem(StorageKeys.DRAFT_BUFFER, JSON.stringify(current));
    }
  }

  public clearDraft(): void {
    storage.removeItem(StorageKeys.DRAFT_BUFFER);
  }

  public hasUnsyncedChanges(): boolean {
    const current = this.getDraft();
    return Boolean(current && current.dirty);
  }
}

export class NoteRepository {
  public getAll(): Note[] {
    // 优先读取临时草稿缓冲区中的最新未同步改动
    const draft = draftBufferRepository.getDraft();
    if (draft && draft.notes && draft.notes.length > 0) {
      return draft.notes;
    }

    const raw = storage.getItem(StorageKeys.NOTES);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public saveAll(notes: Note[], categories?: Category[]): void {
    // 写入内存与临时暂存
    storage.setItem(StorageKeys.NOTES, JSON.stringify(notes));
    if (categories) {
      draftBufferRepository.saveDraft(notes, categories);
    }
  }
}

export class CategoryRepository {
  public getAll(): Category[] {
    const draft = draftBufferRepository.getDraft();
    if (draft && draft.categories && draft.categories.length > 0) {
      return draft.categories;
    }

    const raw = storage.getItem(StorageKeys.CATEGORIES);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public saveAll(categories: Category[], notes?: Note[]): void {
    storage.setItem(StorageKeys.CATEGORIES, JSON.stringify(categories));
    if (notes) {
      draftBufferRepository.saveDraft(notes, categories);
    }
  }

  public getOrder(): string[] {
    const raw = storage.getItem(StorageKeys.CATEGORY_ORDER);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public saveOrder(order: string[]): void {
    storage.setItem(StorageKeys.CATEGORY_ORDER, JSON.stringify(order));
  }

  public getCollapsed(): string[] {
    const raw = storage.getItem(StorageKeys.COLLAPSED_CATEGORIES);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public saveCollapsed(collapsed: string[]): void {
    storage.setItem(StorageKeys.COLLAPSED_CATEGORIES, JSON.stringify(collapsed));
  }
}

export class BackupCodec {
  public static encode(categories: Category[], notes: Note[], settings?: AppSettings): BackupData {
    return {
      version: '2.0.0',
      timestamp: Date.now(),
      categories,
      notes,
      settings
    };
  }

  public static decode(jsonString: string): BackupData | null {
    try {
      const data = JSON.parse(jsonString);
      if (!data || typeof data !== 'object') return null;
      if (!Array.isArray(data.categories) || !Array.isArray(data.notes)) return null;
      return data as BackupData;
    } catch {
      return null;
    }
  }
}

export const draftBufferRepository = new DraftBufferRepository();
export const noteRepository = new NoteRepository();
export const categoryRepository = new CategoryRepository();
