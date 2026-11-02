import { describe, expect, it, beforeEach } from 'vitest';
import {
  draftBufferRepository,
  noteRepository,
  categoryRepository,
  BackupCodec
} from './Repository';
import { clearStorageMemoryCache } from '@utils/storage';
import { Note, Category } from '@type';

describe('Repository & DraftBufferRepository', () => {
  let storeMap: Map<string, string>;

  beforeEach(() => {
    clearStorageMemoryCache();
    storeMap = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => storeMap.get(key) || null,
      setItem: (key: string, value: string) => storeMap.set(key, value),
      removeItem: (key: string) => storeMap.delete(key),
      clear: () => storeMap.clear(),
      length: 0,
      key: () => null
    } as any;
  });

  it('初始状态下草稿缓冲区应为空且无未同步修改', () => {
    expect(draftBufferRepository.getDraft()).toBeNull();
    expect(draftBufferRepository.hasUnsyncedChanges()).toBe(false);
  });

  it('保存草稿后应能正确读取且标记为脏数据', () => {
    const mockNotes: Note[] = [
      {
        id: 'n1',
        title: '测试便签',
        content: '草稿内容',
        color: 'yellow',
        categoryId: 'all',
        isPinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];
    const mockCategories: Category[] = [
      { id: 'c1', name: '工作', createdAt: Date.now() }
    ];

    draftBufferRepository.saveDraft(mockNotes, mockCategories);
    expect(draftBufferRepository.hasUnsyncedChanges()).toBe(true);

    const draft = draftBufferRepository.getDraft();
    expect(draft).not.toBeNull();
    expect(draft?.notes.length).toBe(1);
    expect(draft?.notes[0].title).toBe('测试便签');
    expect(draft?.categories.length).toBe(1);
    expect(draft?.dirty).toBe(true);
  });

  it('标记同步和清除草稿后状态应正确更新', () => {
    const mockNotes: Note[] = [
      {
        id: 'n2',
        title: '已同步便签',
        content: '内容',
        color: 'green',
        categoryId: 'all',
        isPinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];
    draftBufferRepository.saveDraft(mockNotes, []);
    expect(draftBufferRepository.hasUnsyncedChanges()).toBe(true);

    draftBufferRepository.markSynced();
    expect(draftBufferRepository.hasUnsyncedChanges()).toBe(false);
    expect(draftBufferRepository.getDraft()?.dirty).toBe(false);

    draftBufferRepository.clearDraft();
    expect(draftBufferRepository.getDraft()).toBeNull();
    expect(draftBufferRepository.hasUnsyncedChanges()).toBe(false);
  });

  it('NoteRepository 与 CategoryRepository 在草稿存在时应优先返回草稿中的数据', () => {
    const mockNotes: Note[] = [
      {
        id: 'n3',
        title: '草稿优先',
        content: '内容',
        color: 'pink',
        categoryId: 'all',
        isPinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];
    const mockCategories: Category[] = [
      { id: 'c2', name: '临时分类', createdAt: Date.now() }
    ];

    draftBufferRepository.saveDraft(mockNotes, mockCategories);

    expect(noteRepository.getAll()).toEqual(mockNotes);
    expect(categoryRepository.getAll()).toEqual(mockCategories);
  });

  it('BackupCodec 应正确完成编码与解码', () => {
    const notes: Note[] = [
      {
        id: 'n4',
        title: '编码测试',
        content: '内容',
        color: 'blue',
        categoryId: 'all',
        isPinned: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];
    const categories: Category[] = [
      { id: 'c3', name: '生活', createdAt: Date.now() }
    ];

    const backup = BackupCodec.encode(categories, notes);
    expect(backup.version).toBe('2.0.0');
    expect(backup.notes).toEqual(notes);
    expect(backup.categories).toEqual(categories);

    const decoded = BackupCodec.decode(JSON.stringify(backup));
    expect(decoded).not.toBeNull();
    expect(decoded?.notes.length).toBe(1);
    expect(decoded?.categories.length).toBe(1);
  });
});
