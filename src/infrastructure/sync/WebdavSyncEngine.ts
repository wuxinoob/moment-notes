import { ref } from 'vue';
import { WebdavConfig, WebdavSyncState, BackupData, Note, Category } from '@type';
import { storage } from '@utils/storage';
import { BackupCodec } from '../storage/Repository';

export const WEBDAV_CONFIG_STORAGE_KEY = 'sticky_notes_webdav_config';

export const defaultWebdavConfig: WebdavConfig = {
  enabled: false,
  serverUrl: '',
  username: '',
  password: '',
  remotePath: '/ScriptKit/moment_notes.json',
  autoSync: true,
  syncIntervalMinutes: 5,
  lastSyncStatus: 'idle',
  lastSyncTime: undefined,
  lastSyncMessage: ''
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
      // 优先发送 PROPFIND 或 OPTIONS 请求
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
          // 目录不存在，创建目录
          await fetch(url, {
            method: 'MKCOL',
            headers: {
              Authorization: this.getAuthHeader()
            }
          });
        }
      } catch {
        // 忽略中间错误，尝试继续
      }
    }
    return true;
  }

  /**
   * 下载远端 JSON 文件
   */
  public async downloadJson<T = any>(remotePath: string): Promise<{ exists: boolean; data: T | null }> {
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

      const text = await res.text();
      const parsed = JSON.parse(text);
      return { exists: true, data: parsed };
    } catch (err: any) {
      if (err.message && err.message.includes('404')) {
        return { exists: false, data: null };
      }
      throw err;
    }
  }

  /**
   * 上传 JSON 文件至 WebDAV 远端
   */
  public async uploadJson(remotePath: string, data: any): Promise<boolean> {
    const lastSlash = remotePath.lastIndexOf('/');
    if (lastSlash > 0) {
      const dirPath = remotePath.substring(0, lastSlash);
      await this.ensureDirectory(dirPath);
    }

    const url = this.getFullUrl(remotePath);
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: content
    });

    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`上传失败 HTTP ${res.status}: ${res.statusText}`);
    }
    return true;
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
  private debounceTimer: any = null;

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
      return {
        ...defaultWebdavConfig,
        ...parsed
      };
    } catch {
      return { ...defaultWebdavConfig };
    }
  }

  /**
   * 保存配置
   */
  public saveConfig(newConfig: Partial<WebdavConfig>): void {
    this.config.value = {
      ...this.config.value,
      ...newConfig
    };
    storage.setItem(WEBDAV_CONFIG_STORAGE_KEY, JSON.stringify(this.config.value));
  }

  /**
   * 墓碑双向智能冲突合并算法 (Tombstone-Aware Smart Merge)
   * 1. 纳入 deletedAt / isDeleted 状态与时间戳权重比较；
   * 2. 若一边删除了便签/分类（deletedAt 较新），向另一边同步删除状态，杜绝幽灵复活；
   * 3. 若另一边在删除之后又进行了新编辑（updatedAt > deletedAt），则自动撤销删除并保留最新内容；
   * 4. 自动执行超过 30 天的过期墓碑垃圾回收 (Tombstone GC)。
   */
  public mergeBackupData(localData: BackupData, remoteData: BackupData): BackupData {
    const now = Date.now();
    const GC_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30天以上的删除墓碑安全物理清理

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
        const lTime = Math.max(lNote.updatedAt || 0, lNote.deletedAt || 0, lNote.createdAt || 0);
        const rTime = Math.max(rNote.updatedAt || 0, rNote.deletedAt || 0, rNote.createdAt || 0);

        if (lTime >= rTime) {
          noteMap.set(id, lNote);
        } else {
          noteMap.set(id, rNote);
        }
      }
    }

    // 过滤超过 30 天的过期已删除便签 (GC 垃圾回收)
    const activeNotes = Array.from(noteMap.values()).filter(note => {
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

    return {
      version: '1.6.0',
      timestamp: now,
      categories: activeCategories,
      notes: activeNotes,
      settings: localData.settings || remoteData.settings
    };
  }

  /**
   * 执行完整的 WebDAV 云同步流程 (支持双向墓碑合并、强制推送、强制拉取)
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

    this.syncState.value = 'syncing';
    this.syncMessage.value = '正在同步中...';

    const client = new WebdavClient(cfg);

    try {
      const localData = getLocalData();
      let finalDataToUpload = localData;

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
          lastSyncMessage: this.syncMessage.value
        });
        return { success: true, message: '已从云端拉取覆盖本地', mergedNotesCount: remoteBackup.notes.length };
      }

      if (!options?.forcePush) {
        // 1. 先尝试拉取远端文件
        const remoteResult = await client.downloadJson<BackupData>(cfg.remotePath);
        if (remoteResult.exists && remoteResult.data) {
          const remoteBackup = BackupCodec.decode(JSON.stringify(remoteResult.data));
          if (remoteBackup) {
            // 2. 双向智能墓碑合并
            finalDataToUpload = this.mergeBackupData(localData, remoteBackup);
            // 3. 将合并后数据刷入本地 Store
            applyMergedData(finalDataToUpload);
          }
        }
      }

      // 4. 将合并后的最新全量数据推向 WebDAV 远端
      await client.uploadJson(cfg.remotePath, finalDataToUpload);

      const now = Date.now();
      this.syncState.value = 'success';
      this.syncMessage.value = `同步成功 (${new Date(now).toLocaleTimeString()})`;
      this.saveConfig({
        lastSyncTime: now,
        lastSyncStatus: 'success',
        lastSyncMessage: this.syncMessage.value
      });

      return {
        success: true,
        message: 'WebDAV 同步成功！',
        mergedNotesCount: finalDataToUpload.notes.length
      };
    } catch (err: any) {
      this.syncState.value = 'error';
      this.syncMessage.value = `同步失败: ${err.message || '网络异常'}`;
      this.saveConfig({
        lastSyncStatus: 'error',
        lastSyncMessage: this.syncMessage.value
      });
      return { success: false, message: this.syncMessage.value };
    }
  }

  /**
   * 防抖触发自动推送 (用于便签编辑保存后自动同步)
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
