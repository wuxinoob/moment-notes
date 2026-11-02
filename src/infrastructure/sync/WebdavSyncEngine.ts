import { ref } from 'vue';
import { WebdavConfig, WebdavSyncState, BackupData, Note, Category } from '@type';
import { storage } from '@utils/storage';
import { BackupCodec, draftBufferRepository } from '../storage/Repository';
import { imageRepository } from '../storage/ImageRepository';

export const WEBDAV_CONFIG_STORAGE_KEY = 'sticky_notes_webdav_config';

export const defaultWebdavConfig: WebdavConfig = {
  enabled: false,
  serverUrl: '',
  username: '',
  password: '',
  remotePath: '/toolkit/moment_notes.json',
  autoSync: true,
  syncIntervalMinutes: 5,
  lastSyncStatus: 'idle',
  lastSyncTime: undefined,
  lastSyncMessage: '',
  syncImages: true,
  imagesRemoteDir: '/toolkit/moment_notes_images',
  autoCompressImages: true,
  maxImageSizeMB: 10
};

/**
 * 原生 WebDAV HTTP 协议客户端
 * 支持标准 WebDAV 服务器 (坚果云 / Nextcloud / OwnCloud / Synology / AList / InfiniCLOUD)
 */
export class WebdavClient {
  private config: WebdavConfig;

  constructor(config: WebdavConfig) {
    this.config = config;
  }

  private getAuthHeader(): string {
    const user = this.config.username || '';
    const pass = this.config.password || '';
    try {
      // 兼容中文与特殊字符的 Base64 编码
      const token = btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
      return `Basic ${token}`;
    } catch {
      return `Basic ${btoa(`${user}:${pass}`)}`;
    }
  }

  private getFullUrl(path: string): string {
    let base = (this.config.serverUrl || '').trim();
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      base = `https://${base}`;
    }
    base = base.replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  /**
   * 测试连接有效性
   */
  public async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.config.serverUrl) {
      return { success: false, message: '请输入 WebDAV 服务器地址' };
    }
    const targetUrl = this.getFullUrl('/');
    try {
      const res = await fetch(targetUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: this.getAuthHeader(),
          Depth: '0'
        }
      }).catch(async () => {
        // 部分服务不支持 PROPFIND 根路径，降级为 OPTIONS / GET
        return await fetch(targetUrl, {
          method: 'OPTIONS',
          headers: {
            Authorization: this.getAuthHeader()
          }
        });
      });

      if (res.status === 401 || res.status === 403) {
        return { success: false, message: '认证失败：用户名或应用密码错误 (HTTP ' + res.status + ')' };
      }
      if (res.status >= 200 && res.status < 400) {
        return { success: true, message: 'WebDAV 服务器连接成功！' };
      }
      return { success: false, message: `服务器响应异常 (HTTP ${res.status}: ${res.statusText})` };
    } catch (err: any) {
      return { success: false, message: `网络连接失败: ${err.message || '请检查服务器地址与网络'}` };
    }
  }

  /**
   * 确保远端文件夹存在 (自动递归创建目录)
   */
  public async ensureDirectory(dirPath: string): Promise<boolean> {
    const segments = dirPath.split('/').filter(Boolean);
    let currentPath = '';

    for (const segment of segments) {
      currentPath += `/${segment}`;
      const url = this.getFullUrl(currentPath);
      try {
        const checkRes = await fetch(url, {
          method: 'PROPFIND',
          headers: {
            Authorization: this.getAuthHeader(),
            Depth: '0'
          }
        });

        if (checkRes.status === 404) {
          await fetch(url, {
            method: 'MKCOL',
            headers: {
              Authorization: this.getAuthHeader()
            }
          });
        }
      } catch {
        // 忽略中间错误，尝试继续后续操作
      }
    }
    return true;
  }

  /**
   * 获取远端文件元数据 (通过轻量 HTTP HEAD 获取 Last-Modified 与 ETag，无需下载具体文件体，节省 99.9% 流量)
   */
  public async getFileMeta(remotePath: string): Promise<{
    exists: boolean;
    lastModified?: number;
    etag?: string;
    contentLength?: number;
  }> {
    const url = this.getFullUrl(remotePath);
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: {
          Authorization: this.getAuthHeader(),
          'Cache-Control': 'no-cache'
        }
      });

      if (res.status === 404) {
        return { exists: false };
      }

      if (!res.ok) {
        return { exists: false };
      }

      const rawEtag = res.headers.get('ETag') || undefined;
      const cleanEtag = rawEtag?.replace(/^W\//, '').replace(/"/g, '').trim();

      const lastModifiedHeader = res.headers.get('Last-Modified');
      const lastModified = lastModifiedHeader ? new Date(lastModifiedHeader).getTime() : undefined;
      const contentLength = res.headers.get('Content-Length') ? Number(res.headers.get('Content-Length')) : undefined;

      return {
        exists: true,
        etag: cleanEtag || rawEtag,
        lastModified,
        contentLength
      };
    } catch {
      return { exists: false };
    }
  }

  /**
   * 下载远端 JSON 文件 (附带 ETag 标记)
   */
  public async downloadJson<T = any>(remotePath: string): Promise<{ exists: boolean; data: T | null; etag?: string }> {
    const url = this.getFullUrl(remotePath);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
          'Cache-Control': 'no-cache'
        }
      });

      if (res.status === 404) {
        return { exists: false, data: null };
      }

      if (!res.ok) {
        throw new Error(`下载失败 HTTP ${res.status}: ${res.statusText}`);
      }

      const etag = res.headers.get('ETag') || undefined;
      const text = await res.text();
      const parsed = JSON.parse(text);
      return { exists: true, data: parsed, etag };
    } catch (err: any) {
      if (err.message && err.message.includes('404')) {
        return { exists: false, data: null };
      }
      throw err;
    }
  }

  /**
   * 上传 JSON 文件至 WebDAV 远端 (支持 If-Match 乐观并发锁)
   */
  public async uploadJson(remotePath: string, data: any, ifMatch?: string): Promise<{ success: boolean; etag?: string }> {
    const lastSlash = remotePath.lastIndexOf('/');
    if (lastSlash > 0) {
      const dirPath = remotePath.substring(0, lastSlash);
      await this.ensureDirectory(dirPath);
    }

    const url = this.getFullUrl(remotePath);
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      'Content-Type': 'application/json; charset=utf-8'
    };
    if (ifMatch) {
      headers['If-Match'] = ifMatch;
    }

    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: content
    });

    if (res.status === 412) {
      const err = new Error('412 Precondition Failed: 远端文件在此期间已被其他设备更新');
      (err as any).status = 412;
      (err as any).isPreconditionFailed = true;
      throw err;
    }

    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`上传失败 HTTP ${res.status}: ${res.statusText}`);
    }

    const rawEtag = res.headers.get('ETag') || undefined;
    const cleanEtag = rawEtag?.replace(/^W\//, '').replace(/"/g, '').trim();
    return { success: true, etag: cleanEtag || rawEtag };
  }

  /**
   * 上传二进制文件 (图片附件等) 至 WebDAV 远端
   */
  public async uploadBinary(
    remotePath: string,
    data: Blob | ArrayBuffer,
    mimeType = 'image/png'
  ): Promise<{ success: boolean; etag?: string }> {
    const lastSlash = remotePath.lastIndexOf('/');
    if (lastSlash > 0) {
      const dirPath = remotePath.substring(0, lastSlash);
      await this.ensureDirectory(dirPath);
    }

    const url = this.getFullUrl(remotePath);
    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      'Content-Type': mimeType
    };

    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: data
    });

    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`二进制上传失败 HTTP ${res.status}: ${res.statusText}`);
    }

    const newEtag = res.headers.get('ETag') || undefined;
    return { success: true, etag: newEtag };
  }

  /**
   * 下载二进制文件 (图片附件等)
   */
  public async downloadBinary(remotePath: string): Promise<{ exists: boolean; data: Blob | null; etag?: string }> {
    const url = this.getFullUrl(remotePath);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
          'Cache-Control': 'no-cache'
        }
      });

      if (res.status === 404) {
        return { exists: false, data: null };
      }

      if (!res.ok) {
        throw new Error(`二进制下载失败 HTTP ${res.status}: ${res.statusText}`);
      }

      const etag = res.headers.get('ETag') || undefined;
      const blob = await res.blob();
      return { exists: true, data: blob, etag };
    } catch (err: any) {
      if (err.message && err.message.includes('404')) {
        return { exists: false, data: null };
      }
      throw err;
    }
  }

  /**
   * 删除 WebDAV 远端文件
   */
  public async deleteFile(remotePath: string): Promise<{ success: boolean }> {
    const url = this.getFullUrl(remotePath);
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: this.getAuthHeader()
        }
      });

      if (res.status === 404 || res.ok || res.status === 204) {
        return { success: true };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  }

  /**
   * 检查远端文件是否存在
   */
  public async checkFileExists(remotePath: string): Promise<boolean> {
    const url = this.getFullUrl(remotePath);
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: {
          Authorization: this.getAuthHeader()
        }
      }).catch(async () => {
        return await fetch(url, {
          method: 'PROPFIND',
          headers: {
            Authorization: this.getAuthHeader(),
            Depth: '0'
          }
        });
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }
}

/**
 * WebDAV 双向同步引擎
 */
export class WebdavSyncEngine {
  private static instance: WebdavSyncEngine;
  public config = ref<WebdavConfig>(this.loadConfig());
  public syncState = ref<WebdavSyncState>('idle');
  public syncMessage = ref<string>('');
  public isSyncing = ref<boolean>(false);

  private debounceTimer: any = null;
  private pollingTimer: any = null;

  private dataGetter: (() => BackupData) | null = null;
  private dataApplier: ((data: BackupData) => void) | null = null;

  public static getInstance(): WebdavSyncEngine {
    if (!WebdavSyncEngine.instance) {
      WebdavSyncEngine.instance = new WebdavSyncEngine();
    }
    return WebdavSyncEngine.instance;
  }

  /**
   * 读取持久化配置
   */
  public loadConfig(): WebdavConfig {
    const raw = storage.getItem(WEBDAV_CONFIG_STORAGE_KEY);
    if (!raw) return { ...defaultWebdavConfig };
    try {
      const parsed = JSON.parse(raw);
      if (parsed.remotePath === '/ScriptKit/moment_notes.json') {
        parsed.remotePath = '/toolkit/moment_notes.json';
      }
      return {
        ...defaultWebdavConfig,
        ...parsed
      };
    } catch {
      return { ...defaultWebdavConfig };
    }
  }

  /**
   * 保存配置，并响应式刷新调度器生命周期
   */
  public saveConfig(newConfig: Partial<WebdavConfig>): void {
    this.config.value = {
      ...this.config.value,
      ...newConfig
    };
    storage.setItem(WEBDAV_CONFIG_STORAGE_KEY, JSON.stringify(this.config.value));

    // 动态重置或重启轮询调度器，确保修改配置后立即生效
    this.restartPolling();
  }

  /**
   * 注册应用数据访问器 (在主 Store 初始化时注入)
   */
  public initScheduler(
    getLocalData: () => BackupData,
    applyMergedData: (data: BackupData) => void
  ): void {
    this.dataGetter = getLocalData;
    this.dataApplier = applyMergedData;
    this.restartPolling();
  }

  /**
   * 启动后台轮询定时调度器
   */
  public startPolling(): void {
    this.stopPolling();

    const cfg = this.config.value;
    if (!cfg.enabled || !cfg.autoSync || !this.dataGetter || !this.dataApplier) {
      return;
    }

    const intervalMinutes = Math.max(1, cfg.syncIntervalMinutes || 5);
    this.pollingTimer = setInterval(() => {
      if (this.config.value.enabled && this.config.value.autoSync) {
        this.performSync(this.dataGetter!, this.dataApplier!, { silent: true }).catch(() => {});
      }
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * 停止轮询定时调度器
   */
  public stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /**
   * 重启轮询调度器
   */
  public restartPolling(): void {
    this.stopPolling();
    this.startPolling();
  }

  private lastTriggerTime = 0;

  /**
   * 触发一次无感轻量同步检查 (供快捷键呼出、网页切换回前台等事件调用，内置防刷节流)
   */
  public async triggerSyncCheck(options?: { silent?: boolean; minIntervalMs?: number }): Promise<any> {
    const cfg = this.config.value;
    if (!cfg.enabled) {
      return { success: false, message: 'WebDAV 未启用' };
    }
    const minInterval = options?.minIntervalMs ?? 10000; // 默认 10 秒冷却防刷
    const now = Date.now();
    if (now - this.lastTriggerTime < minInterval) {
      return { success: true, message: '同步检查冷却中，已跳过', throttled: true };
    }
    this.lastTriggerTime = now;

    if (!this.dataGetter || !this.dataApplier) {
      return { success: false, message: '调度器未准备就绪' };
    }

    return this.performSync(this.dataGetter, this.dataApplier, { silent: options?.silent ?? true });
  }

  /**
   * 检查本地数据集自指定时间戳之后是否发生过实质性变更
   */
  public hasLocalChangesSince(data: BackupData, timestamp: number): boolean {
    if (!timestamp || timestamp <= 0) return true;
    for (const note of data.notes || []) {
      const editTime = Math.max(note.updatedAt || 0, note.deletedAt || 0, note.purgedAt || 0, note.createdAt || 0);
      if (editTime > timestamp) return true;
    }
    for (const cat of data.categories || []) {
      const editTime = Math.max(cat.updatedAt || 0, cat.deletedAt || 0, cat.purgedAt || 0, cat.createdAt || 0);
      if (editTime > timestamp) return true;
    }
    return false;
  }

  /**
   * 墓碑双向智能冲突合并算法 (Tombstone-Aware Smart Merge + Conflict Copy)
   * 1. 纳入 isPurged / purgedAt 彻底删除墓碑状态，彻底解决清空垃圾箱后死者复生问题；
   * 2. 冲突副本保护 (Conflict Copy)：当两端在未同步期间并发编辑同一张便签正文时，自动保留两端内容，生成 [冲突副本]，零数据丢失；
   * 3. 分类排序 (categoryOrder) 漫游合并；
   * 4. 偏好设置 (settings) 细粒度深层融合；
   * 5. 自动执行超过 30 天的过期墓碑垃圾回收 (Tombstone GC)。
   */
  public mergeBackupData(localData: BackupData, remoteData: BackupData, lastSyncTime?: number): BackupData {
    const now = Date.now();
    const GC_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30天以上的删除墓碑安全物理清理
    const syncAnchor = lastSyncTime !== undefined ? lastSyncTime : (this.config.value?.lastSyncTime || 0);

    // 1. 合并便签列表 (Notes)
    const noteMap = new Map<string, Note>();
    const allNoteIds = new Set<string>();
    for (const n of localData.notes || []) {
      if (n && n.id) allNoteIds.add(n.id);
    }
    for (const n of remoteData.notes || []) {
      if (n && n.id) allNoteIds.add(n.id);
    }

    const localNoteMap = new Map((localData.notes || []).map(n => [n.id, n]));
    const remoteNoteMap = new Map((remoteData.notes || []).map(n => [n.id, n]));

    for (const id of allNoteIds) {
      const lNote = localNoteMap.get(id);
      const rNote = remoteNoteMap.get(id);

      if (lNote && !rNote) {
        noteMap.set(id, lNote);
      } else if (!lNote && rNote) {
        noteMap.set(id, rNote);
      } else if (lNote && rNote) {
        // A. 彻底删除 (isPurged) 墓碑同步判定
        const lPurged = Boolean(lNote.isPurged);
        const rPurged = Boolean(rNote.isPurged);
        const lPurgedTime = lNote.purgedAt || 0;
        const rPurgedTime = rNote.purgedAt || 0;
        const maxPurgedTime = Math.max(lPurgedTime, rPurgedTime);

        const lEditTime = Math.max(lNote.updatedAt || 0, lNote.createdAt || 0);
        const rEditTime = Math.max(rNote.updatedAt || 0, rNote.createdAt || 0);
        const maxEditTime = Math.max(lEditTime, rEditTime);

        if ((lPurged || rPurged) && maxPurgedTime >= maxEditTime) {
          noteMap.set(id, {
            ...(lPurged ? lNote : rNote),
            isDeleted: true,
            isPurged: true,
            purgedAt: maxPurgedTime
          });
          continue;
        }

        // B. 冲突副本保护机制 (Conflict Copy - 方案 1：基准时间锚点判定)
        // 条件：
        // 1. 双方均处于活跃状态 (未被删除、未彻底清理)
        // 2. 双方正文或标题存在实质性分歧 (isContentConflict)
        // 3. 发生真正的并发分歧：
        //    - 若存在同步锚点 (syncAnchor > 0)，两端各自的更新时间均晚于上次同步时间 (lTime > syncAnchor && rTime > syncAnchor)
        //    - 或两端修改时间戳完全相同且分歧 (lTime === rTime)
        const bothActive = !lNote.isDeleted && !rNote.isDeleted && !lPurged && !rPurged;
        const isContentConflict =
          lNote.content !== rNote.content ||
          (lNote.title || '') !== (rNote.title || '');

        const lTime = Math.max(lNote.updatedAt || 0, lNote.deletedAt || 0, lNote.createdAt || 0);
        const rTime = Math.max(rNote.updatedAt || 0, rNote.deletedAt || 0, rNote.createdAt || 0);

        const isConcurrentConflict =
          bothActive &&
          isContentConflict &&
          ((syncAnchor > 0 && lTime > syncAnchor && rTime > syncAnchor) || lTime === rTime);

        if (isConcurrentConflict) {
          // 产生实质分歧冲突，绝不静默抹除！保留较新版为主记录，克隆较旧版为冲突副本
          const winner = lTime >= rTime ? lNote : rNote;
          const loser = lTime >= rTime ? rNote : lNote;
          noteMap.set(id, winner);

          const conflictId = `${id}_conflict_${Math.min(lTime, rTime)}`;
          if (!noteMap.has(conflictId)) {
            const conflictNote: Note = {
              ...loser,
              id: conflictId,
              title: `[冲突副本] ${loser.title || '便签'}`,
              createdAt: now,
              updatedAt: now
            };
            noteMap.set(conflictId, conflictNote);
          }
        } else {
          // 单向正常演进 (Fast-Forward) 或时间戳先后判定：按时间戳 LWW 决胜，直接平滑覆盖无副本
          if (lTime >= rTime) {
            noteMap.set(id, lNote);
          } else {
            noteMap.set(id, rNote);
          }
        }
      }
    }

    // 过滤超过 30 天的过期已删除/彻底清除便签 (GC 垃圾回收)
    const activeNotes = Array.from(noteMap.values()).filter(note => {
      if (note.isPurged && note.purgedAt && (now - note.purgedAt > GC_THRESHOLD_MS)) {
        return false;
      }
      if (note.isDeleted && note.deletedAt && (now - note.deletedAt > GC_THRESHOLD_MS)) {
        return false;
      }
      return true;
    });

    // 2. 合并分类列表 (Categories)
    const catMap = new Map<string, Category>();
    const allCatIds = new Set<string>();
    for (const c of localData.categories || []) {
      if (c && c.id) allCatIds.add(c.id);
    }
    for (const c of remoteData.categories || []) {
      if (c && c.id) allCatIds.add(c.id);
    }

    const localCatMap = new Map((localData.categories || []).map(c => [c.id, c]));
    const remoteCatMap = new Map((remoteData.categories || []).map(c => [c.id, c]));

    for (const id of allCatIds) {
      const lCat = localCatMap.get(id);
      const rCat = remoteCatMap.get(id);

      if (lCat && !rCat) {
        catMap.set(id, lCat);
      } else if (!lCat && rCat) {
        catMap.set(id, rCat);
      } else if (lCat && rCat) {
        const lTime = Math.max(lCat.updatedAt || 0, lCat.deletedAt || 0, lCat.createdAt || 0);
        const rTime = Math.max(rCat.updatedAt || 0, rCat.deletedAt || 0, rCat.createdAt || 0);

        if (lTime >= rTime) {
          catMap.set(id, lCat);
        } else {
          catMap.set(id, rCat);
        }
      }
    }

    // 过滤超过 30 天的过期已删除分类 (GC 垃圾回收)
    const activeCategories = Array.from(catMap.values()).filter(cat => {
      if (cat.isDeleted && cat.deletedAt && (now - cat.deletedAt > GC_THRESHOLD_MS)) {
        return false;
      }
      return true;
    });

    // 3. 合并分类排序 (Category Order 漫游合并)
    const localOrder = localData.categoryOrder || [];
    const remoteOrder = remoteData.categoryOrder || [];
    const mergedOrderSet = new Set<string>();
    const mergedCategoryOrder: string[] = [];

    // 优先保留本地排序次序
    for (const catId of localOrder) {
      if (!mergedOrderSet.has(catId)) {
        mergedOrderSet.add(catId);
        mergedCategoryOrder.push(catId);
      }
    }
    // 补齐远端独有的分类排序
    for (const catId of remoteOrder) {
      if (!mergedOrderSet.has(catId)) {
        mergedOrderSet.add(catId);
        mergedCategoryOrder.push(catId);
      }
    }
    // 补齐活跃分类列表中未包含在排序中的分类
    for (const cat of activeCategories) {
      if (!mergedOrderSet.has(cat.id)) {
        mergedOrderSet.add(cat.id);
        mergedCategoryOrder.push(cat.id);
      }
    }

    // 4. 合并偏好设置 (Settings 属性级细粒度融合)
    const localSettings = localData.settings || {};
    const remoteSettings = remoteData.settings || {};
    const mergedSettings = {
      ...remoteSettings,
      ...localSettings,
      categoryViewSettings: {
        ...(remoteSettings.categoryViewSettings || {}),
        ...(localSettings.categoryViewSettings || {})
      },
      shortcuts: localSettings.shortcuts || remoteSettings.shortcuts
    };

    return {
      version: '1.7.0',
      timestamp: now,
      categories: activeCategories,
      notes: activeNotes,
      categoryOrder: mergedCategoryOrder,
      settings: mergedSettings
    };
  }

  /**
   * 执行完整的 WebDAV 云同步流程 (支持双向墓碑合并、ETag 乐观锁重试、防网络打字冲刷、强制推送与拉取)
   */
  public async performSync(
    getLocalData: () => BackupData,
    applyMergedData: (data: BackupData) => void,
    options?: { forcePush?: boolean; forcePull?: boolean; silent?: boolean }
  ): Promise<{ success: boolean; message: string; mergedNotesCount?: number }> {
    const cfg = this.config.value;
    if (!cfg.enabled || !cfg.serverUrl || !cfg.remotePath) {
      return { success: false, message: 'WebDAV 未启用或配置不完整' };
    }

    // 严格并发互斥锁：防止多任务并发争抢写穿
    if (this.isSyncing.value) {
      return { success: false, message: '同步任务正在进行中，已自动跳过重叠请求' };
    }

    this.isSyncing.value = true;
    this.syncState.value = 'syncing';
    this.syncMessage.value = '正在同步中...';

    const client = new WebdavClient(cfg);
    const MAX_RETRIES = 2; // 遇到 412 乐观锁冲突时最多重试 2 次

    try {
      let attempt = 0;
      while (attempt <= MAX_RETRIES) {
        const initialLocalData = getLocalData();
        let finalDataToUpload = initialLocalData;

        if (options?.forcePull) {
          // 强制从云端覆盖本地
          const remoteResult = await client.downloadJson<BackupData>(cfg.remotePath);
          if (!remoteResult.exists || !remoteResult.data) {
            throw new Error('远端未发现有效的备份文件');
          }
          const remoteBackup = BackupCodec.decode(JSON.stringify(remoteResult.data));
          if (!remoteBackup) {
            throw new Error('远端备份数据解析失败');
          }
          applyMergedData(remoteBackup);
          this.syncState.value = 'success';
          this.syncMessage.value = `已强制从云端拉取覆盖本地 (${new Date().toLocaleTimeString()})`;
          this.saveConfig({
            lastSyncTime: Date.now(),
            lastSyncStatus: 'success',
            lastSyncMessage: this.syncMessage.value,
            lastEtag: remoteResult.etag
          });
          return { success: true, message: '已从云端拉取覆盖本地', mergedNotesCount: remoteBackup.notes.length };
        }

        let remoteEtag: string | undefined = undefined;

        if (!options?.forcePush) {
          // 【轻量元数据短路检查】：若非强制推送且具备历史同步锚点，先通过 HEAD 探测云端 Last-Modified 与 ETag
          // 若云端未变且本地无草稿无新改动，直接 0 字节秒级跳过，节省 99.9% 网络带宽
          if (cfg.lastSyncTime && cfg.lastSyncTime > 0) {
            try {
              const meta = await client.getFileMeta(cfg.remotePath);
              if (meta.exists) {
                const cleanRemoteEtag = meta.etag?.replace(/^W\//, '').replace(/"/g, '').trim();
                const cleanLocalEtag = cfg.lastEtag?.replace(/^W\//, '').replace(/"/g, '').trim();

                let remoteNotChanged = false;
                if (cleanRemoteEtag && cleanLocalEtag) {
                  remoteNotChanged = cleanRemoteEtag === cleanLocalEtag;
                } else if (meta.lastModified) {
                  remoteNotChanged = meta.lastModified <= cfg.lastSyncTime + 1000;
                }

                const localNotChanged =
                  !draftBufferRepository.hasUnsyncedChanges() &&
                  !this.hasLocalChangesSince(initialLocalData, cfg.lastSyncTime);

                if (remoteNotChanged && localNotChanged) {
                  this.syncState.value = 'success';
                  this.syncMessage.value = `已是最新 (${new Date().toLocaleTimeString()})`;
                  return {
                    success: true,
                    message: '数据已是最新，无须网络下载',
                    mergedNotesCount: initialLocalData.notes.length
                  };
                }
              }
            } catch (metaErr) {
              console.warn('[WebdavSync] getFileMeta probe failed, fallback to full sync:', metaErr);
            }
          }

          // 1. 下载远端文件及 ETag
          const remoteResult = await client.downloadJson<BackupData>(cfg.remotePath);
          remoteEtag = remoteResult.etag;

          if (remoteResult.exists && remoteResult.data) {
            const remoteBackup = BackupCodec.decode(JSON.stringify(remoteResult.data));
            if (remoteBackup) {
              // 检测新设备初始化默认分类防污染：
              // 若本地无任何便签，且分类仅为系统自带的 3 个示例分类，而云端已有用户有效数据
              const isFreshDeviceWithDefaults =
                (!initialLocalData.notes || initialLocalData.notes.length === 0) &&
                (initialLocalData.categories || []).every(c => ['1', '2', '3'].includes(c.id));
              const remoteHasUserData =
                remoteBackup.notes.length > 0 ||
                (remoteBackup.categories || []).some(c => !['1', '2', '3'].includes(c.id));

              if (isFreshDeviceWithDefaults && remoteHasUserData) {
                // 远端优先初始化，丢弃本地示例分类
                finalDataToUpload = remoteBackup;
                applyMergedData(finalDataToUpload);
              } else {
                // 动态拉取当前最新内存状态进行 Diff 保护，防止网络等待期间键入的字被旧快照抹除
                const latestMemoryData = getLocalData();
                finalDataToUpload = this.mergeBackupData(latestMemoryData, remoteBackup, cfg.lastSyncTime || 0);
                applyMergedData(finalDataToUpload);
              }
            }
          }
        }

        // 4. 将合并后的最新全量数据推向 WebDAV 远端 (带 If-Match 保护)
        try {
          const uploadResult = await client.uploadJson(
            cfg.remotePath,
            finalDataToUpload,
            options?.forcePush ? undefined : remoteEtag
          );

          // 上传成功，清除本地临时脏数据暂存
          draftBufferRepository.clearDraft();

          // 若开启了图片附件同步，异步推送本地 pending 状态的图片
          if (cfg.syncImages !== false) {
            this.syncPendingImages().catch(err => {
              console.warn('[WebdavSync] syncPendingImages error:', err);
            });
          }

          let finalSavedEtag = uploadResult.etag;
          let finalLastSyncTime = Date.now();

          // 若 uploadJson 没有返回 ETag (多数 WebDAV 服务端如坚果云的 PUT 响应不带 ETag)，
          // 立即通过轻量 HEAD 校验并捕获服务端真实的最新 ETag 与 Last-Modified，确保后续 short-circuit 探测 100% 精准
          if (!finalSavedEtag) {
            try {
              const probeMeta = await client.getFileMeta(cfg.remotePath);
              if (probeMeta.exists) {
                if (probeMeta.etag) {
                  finalSavedEtag = probeMeta.etag;
                }
                if (probeMeta.lastModified) {
                  // 服务端时钟对齐：以服务端的 Last-Modified 为基准，避免客户端与服务端时钟偏差
                  finalLastSyncTime = Math.max(finalLastSyncTime, probeMeta.lastModified);
                }
              }
            } catch (probeErr) {
              console.warn('[WebdavSync] post-upload meta probe failed:', probeErr);
            }
          }

          const cleanEtagStr = (etag?: string) => etag?.replace(/^W\//, '').replace(/"/g, '').trim();
          this.syncState.value = 'success';
          this.syncMessage.value = `同步成功 (${new Date(finalLastSyncTime).toLocaleTimeString()})`;
          this.saveConfig({
            lastSyncTime: finalLastSyncTime,
            lastSyncStatus: 'success',
            lastSyncMessage: this.syncMessage.value,
            lastEtag: cleanEtagStr(finalSavedEtag || uploadResult.etag || remoteEtag)
          });

          return {
            success: true,
            message: 'WebDAV 同步成功！',
            mergedNotesCount: finalDataToUpload.notes.length
          };
        } catch (uploadErr: any) {
          if (uploadErr.isPreconditionFailed && attempt < MAX_RETRIES) {
            // 412 乐观锁冲突：其他设备抢先提交，递增 attempt 自动重试合并
            attempt++;
            continue;
          }
          throw uploadErr;
        }
      }

      throw new Error('同步并发重试次数超限，请稍后重试');
    } catch (err: any) {
      this.syncState.value = 'error';
      this.syncMessage.value = `同步失败: ${err.message || '网络异常'}`;
      this.saveConfig({
        lastSyncStatus: 'error',
        lastSyncMessage: this.syncMessage.value
      });
      return { success: false, message: this.syncMessage.value };
    } finally {
      this.isSyncing.value = false;
    }
  }

  /**
   * 异步上传本地待同步的图片队列到 WebDAV 独立图片文件夹
   */
  public async syncPendingImages(): Promise<{ uploaded: number; failed: number }> {
    const cfg = this.config.value;
    if (!cfg.enabled || cfg.syncImages === false || !cfg.serverUrl) {
      return { uploaded: 0, failed: 0 };
    }

    const pendingList = await imageRepository.getPendingUploads();
    if (pendingList.length === 0) {
      return { uploaded: 0, failed: 0 };
    }

    const client = new WebdavClient(cfg);
    const remoteDir = (cfg.imagesRemoteDir || '/toolkit/moment_notes_images').replace(/\/+$/, '');
    await client.ensureDirectory(remoteDir);

    let uploaded = 0;
    let failed = 0;

    for (const item of pendingList) {
      try {
        const remoteFilePath = `${remoteDir}/${item.id}`;
        await client.uploadBinary(remoteFilePath, item.blob, item.meta.mimeType);
        await imageRepository.markUploadStatus(item.id, 'uploaded');
        uploaded++;
      } catch (err) {
        console.warn(`[WebdavSync] Upload image ${item.id} failed:`, err);
        await imageRepository.markUploadStatus(item.id, 'failed');
        failed++;
      }
    }

    return { uploaded, failed };
  }

  /**
   * 按需懒加载下载缺失的远端图片
   */
  public async downloadImageIfMissing(pathOrId: string): Promise<Blob | null> {
    const id = imageRepository.normalizeId(pathOrId);
    if (!id) return null;

    // 1. 本地已存在则直接返回
    const localBlob = await imageRepository.getImageBlob(id);
    if (localBlob) return localBlob;

    const cfg = this.config.value;
    if (!cfg.enabled || cfg.syncImages === false || !cfg.serverUrl) {
      return null;
    }

    const client = new WebdavClient(cfg);
    const remoteDir = (cfg.imagesRemoteDir || '/toolkit/moment_notes_images').replace(/\/+$/, '');
    const remoteFilePath = `${remoteDir}/${id}`;

    try {
      const res = await client.downloadBinary(remoteFilePath);
      if (res.exists && res.data) {
        // 保存至本地存储仓并标记为已上传 (uploaded)
        await imageRepository.saveImage(res.data, {
          customId: id,
          uploadStatus: 'uploaded',
          autoCompress: false
        });
        return res.data;
      }
    } catch (e) {
      console.warn(`[WebdavSync] Failed to lazy download image ${id}:`, e);
    }
    return null;
  }

  /**
   * 防抖触发自动推送 (用于便签与分类编辑保存后 3 秒自动同步)
   */
  public triggerDebouncedPush(
    getLocalData: () => BackupData,
    applyMergedData: (data: BackupData) => void,
    delayMs = 3000
  ): void {
    if (!this.config.value.enabled || !this.config.value.autoSync) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.performSync(getLocalData, applyMergedData, { silent: true });
    }, delayMs);
  }
}

export const webdavSyncEngine = WebdavSyncEngine.getInstance();
