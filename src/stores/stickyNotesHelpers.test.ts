import { describe, it, expect, vi } from 'vitest';
import {
  exportSelectedBackup,
  importSelectedBackup,
  areNotesEqual,
  areCategoriesEqual,
  areCategoryOrdersEqual,
  areSettingsEqual
} from './stickyNotesHelpers';
import { Category, Note, AppSettings, BackupData } from '@type';

describe('stickyNotesHelpers Data Export & Import', () => {
  const mockCategories: Category[] = [
    { id: 'cat-1', name: '工作', createdAt: 1000 },
    { id: 'cat-2', name: '生活', createdAt: 2000 }
  ];

  const mockNotes: Note[] = [
    {
      id: 'note-1',
      categoryId: 'cat-1',
      title: '工作事项1',
      content: '完成报告',
      color: '#ffffff',
      isPinned: false,
      createdAt: 1000,
      updatedAt: 1000
    },
    {
      id: 'note-2',
      categoryId: 'cat-2',
      title: '买菜',
      content: '买水果',
      color: '#ffffff',
      isPinned: false,
      createdAt: 2000,
      updatedAt: 2000
    },
    {
      id: 'note-3',
      categoryId: 'all',
      title: '未分类灵感',
      content: '无分类笔记',
      color: '#ffffff',
      isPinned: false,
      createdAt: 3000,
      updatedAt: 3000
    }
  ];

  const mockSettings: AppSettings = {
    theme: 'dark',
    gridColumns: 3
  };

  it('exportSelectedBackup 应仅筛选选中的分类与便签', async () => {
    const showToast = vi.fn();
    await exportSelectedBackup(
      mockCategories,
      mockNotes,
      mockSettings,
      {
        categoryIds: ['cat-1'],
        includeSettings: true,
        includeTrash: false
      },
      showToast
    );

    expect(showToast).toHaveBeenCalled();
  });

  it('importSelectedBackup 增量合并模式 (merge)', async () => {
    const categoriesRef = { value: [...mockCategories] };
    const notesRef = { value: [mockNotes[0]] };
    const categoryOrderRef = { value: ['all', 'cat-1', 'cat-2'] };
    const showToast = vi.fn();

    const backup: BackupData = {
      version: '1.0.0',
      timestamp: Date.now(),
      categories: [{ id: 'cat-3', name: '学习', createdAt: 3000 }],
      notes: [
        {
          id: 'note-4',
          categoryId: 'cat-3',
          title: '读书',
          content: '看书',
          color: '#ffffff',
          isPinned: false,
          createdAt: 4000,
          updatedAt: 4000
        }
      ]
    };

    const success = await importSelectedBackup(
      backup,
      {
        mode: 'merge',
        categoryIds: ['cat-3'],
        importUncategorized: false,
        importSettings: false
      },
      categoriesRef,
      notesRef,
      categoryOrderRef,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      showToast
    );

    expect(success).toBe(true);
    expect(categoriesRef.value.length).toBe(3); // cat-1, cat-2, cat-3
    expect(notesRef.value.length).toBe(2); // note-1, note-4
  });

  it('importSelectedBackup 覆盖已有模式 (overwrite) 并处理 assets', async () => {
    const categoriesRef = { value: [...mockCategories] };
    const notesRef = { value: [...mockNotes] };
    const categoryOrderRef = { value: ['all', 'cat-1', 'cat-2'] };
    const showToast = vi.fn();

    const backup: BackupData = {
      version: '1.0.0',
      timestamp: Date.now(),
      categories: [{ id: 'cat-new', name: '全新分类', createdAt: 5000 }],
      notes: [
        {
          id: 'note-new',
          categoryId: 'cat-new',
          title: '全新便签',
          content: '替换后的内容: ![图](asset://test_asset_id.png)',
          color: '#ffffff',
          isPinned: false,
          createdAt: 5000,
          updatedAt: 5000
        }
      ],
      assets: {
        test_asset_id: {
          mime: 'image/png',
          data: 'iVBORw0KGgo='
        }
      }
    };

    const success = await importSelectedBackup(
      backup,
      {
        mode: 'overwrite',
        categoryIds: ['cat-new'],
        importUncategorized: false,
        importSettings: false
      },
      categoriesRef,
      notesRef,
      categoryOrderRef,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      showToast
    );

    expect(success).toBe(true);
    expect(categoriesRef.value).toEqual([
      { id: 'cat-new', name: '全新分类', createdAt: 5000, parentId: undefined }
    ]);
    expect(notesRef.value.length).toBe(1);
    expect(notesRef.value[0].id).toBe('note-new');
  });

  describe('数据指纹 Diff 校验 (Diff Check)', () => {
    it('areNotesEqual 应正确识别相同与不同的便签列表', () => {
      const baseNotes: Note[] = [
        {
          id: 'n1',
          categoryId: 'cat1',
          title: '标题1',
          content: '内容1',
          type: 'text',
          color: '#fff',
          isPinned: false,
          isDeleted: false,
          createdAt: 1000,
          updatedAt: 1000,
          tags: ['工作']
        }
      ];

      // 1. 完全克隆相同
      expect(areNotesEqual(baseNotes, JSON.parse(JSON.stringify(baseNotes)))).toBe(true);

      // 2. 数量不同
      expect(areNotesEqual(baseNotes, [])).toBe(false);

      // 3. 内容修改
      const modifiedContentNotes = [{ ...baseNotes[0], content: '内容1修改' }];
      expect(areNotesEqual(baseNotes, modifiedContentNotes)).toBe(false);

      // 4. 标题修改
      const modifiedTitleNotes = [{ ...baseNotes[0], title: '新标题' }];
      expect(areNotesEqual(baseNotes, modifiedTitleNotes)).toBe(false);

      // 5. 时间戳修改
      const modifiedTimeNotes = [{ ...baseNotes[0], updatedAt: 2000 }];
      expect(areNotesEqual(baseNotes, modifiedTimeNotes)).toBe(false);

      // 6. 标签修改
      const modifiedTagsNotes = [{ ...baseNotes[0], tags: ['生活'] }];
      expect(areNotesEqual(baseNotes, modifiedTagsNotes)).toBe(false);

      // 7. 删除状态修改
      const deletedNotes = [{ ...baseNotes[0], isDeleted: true, deletedAt: 2000 }];
      expect(areNotesEqual(baseNotes, deletedNotes)).toBe(false);
    });

    it('areCategoriesEqual 应正确比对分类列表', () => {
      const baseCats: Category[] = [
        { id: 'c1', name: '工作', createdAt: 1000, updatedAt: 1000 }
      ];
      expect(areCategoriesEqual(baseCats, JSON.parse(JSON.stringify(baseCats)))).toBe(true);
      expect(areCategoriesEqual(baseCats, [{ ...baseCats[0], name: '新分类名' }])).toBe(false);
      expect(areCategoriesEqual(baseCats, [{ ...baseCats[0], isDeleted: true }])).toBe(false);
      expect(areCategoriesEqual(baseCats, [])).toBe(false);
    });

    it('areCategoryOrdersEqual 应正确比对分类排序数组', () => {
      expect(areCategoryOrdersEqual(['c1', 'c2'], ['c1', 'c2'])).toBe(true);
      expect(areCategoryOrdersEqual(['c1', 'c2'], ['c2', 'c1'])).toBe(false);
      expect(areCategoryOrdersEqual(['c1'], ['c1', 'c2'])).toBe(false);
    });

    it('areSettingsEqual 应正确比对设置对象', () => {
      expect(areSettingsEqual({ theme: 'dark' }, { theme: 'dark' })).toBe(true);
      expect(areSettingsEqual({ theme: 'dark' }, { theme: 'light' })).toBe(false);
      expect(areSettingsEqual(null, null)).toBe(true);
      expect(areSettingsEqual({ a: 1 }, null)).toBe(false);
    });
  });
});

