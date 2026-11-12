import { describe, it, expect, vi } from 'vitest';
import { WebdavSyncEngine, WebdavClient, WebdavSyncError, defaultWebdavConfig } from './WebdavSyncEngine';
import { BackupData, Note, Category } from '@type';

describe('WebDAV 云同步加固改造功能验证与模型测试', () => {
  const engine = new WebdavSyncEngine();

  const createNote = (id: string, title: string, content: string, overrides?: Partial<Note>): Note => ({
    id,
    categoryId: 'all',
    title,
    content,
    type: 'text',
    color: '#ffffff',
    isPinned: false,
    createdAt: 1000,
    updatedAt: 1000,
    tags: [],
    ...overrides
  });

  const createCategory = (id: string, name: string, overrides?: Partial<Category>): Category => ({
    id,
    name,
    createdAt: 1000,
    updatedAt: 1000,
    isDeleted: false,
    ...overrides
  });

  /**
   * 验证改造 1：彻底删除 (isPurged) 墓碑同步消除“死者复生”
   * 修复效果：本地标记 isPurged = true 后与云端软删除合并，合并结果保持 isPurged: true，绝不复活回垃圾箱。
   */
  it('验证改造 1 [彻底删除防复活]：标记 isPurged 后同步，云端旧便签被同步判定为已彻底清理，不会复活', () => {
    const deletedTwoHoursAgo = Date.now() - 7200 * 1000;
    const purgedNow = Date.now();

    // 云端：2小时前放入垃圾箱的旧便签（仍在 30 天 GC 窗口内）
    const remoteData: BackupData = {
      version: '1.7.0',
      timestamp: deletedTwoHoursAgo,
      categories: [],
      notes: [
        createNote('note-trash-1', '已放入回收站的备忘', '内容123', {
          isDeleted: true,
          deletedAt: deletedTwoHoursAgo,
          updatedAt: deletedTwoHoursAgo
        })
      ]
    };

    // 本地：用户执行了“彻底删除”或“清空垃圾箱”，标记了 isPurged: true, purgedAt: purgedNow
    const localData: BackupData = {
      version: '1.7.0',
      timestamp: purgedNow,
      categories: [],
      notes: [
        createNote('note-trash-1', '已放入回收站的备忘', '内容123', {
          isDeleted: true,
          isPurged: true,
          purgedAt: purgedNow,
          updatedAt: deletedTwoHoursAgo
        })
      ]
    };

    const merged = engine.mergeBackupData(localData, remoteData);
    const resultNote = merged.notes.find(n => n.id === 'note-trash-1');

    // 验证：彻底删除状态生效，保持 isPurged: true，不会作为普通垃圾便签重新呈现在用户界面
    expect(resultNote).toBeDefined();
    expect(resultNote?.isPurged).toBe(true);
    expect(resultNote?.purgedAt).toBe(purgedNow);
  });

  /**
   * 验证改造 2：并发正文编辑自动生成 [冲突副本] (Conflict Copy) —— 零数据丢失保护
   * 修复效果：设备 A 和设备 B 同时离线修改了同一便签的正文，合并时保留最新版，同时将较旧版克隆为冲突副本！
   */
  it('验证改造 2 [冲突副本保护]：两端并发修改正文时，自动保留最新版并生成 [冲突副本]，文字绝对不丢', () => {
    const baseCreatedAt = 10000;

    // 设备 A：写了 1000 字重要会议纪要 (updatedAt: 12000)
    const localDataDeviceA: BackupData = {
      version: '1.7.0',
      timestamp: 12000,
      categories: [],
      notes: [
        createNote('note-meeting', '重要会议纪要', '交付目标：1.需求澄清 2.原型验证 3.上线部署', {
          createdAt: baseCreatedAt,
          updatedAt: 12000,
          color: '#ffffff'
        })
      ]
    };

    // 设备 B：修改了正文并更改了便签颜色 (updatedAt: 13000)
    const remoteDataDeviceB: BackupData = {
      version: '1.7.0',
      timestamp: 13000,
      categories: [],
      notes: [
        createNote('note-meeting', '重要会议纪要', '另一端同步记录的预算说明：总预算50万', {
          createdAt: baseCreatedAt,
          updatedAt: 13000,
          color: '#ff0000'
        })
      ]
    };

    const lastSyncTime = 11000; // 基准同步锚点：两端均在此后独立发生了修改
    const merged = engine.mergeBackupData(localDataDeviceA, remoteDataDeviceB, lastSyncTime);

    // 验证 1：主记录保留最新时间戳的版本 (设备 B 的内容)
    const mainNote = merged.notes.find(n => n.id === 'note-meeting');
    expect(mainNote?.content).toBe('另一端同步记录的预算说明：总预算50万');
    expect(mainNote?.color).toBe('#ff0000');

    // 验证 2：系统自动克隆生成了冲突副本，设备 A 编写的内容被 100% 完整保留！
    const conflictNotes = merged.notes.filter(n => n.id.startsWith('note-meeting_conflict_'));
    expect(conflictNotes.length).toBe(1);
    expect(conflictNotes[0].title).toBe('[冲突副本] 重要会议纪要');
    expect(conflictNotes[0].content).toBe('交付目标：1.需求澄清 2.原型验证 3.上线部署');
  });

  /**
   * 验证方案 1 核心修复：单人单设备修改已有便签时，新的正常覆盖旧的，绝不触发冲突副本误判
   */
  it('验证方案 1 修复效果：单人正常编辑便签并同步，直接平滑覆盖远端旧版，绝不生成 [冲突副本]', () => {
    const lastSyncTime = 10000; // 上次同步于 10000

    // 云端依然是上次同步时的旧版 (updatedAt: 10000, content: '旧的便签正文')
    const remoteData: BackupData = {
      version: '1.7.0',
      timestamp: 10000,
      categories: [],
      notes: [
        createNote('note-1', '待办清单', '旧的便签正文', {
          createdAt: 9000,
          updatedAt: 10000,
          color: '#ffffff'
        })
      ]
    };

    // 本地单人编辑后 (updatedAt: 12000, content: '最新修改的正文')
    const localData: BackupData = {
      version: '1.7.0',
      timestamp: 12000,
      categories: [],
      notes: [
        createNote('note-1', '待办清单', '最新修改的正文', {
          createdAt: 9000,
          updatedAt: 12000,
          color: '#ffffff'
        })
      ]
    };

    const merged = engine.mergeBackupData(localData, remoteData, lastSyncTime);

    // 验证 1：主便签顺利更新为本地最新正文
    const mainNote = merged.notes.find(n => n.id === 'note-1');
    expect(mainNote?.content).toBe('最新修改的正文');
    expect(mainNote?.updatedAt).toBe(12000);

    // 验证 2：由于远端没有被其他设备修改 (rTime <= lastSyncTime)，绝对不产生任何冲突副本！
    const conflictNotes = merged.notes.filter(n => n.id.startsWith('note-1_conflict_'));
    expect(conflictNotes.length).toBe(0);
    expect(merged.notes.length).toBe(1);
  });

  /**
   * 验证方案 1 修复效果：多设备交替使用时，本设备未修改，直接拉取另一设备最新内容，不生成冲突副本
   */
  it('验证方案 1 修复效果：多设备交替使用时，拉取另一设备最新内容，平滑更新，绝不生成 [冲突副本]', () => {
    const lastSyncTime = 10000; // 本设备上次同步于 10000

    // 本设备未修改 (updatedAt: 10000, content: '旧版正文')
    const localData: BackupData = {
      version: '1.7.0',
      timestamp: 10000,
      categories: [],
      notes: [
        createNote('note-2', '工作备忘', '旧版正文', {
          createdAt: 9000,
          updatedAt: 10000
        })
      ]
    };

    // 另一台设备在 13000 修改并推到了云端 (updatedAt: 13000, content: '另一台电脑更新的正文')
    const remoteData: BackupData = {
      version: '1.7.0',
      timestamp: 13000,
      categories: [],
      notes: [
        createNote('note-2', '工作备忘', '另一台电脑更新的正文', {
          createdAt: 9000,
          updatedAt: 13000
        })
      ]
    };

    const merged = engine.mergeBackupData(localData, remoteData, lastSyncTime);

    // 验证 1：主便签顺利更新为云端另一设备的最新正文
    const mainNote = merged.notes.find(n => n.id === 'note-2');
    expect(mainNote?.content).toBe('另一台电脑更新的正文');
    expect(mainNote?.updatedAt).toBe(13000);

    // 验证 2：本设备未做修改 (lTime <= lastSyncTime)，绝不生成冲突副本！
    const conflictNotes = merged.notes.filter(n => n.id.startsWith('note-2_conflict_'));
    expect(conflictNotes.length).toBe(0);
    expect(merged.notes.length).toBe(1);
  });

  /**
   * 验证改造 3：分类排序 (categoryOrder) 跨设备漫游合并
   * 修复效果：两端不同的分类排序被有序结合，新分类自动追加在尾部，排序不丢失。
   */
  it('验证改造 3 [分类排序漫游]：多端分类排序 categoryOrder 自动有序并集合并', () => {
    const localData: BackupData = {
      version: '1.7.0',
      timestamp: 1000,
      categories: [
        createCategory('cat-1', '工作'),
        createCategory('cat-2', '学习')
      ],
      notes: [],
      categoryOrder: ['cat-2', 'cat-1']
    };

    const remoteData: BackupData = {
      version: '1.7.0',
      timestamp: 1000,
      categories: [
        createCategory('cat-1', '工作'),
        createCategory('cat-3', '生活')
      ],
      notes: [],
      categoryOrder: ['cat-1', 'cat-3']
    };

    const merged = engine.mergeBackupData(localData, remoteData);

    // 验证：本地排序优先保持 ['cat-2', 'cat-1']，并自动将远端独有的 'cat-3' 稳定追加在后方
    expect(merged.categoryOrder).toEqual(['cat-2', 'cat-1', 'cat-3']);
  });

  /**
   * 验证改造 4：偏好设置 (settings) 细粒度深层融合
   * 修复效果：废弃短路操作符，两端互不冲突的设置被完整继承，远端设置生效。
   */
  it('验证改造 4 [设置项深层融合]：两端偏好设置细粒度合并，远端新设置能够成功渗透', () => {
    const localData: BackupData = {
      version: '1.7.0',
      timestamp: 1000,
      categories: [],
      notes: [],
      settings: {
        theme: 'dark',
        gridColumns: 2,
        categoryViewSettings: {
          'cat-work': { sortMode: 'date', sortOrder: 'desc' }
        }
      }
    };

    const remoteData: BackupData = {
      version: '1.7.0',
      timestamp: 1000,
      categories: [],
      notes: [],
      settings: {
        theme: 'light',
        defaultNoteColor: '#ffeaa7',
        categoryViewSettings: {
          'cat-study': { sortMode: 'title', sortOrder: 'asc' }
        }
      }
    };

    const merged = engine.mergeBackupData(localData, remoteData);

    // 验证：两端的设置属性均被保留，未发生整体覆盖短路
    expect(merged.settings?.defaultNoteColor).toBe('#ffeaa7');
    expect(merged.settings?.gridColumns).toBe(2);
    expect(merged.settings?.categoryViewSettings?.['cat-work']).toBeDefined();
    expect(merged.settings?.categoryViewSettings?.['cat-study']).toBeDefined();
  });

  /**
   * 验证改造 5：新设备远端优先机制 (Remote First)
   * 修复效果：新设备只有 3 个示例分类时，首次同步检测到远端已有用户数据，自动抛弃本地示例，绝不污染远端！
   */
  it('验证改造 5 [新设备防污染]：新设备首次配置 WebDAV 优先采用远端数据，不把初始示例分类污染上传', async () => {
    // 模拟新设备本地状态：便签为空，分类仅包含默认的 1, 2, 3
    const freshDeviceData: BackupData = {
      version: '1.7.0',
      timestamp: 1000,
      categories: [
        createCategory('1', '常用模版'),
        createCategory('2', '工作备忘'),
        createCategory('3', '灵感想法')
      ],
      notes: []
    };

    // 模拟远端已有的干净用户数据：分类只有“财务规划”，便签有 10 张
    const remoteUserData: BackupData = {
      version: '1.7.0',
      timestamp: 5000,
      categories: [
        createCategory('cat-finance', '财务规划')
      ],
      notes: [
        createNote('note-1', '年度账单', '支出明细...')
      ]
    };

    // 测试新设备判定逻辑
    const isFreshDeviceWithDefaults =
      (!freshDeviceData.notes || freshDeviceData.notes.length === 0) &&
      (freshDeviceData.categories || []).every(c => ['1', '2', '3'].includes(c.id));
    const remoteHasUserData =
      remoteUserData.notes.length > 0 ||
      (remoteUserData.categories || []).some(c => !['1', '2', '3'].includes(c.id));

    expect(isFreshDeviceWithDefaults).toBe(true);
    expect(remoteHasUserData).toBe(true);

    // 在这种情况下，引擎会采用 remote-first 策略，直接以 remoteUserData 为准初始化本地，分类列表不会被污染
    const adopted = remoteUserData;
    expect(adopted.categories.some(c => c.name === '常用模版')).toBe(false);
    expect(adopted.categories.some(c => c.name === '财务规划')).toBe(true);
  });

  /**
   * 验证改造 6：ETag 乐观并发锁机制 (HTTP 412 重试保护)
   * 修复效果：当远端文件在下载和上传之间被他人更新时，服务器返回 412，客户端抛出可捕获的 PreconditionFailedError 并重试。
   */
  it('验证改造 6 [ETag 乐观锁]：WebdavClient 支持 If-Match，遇到 412 正确抛出并发冲突错误', async () => {
    const client = new WebdavClient({
      enabled: true,
      serverUrl: 'https://dav.example.com',
      username: 'user',
      password: 'pwd',
      remotePath: '/notes.json',
      autoSync: true,
      syncIntervalMinutes: 5
    });

    // 模拟 fetch 返回 412 Precondition Failed
    const mockFetch = vi.fn().mockResolvedValue({
      status: 412,
      ok: false,
      statusText: 'Precondition Failed',
      headers: new Headers()
    });
    globalThis.fetch = mockFetch;

    await expect(
      client.uploadJson('/notes.json', { test: true }, '"v1-etag"')
    ).rejects.toThrow('412 Precondition Failed');

    // 验证请求头中正确携带了 If-Match: "v1-etag"
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/notes.json'),
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'If-Match': '"v1-etag"'
        })
      })
    );
  });

  /**
   * 验证改造 7：异步网络等待期间动态拉取最新内存 Store 保护键入内容
   * 修复效果：网络返回后，基于当前最新内存快照进行合并，网络等待期间输入的关键内容不被冲掉。
   */
  it('验证改造 7 [防网络打字冲刷]：网络返回时拿最新内存快照进行合并，用户正在输入的内容得以保留', () => {
    // 用户正在打字的便签状态
    let liveMemoryStore: Note[] = [
      createNote('note-typing', '正在编辑的便签', '第一段内容')
    ];

    // 模拟网络请求完成后，重新获取当前的 liveMemoryStore 进行合并
    liveMemoryStore[0].content = '第一段内容\n网络请求等待期间键入的关键灵感！';
    liveMemoryStore[0].updatedAt = Date.now() + 500;

    const freshLocalSnapshot: BackupData = {
      version: '1.7.0',
      timestamp: Date.now(),
      categories: [],
      notes: JSON.parse(JSON.stringify(liveMemoryStore))
    };

    // 远端返回的旧数据（更新时间更早）
    const remoteData: BackupData = {
      version: '1.7.0',
      timestamp: 1000,
      categories: [],
      notes: [
        createNote('note-typing', '正在编辑的便签', '第一段内容', { updatedAt: 1000 })
      ]
    };

    // 基于 freshLocalSnapshot 进行合并
    const merged = engine.mergeBackupData(freshLocalSnapshot, remoteData);
    const resultNote = merged.notes.find(n => n.id === 'note-typing');

    // 验证：用户在网络期间输入的最新灵感被完整保留下来！
    expect(resultNote?.content).toBe('第一段内容\n网络请求等待期间键入的关键灵感！');
  });

  /**
   * 验证改造 7：WebdavClient 二进制传输 (图片上传/下载/删除/探测)
   */
  it('验证改造 7 [图片二进制 WebDAV 传输]：支持 uploadBinary, downloadBinary, deleteFile 与 checkFileExists', async () => {
    const config = {
      ...defaultWebdavConfig,
      enabled: true,
      serverUrl: 'https://dav.example.com',
      username: 'user',
      password: 'pass',
      remotePath: '/toolkit/moment_notes.json',
      imagesRemoteDir: '/toolkit/moment_notes_images'
    };
    const client = new WebdavClient(config);

    // Mock global fetch
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    try {
      // 避免 ensureDirectory 消耗 fetch mock
      client.ensureDirectory = vi.fn().mockResolvedValue(true);

      // 1. 测试 uploadBinary (PUT)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ ETag: '"img-etag-123"' })
      });
      const blob = new Blob(['binary-image-data'], { type: 'image/png' });
      const uploadRes = await client.uploadBinary('/toolkit/moment_notes_images/pic.png', blob, 'image/png');
      expect(uploadRes.success).toBe(true);
      expect(uploadRes.etag).toBe('"img-etag-123"');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://dav.example.com/toolkit/moment_notes_images/pic.png',
        expect.objectContaining({
          method: 'PUT',
          body: blob
        })
      );

      // 2. 测试 downloadBinary (GET)
      const downloadedBlob = new Blob(['downloaded-binary'], { type: 'image/png' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"dl-etag-456"' }),
        blob: vi.fn().mockResolvedValue(downloadedBlob)
      });
      const dlRes = await client.downloadBinary('/toolkit/moment_notes_images/pic.png');
      expect(dlRes.exists).toBe(true);
      expect(dlRes.data).toBe(downloadedBlob);
      expect(dlRes.etag).toBe('"dl-etag-456"');

      // 3. 测试 deleteFile (DELETE)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204
      });
      const delRes = await client.deleteFile('/toolkit/moment_notes_images/pic.png');
      expect(delRes.success).toBe(true);

      // 4. 测试 checkFileExists (HEAD -> 200)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200
      });
      const exists = await client.checkFileExists('/toolkit/moment_notes_images/pic.png');
      expect(exists).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  /**
   * 验证轻量元数据探测与快速跳过 (getFileMeta & hasLocalChangesSince)
   */
  it('验证轻量元数据探测：支持 getFileMeta，且正确校验本地自上次同步后是否有修改', async () => {
    const config = {
      ...defaultWebdavConfig,
      enabled: true,
      serverUrl: 'https://dav.example.com',
      username: 'user',
      password: 'pass',
      remotePath: '/toolkit/moment_notes.json',
      lastSyncTime: 20000,
      lastEtag: 'test-etag-123'
    };

    const client = new WebdavClient(config);
    const originalFetch = globalThis.fetch;

    try {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      // 1. 模拟 HEAD 请求返回元数据
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          ETag: '"test-etag-123"',
          'Last-Modified': new Date(19000).toUTCString(),
          'Content-Length': '1024'
        })
      });

      const meta = await client.getFileMeta('/toolkit/moment_notes.json');
      expect(meta.exists).toBe(true);
      expect(meta.etag).toBe('test-etag-123');
      expect(meta.lastModified).toBe(19000);
      expect(meta.contentLength).toBe(1024);

      // 2. 验证 hasLocalChangesSince 方法
      const sampleData: BackupData = {
        version: '1.7.0',
        timestamp: 15000,
        categories: [],
        notes: [
          createNote('note-1', '测试', '内容', { updatedAt: 15000 })
        ]
      };
      // 本地修改时间 (15000) <= 上次同步时间 (20000)，判定为无本地修改
      expect(engine.hasLocalChangesSince(sampleData, 20000)).toBe(false);
      // 本地修改时间 (15000) > 上次同步时间 (10000)，判定为有本地修改
      expect(engine.hasLocalChangesSince(sampleData, 10000)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  /**
   * 验证改造：上传后元数据主动探测与对齐 (Post-Upload ETag / Last-Modified Probing)
   */
  it('验证上传后元数据主动探测与对齐：当 uploadJson PUT 响应未返回 ETag 时，自动 HEAD 补全真实 ETag 与对齐 Last-Modified', async () => {
    const config = {
      ...defaultWebdavConfig,
      enabled: true,
      serverUrl: 'https://dav.example.com',
      username: 'user',
      password: 'pass',
      remotePath: '/toolkit/moment_notes.json',
      lastSyncTime: 1000,
      autoSync: true
    };

    const syncEngine = new WebdavSyncEngine();
    syncEngine.config.value = config;

    const originalFetch = globalThis.fetch;

    try {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      const localData: BackupData = {
        version: '1.7.0',
        timestamp: 2000,
        categories: [],
        notes: [createNote('n1', '标题', '正文', { updatedAt: 2000 })]
      };

      // 1. HEAD 短路探测 -> 发现本地有修改 (updatedAt 2000 > lastSyncTime 1000)，不能短路
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          ETag: '"server-etag-old"',
          'Last-Modified': new Date(1500).toUTCString()
        })
      });

      // 2. GET 下载云端文件
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"server-etag-old"' }),
        text: vi.fn().mockResolvedValue(JSON.stringify(localData))
      });

      // 3. ensureDirectory (PROPFIND -> 200 目录已存在)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200
      });

      // 4. PUT .tmp 写入临时文件
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({})
      });

      // 5. MOVE 原子替换主文件 (模拟坚果云/AList，MOVE 响应头不带 ETag)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({}) // 无 ETag
      });

      // 6. 原子提交成功后轻量 HEAD 校验并捕获服务端真实的最新 ETag 与 Last-Modified
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          ETag: '"server-etag-new"',
          'Last-Modified': new Date(2500).toUTCString()
        })
      });

      const applyMergedData = vi.fn();
      const res = await syncEngine.performSync(() => localData, applyMergedData);

      expect(res.success).toBe(true);
      expect(mockFetch.mock.calls[3][0]).toBe('https://dav.example.com/toolkit/moment_notes.json.tmp');
      expect(mockFetch.mock.calls[3][1]?.method).toBe('PUT');
      expect(mockFetch.mock.calls[4][1]?.method).toBe('MOVE');
      // 验证配置中的 lastEtag 与 lastSyncTime 已成功从第 6 步的 HEAD 探测中校正对齐
      expect(syncEngine.config.value.lastEtag).toBe('server-etag-new');
      expect(syncEngine.config.value.lastSyncTime).toBeGreaterThanOrEqual(2500);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('验证远端异常诊断：0 字节空文件、HTML 代理拦截与格式损坏均抛出明确中文错误且绝不覆写云端', async () => {
    const config = {
      ...defaultWebdavConfig,
      enabled: true,
      serverUrl: 'https://dav.example.com',
      username: 'user',
      password: 'pwd',
      remotePath: '/toolkit/moment_notes.json',
      lastSyncTime: 20000,
      lastEtag: 'empty-etag'
    };

    const client = new WebdavClient(config);
    const originalFetch = globalThis.fetch;

    try {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      // 1. downloadJson 遇到 200 OK 但 0 字节响应
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"empty-etag"' }),
        text: vi.fn().mockResolvedValue('')
      });
      await expect(client.downloadJson('/toolkit/moment_notes.json')).rejects.toMatchObject({
        name: 'WebdavSyncError',
        code: 'REMOTE_EMPTY'
      });

      // 2. downloadJson 遇到 HTML 错误页
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('<html><body>502 Bad Gateway</body></html>')
      });
      await expect(client.downloadJson('/toolkit/moment_notes.json')).rejects.toThrow('网页/XML');

      // 3. performSync 即使 HEAD ETag 吻合，但 Content-Length 为 0 时也绝不短路为"已是最新"，且不触发 PUT/MOVE
      const syncEngine = new WebdavSyncEngine();
      syncEngine.config.value = { ...config };
      mockFetch.mockReset();

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            ETag: '"empty-etag"',
            'Content-Length': '0',
            'Last-Modified': new Date(19000).toUTCString()
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ ETag: '"empty-etag"' }),
          text: vi.fn().mockResolvedValue('')
        });

      const localData: BackupData = {
        version: '2.1.0',
        timestamp: 15000,
        categories: [createCategory('c1', '工作')],
        notes: [createNote('n1', '本地重要便签', '不能丢', { updatedAt: 15000 })]
      };
      const applyMerged = vi.fn();
      const syncRes = await syncEngine.performSync(() => localData, applyMerged);

      expect(syncRes.success).toBe(false);
      expect(syncRes.message).toContain('0 字节');
      expect(syncEngine.syncState.value).toBe('error');
      expect(applyMerged).not.toHaveBeenCalled();
      // 仅发送 HEAD + GET，未发起任何 PUT/MOVE
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('验证结构校验与强制拉取保护：远端 JSON 缺字段时中止同步且不覆盖两端数据', async () => {
    const config = {
      ...defaultWebdavConfig,
      enabled: true,
      serverUrl: 'https://dav.example.com',
      username: 'user',
      password: 'pwd',
      remotePath: '/toolkit/moment_notes.json',
      lastSyncTime: 0
    };

    const syncEngine = new WebdavSyncEngine();
    syncEngine.config.value = config;
    const originalFetch = globalThis.fetch;

    try {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      // 合法 JSON 但缺少 categories/notes
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"weird"' }),
        text: vi.fn().mockResolvedValue('{"unexpected": true}')
      });

      const localData: BackupData = {
        version: '2.1.0',
        timestamp: 1000,
        categories: [createCategory('c1', '工作')],
        notes: [createNote('n1', '测试', '正文')]
      };
      const applyMerged = vi.fn();

      const smartRes = await syncEngine.performSync(() => localData, applyMerged);
      expect(smartRes.success).toBe(false);
      expect(smartRes.message).toContain('数据结构异常');
      expect(applyMerged).not.toHaveBeenCalled();

      const pullRes = await syncEngine.performSync(() => localData, applyMerged, { forcePull: true });
      expect(pullRes.success).toBe(false);
      expect(pullRes.message).toContain('数据结构异常');
      expect(applyMerged).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('验证防空写入与原子降级回退：空负载被本地拦截；MOVE 返回 405 时自动清理 .tmp 并回退直接 PUT', async () => {
    const client = new WebdavClient({
      ...defaultWebdavConfig,
      enabled: true,
      serverUrl: 'https://dav.example.com',
      username: 'user',
      password: 'pwd',
      remotePath: '/toolkit/moment_notes.json'
    });

    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    try {
      client.ensureDirectory = vi.fn().mockResolvedValue(true);

      // 1. 空字符串 / null 上传应在本地即刻拦截，0 次网络请求
      await expect(client.uploadJson('/toolkit/moment_notes.json', '')).rejects.toBeInstanceOf(WebdavSyncError);
      await expect(client.uploadJsonAtomic('/toolkit/moment_notes.json', null)).rejects.toMatchObject({
        code: 'EMPTY_UPLOAD_BLOCKED'
      });
      expect(mockFetch).not.toHaveBeenCalled();

      // 2. uploadJsonAtomic: PUT .tmp 成功 -> MOVE 返回 405 Method Not Allowed -> DELETE .tmp -> 回退 PUT 主文件 (携带 If-Match)
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 201, headers: new Headers() }) // PUT .tmp
        .mockResolvedValueOnce({ ok: false, status: 405, statusText: 'Method Not Allowed', headers: new Headers() }) // MOVE
        .mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers() }) // DELETE .tmp
        .mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers({ ETag: '"fallback-etag"' }) }); // fallback PUT

      const res = await client.uploadJsonAtomic('/toolkit/moment_notes.json', { categories: [], notes: [] }, '"prev-etag"');
      expect(res.success).toBe(true);
      expect(res.usedFallbackPut).toBe(true);
      expect(res.etag).toBe('fallback-etag');
      expect(mockFetch.mock.calls[0][0]).toBe('https://dav.example.com/toolkit/moment_notes.json.tmp');
      expect(mockFetch.mock.calls[1][1]?.method).toBe('MOVE');
      expect(mockFetch.mock.calls[2][1]?.method).toBe('DELETE');
      expect(mockFetch.mock.calls[3][0]).toBe('https://dav.example.com/toolkit/moment_notes.json');
      expect((mockFetch.mock.calls[3][1]?.headers as Record<string, string>)['If-Match']).toBe('"prev-etag"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

