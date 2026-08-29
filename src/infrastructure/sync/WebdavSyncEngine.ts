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
   * 智能双向冲突合并算法 (Bidirectional Smart Merge)
   * 比较本地与远端数据，按时间戳更新者为准进行安全合并
   */
  public mergeBackupData(localData: BackupData, remoteData: BackupData): BackupData {
    // 1. 合并便签
    const noteMap = new Map<string, Note>();

    // 先压入远端便签
    for (const rNote of remoteData.notes || []) {
      if (rNote && rNote.id) {
        noteMap.set(rNote.id, rNote);
      }
    }

    // 与本地便签对比合并
    for (const lNote of localData.notes || []) {
      if (!lNote || !lNote.id) continue;
      const existing = noteMap.get(lNote.id);
      if (!existing) {
        noteMap.set(lNote.id, lNote);
      } else {
        const localTime = Math.max(lNote.updatedAt || 0, lNote.createdAt || 0);
        const remoteTime = Math.max(existing.updatedAt || 0, existing.createdAt || 0);
        // 本地更新或者相等时保留本地
        if (localTime >= remoteTime) {
          noteMap.set(lNote.id, lNote);
        }
      }
    }

    // 2. 合并分类
    const catMap = new Map<string, Category>();
    for (const rCat of remoteData.categories || []) {
      if (rCat && rCat.id) {
        catMap.set(rCat.id, rCat);
      }
    }
    for (const lCat of localData.categories || []) {
      if (lCat && lCat.id) {
        const existing = catMap.get(lCat.id);
        if (!existing) {
          catMap.set(lCat.id, lCat);
        } else {
          // 优先保留本地最新修改
          catMap.set(lCat.id, lCat);
        }
      }
    }

    return {
      version: '1.6.0',
      timestamp: Date.now(),
      categories: Array.from(catMap.values()),
      notes: Array.from(noteMap.values()),
      settings: localData.settings || remoteData.settings
    };
  }

  /**
   * 执行完整的双向云同步流程
   */
  public async performSync(
    getLocalData: () => BackupData,
    applyMergedData: (data: BackupData) => void,
    options?: { forcePush?: boolean; silent?: boolean }
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

      if (!options?.forcePush) {
        // 1. 先尝试拉取远端文件
        const remoteResult = await client.downloadJson<BackupData>(cfg.remotePath);
        if (remoteResult.exists && remoteResult.data) {
          const remoteBackup = BackupCodec.decode(JSON.stringify(remoteResult.data));
          if (remoteBackup) {
            // 2. 双向智能合并
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
