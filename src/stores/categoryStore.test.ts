import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useCategoryStore } from './categoryStore';
import { clearStorageMemoryCache } from '@utils/storage';

describe('categoryStore 分类增删与软删除单测', () => {
  let storeMap: Map<string, string>;

  beforeEach(() => {
    clearStorageMemoryCache();
    setActivePinia(createPinia());
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

  it('添加分类后，orderedCategories 应包含该分类', () => {
    const store = useCategoryStore();
    const newCat = store.addCategory('测试分类');
    expect(newCat).toBeDefined();
    expect(newCat?.name).toBe('测试分类');
    expect(newCat?.isDeleted).toBe(false);

    const active = store.orderedCategories.filter(c => !c.isSystem);
    expect(active.some(c => c.id === newCat!.id)).toBe(true);
  });

  it('删除分类后，分类应标记为 isDeleted 且在 orderedCategories 中被过滤', () => {
    const store = useCategoryStore();
    const cat1 = store.addCategory('分类1');
    const cat2 = store.addCategory('分类2');
    expect(cat1).toBeDefined();
    expect(cat2).toBeDefined();

    store.deleteCategory(cat1!.id);

    // 数据底层标记为 isDeleted
    const rawCat1 = store.categories.find(c => c.id === cat1!.id);
    expect(rawCat1?.isDeleted).toBe(true);
    expect(rawCat1?.deletedAt).toBeDefined();

    // categoryOrder 中应剔除
    expect(store.categoryOrder.includes(cat1!.id)).toBe(false);

    // 活跃分类中不应再包含 cat1
    const active = store.orderedCategories.filter(c => !c.isSystem);
    expect(active.some(c => c.id === cat1!.id)).toBe(false);
    expect(active.some(c => c.id === cat2!.id)).toBe(true);
  });

  it('连续快速添加分类时，生成的 ID 必须唯一不碰撞', () => {
    const store = useCategoryStore();
    const createdIds = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const cat = store.addCategory(`分类${i}`);
      expect(cat).toBeDefined();
      expect(createdIds.has(cat!.id)).toBe(false);
      createdIds.add(cat!.id);
    }
    expect(createdIds.size).toBe(50);
  });

  it('若历史数据存在相同 ID 的冗余项，deleteCategory 应将全部同名 ID 标记删除', () => {
    const store = useCategoryStore();
    // 模拟历史脏数据中存在两个相同 ID 的分类
    store.categories = [
      { id: 'dup-id', name: '分类', createdAt: 1000, isDeleted: false },
      { id: 'dup-id', name: '分类', createdAt: 1000, isDeleted: false },
      { id: 'normal-id', name: '正常分类', createdAt: 2000, isDeleted: false }
    ];
    store.categoryOrder = ['dup-id', 'normal-id'];

    store.deleteCategory('dup-id');

    const remainingDup = store.categories.filter(c => c.id === 'dup-id' && !c.isDeleted);
    expect(remainingDup.length).toBe(0);

    const active = store.orderedCategories.filter(c => !c.isSystem);
    expect(active.some(c => c.id === 'dup-id')).toBe(false);
    expect(active.some(c => c.id === 'normal-id')).toBe(true);
  });
});
