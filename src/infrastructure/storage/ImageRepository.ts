import { AttachmentMeta, AttachmentType, ImageMeta } from '@type';

const DB_NAME = 'moment_notes_assets';
const DB_VERSION = 1;
const STORE_NAME = 'images';

interface StoredImageRecord {
  id: string;
  blob: Blob;
  meta: AttachmentMeta;
}

/**
 * 本地图片与多媒体附件存储仓 (基于 IndexedDB + 内存高速缓存)
 * 支持纯前端与 Toolkit 插件沙箱环境，无需宿主开放 fs 权限
 */
export class ImageRepository {
  private static instance: ImageRepository;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  // 内存 ObjectURL 高速缓存 (key: id 或 path, value: blob:http://... 或 DataURL)
  private memoryUrlCache = new Map<string, string>();
  // 内存元数据高速缓存
  private memoryMetaCache = new Map<string, AttachmentMeta>();
  // Node / 内存回退存储 (用于单测或无 IndexedDB 的环境)
  private fallbackStore = new Map<string, StoredImageRecord>();

  public static getInstance(): ImageRepository {
    if (!ImageRepository.instance) {
      ImageRepository.instance = new ImageRepository();
    }
    return ImageRepository.instance;
  }

  /**
   * 规范化资源标识符 (剥离可能携带的 images/ 或 attachments/ 或 attachment:// 前缀)
   */
  public normalizeId(idOrPath: string): string {
    if (!idOrPath) return '';
    return idOrPath
      .replace(/^attachment:\/\//, '')
      .replace(/^attachments\//, '')
      .replace(/^images\//, '')
      .replace(/^\/+/, '');
  }

  /**
   * 获取标准的 Markdown 相对路径
   */
  public toRelativePath(idOrPath: string): string {
    const id = this.normalizeId(idOrPath);
    if (id.startsWith('img_') || /\.(?:png|jpe?g|webp|gif|svg|bmp|ico)$/i.test(id)) {
      return `images/${id}`;
    }
    return `attachments/${id}`;
  }

  /**
   * 获取或初始化 IndexedDB
   */
  private getDB(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return Promise.resolve(null);
    }
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = (err) => {
          console.warn('[ImageRepository] IndexedDB open error, fallback to memory:', err);
          resolve(null);
        };
      } catch (err) {
        console.warn('[ImageRepository] IndexedDB exception, fallback to memory:', err);
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  /**
   * 生成唯一的文件名 (按媒体类型划分前缀)
   */
  public generateAssetId(type: AttachmentType = 'image', ext = 'bin'): string {
    const timestamp = Date.now();
    const randomHex = Math.random().toString(16).substring(2, 10);
    const prefix = type === 'audio' ? 'audio' : type === 'video' ? 'video' : type === 'file' ? 'file' : 'img';
    return `${prefix}_${timestamp}_${randomHex}.${ext}`;
  }

  private generateImageId(ext = 'png'): string {
    return this.generateAssetId('image', ext);
  }

  /**
   * 自动探测文件媒体类型
   */
  public detectType(mimeType?: string, ext?: string): AttachmentType {
    const mime = (mimeType || '').toLowerCase();
    const extension = (ext || '').toLowerCase();

    if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico', 'bmp'].includes(extension)) {
      return 'image';
    }
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac', 'webm', 'wma'].includes(extension)) {
      return 'audio';
    }
    if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi', 'flv'].includes(extension)) {
      return 'video';
    }
    return 'file';
  }

  /**
   * 获取默认文件扩展名
   */
  public getDefaultExt(mimeType?: string, type?: AttachmentType): string {
    const mime = (mimeType || '').toLowerCase();
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    if (mime === 'image/svg+xml') return 'svg';
    if (mime === 'audio/mpeg' || mime === 'audio/mp3') return 'mp3';
    if (mime === 'audio/wav') return 'wav';
    if (mime === 'audio/ogg') return 'ogg';
    if (mime === 'audio/aac') return 'aac';
    if (mime === 'video/mp4') return 'mp4';
    if (mime === 'video/webm') return 'webm';
    if (mime === 'application/pdf') return 'pdf';
    if (mime === 'application/zip') return 'zip';
    if (type === 'audio') return 'mp3';
    if (type === 'video') return 'mp4';
    if (type === 'image') return 'png';
    return 'bin';
  }

  /**
   * 尝试使用 Canvas 智能压缩图片 (不破坏透明度，GIF/SVG 免压缩)
   */
  public async compressImageIfNeeded(file: Blob | File, maxSizeMB = 5): Promise<Blob> {
    // 超过指定大小且是常见位图 (jpg/png/webp) 时进行压缩
    const isCompressible =
      file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp';
    if (!isCompressible || file.size < maxSizeMB * 1024 * 1024) {
      return file;
    }

    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      return file;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = dataUrl;
      });

      // 最大宽高限制 1920 像素，等比缩放
      const MAX_DIMENSION = 1920;
      let width = img.width;
      let height = img.height;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;

      ctx.drawImage(img, 0, 0, width, height);

      // 如果是 PNG 且没有透明通道，可转为高质量 JPEG 缩减 80% 体积
      const outputType = file.type === 'image/jpeg' ? 'image/jpeg' : file.type;
      const quality = 0.85;

      const compressedBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(blob => resolve(blob), outputType, quality);
      });

      return compressedBlob && compressedBlob.size < file.size ? compressedBlob : file;
    } catch (e) {
      console.warn('[ImageRepository] Image compression failed, using original:', e);
      return file;
    }
  }

  /**
   * 保存多媒体/图片附件到本地存储
   */
  public async saveImage(
    file: Blob | File,
    options?: {
      customId?: string;
      autoCompress?: boolean;
      maxSizeMB?: number;
      ext?: string;
      type?: AttachmentType;
      originalName?: string;
      uploadStatus?: 'pending' | 'uploaded' | 'failed';
    }
  ): Promise<{ id: string; path: string; url: string; meta: AttachmentMeta }> {
    const originalName = options?.originalName || ('name' in file ? (file as File).name : undefined);
    let ext = options?.ext;
    if (!ext && originalName) {
      const parts = originalName.split('.');
      if (parts.length > 1) {
        ext = parts.pop()?.toLowerCase();
      }
    }

    const type: AttachmentType = options?.type || this.detectType(file.type, ext);
    if (!ext) {
      ext = this.getDefaultExt(file.type, type);
    }

    let finalBlob: Blob = file;
    if (type === 'image' && options?.autoCompress !== false) {
      finalBlob = await this.compressImageIfNeeded(file, options?.maxSizeMB || 5);
    }

    const id = options?.customId ? this.normalizeId(options.customId) : this.generateAssetId(type, ext);
    const path = this.toRelativePath(id);

    const meta: AttachmentMeta = {
      id,
      path,
      size: finalBlob.size,
      mimeType: finalBlob.type || (type === 'image' ? 'image/png' : 'application/octet-stream'),
      createdAt: Date.now(),
      uploadStatus: options?.uploadStatus || 'pending',
      type,
      originalName
    };

    const record: StoredImageRecord = {
      id,
      blob: finalBlob,
      meta
    };

    // 1. 存入内存 URL 与 Meta 缓存
    const objectUrl = this.createBlobUrl(finalBlob);
    this.memoryUrlCache.set(id, objectUrl);
    this.memoryUrlCache.set(path, objectUrl);
    this.memoryMetaCache.set(id, meta);
    this.memoryMetaCache.set(path, meta);

    // 2. 存入 IndexedDB
    const db = await this.getDB();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        } catch (e) {
          reject(e);
        }
      });
    } else {
      this.fallbackStore.set(id, record);
    }

    return { id, path, url: objectUrl, meta };
  }

  /**
   * 语义化别名：保存任意附件
   */
  public saveAttachment = this.saveImage.bind(this);

  /**
   * 同步直接获取附件元数据
   */
  public getMetaSync(idOrPath: string): AttachmentMeta | null {
    const id = this.normalizeId(idOrPath);
    return this.memoryMetaCache.get(id) || null;
  }

  /**
   * 异步获取附件元数据
   */
  public async getMeta(idOrPath: string): Promise<AttachmentMeta | null> {
    const id = this.normalizeId(idOrPath);
    const cached = this.getMetaSync(id);
    if (cached) return cached;

    const db = await this.getDB();
    if (db) {
      return new Promise<AttachmentMeta | null>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(id);
          req.onsuccess = () => {
            const record = req.result as StoredImageRecord | undefined;
            if (record && record.meta) {
              this.memoryMetaCache.set(id, record.meta);
              resolve(record.meta);
            } else {
              resolve(null);
            }
          };
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    } else {
      const rec = this.fallbackStore.get(id);
      if (rec?.meta) {
        this.memoryMetaCache.set(id, rec.meta);
        return rec.meta;
      }
      return null;
    }
  }

  /**
   * 安全创建 Blob URL (在 Node 单测中回退)
   */
  private createBlobUrl(blob: Blob): string {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try {
        return URL.createObjectURL(blob);
      } catch {
        // fallback
      }
    }
    return `data:${blob.type || 'image/png'};base64,mock`;
  }

  /**
   * 同步直接获取内存中的图片 URL (无异步等待，用于快速渲染)
   */
  public getImageUrlSync(idOrPath: string): string | null {
    const id = this.normalizeId(idOrPath);
    const path = this.toRelativePath(id);
    return this.memoryUrlCache.get(id) || this.memoryUrlCache.get(path) || null;
  }

  /**
   * 异步获取图片 Blob
   */
  public async getImageBlob(idOrPath: string): Promise<Blob | null> {
    const id = this.normalizeId(idOrPath);
    if (!id) return null;

    const db = await this.getDB();
    if (db) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(id);
          req.onsuccess = () => {
            const record = req.result as StoredImageRecord | undefined;
            resolve(record ? record.blob : null);
          };
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }

    const fallbackRecord = this.fallbackStore.get(id);
    return fallbackRecord ? fallbackRecord.blob : null;
  }

  /**
   * 异步获取可访问的图片 URL (若未载入内存则先从 IndexedDB 恢复)
   */
  public async getImageUrl(idOrPath: string): Promise<string | null> {
    const cached = this.getImageUrlSync(idOrPath);
    if (cached) return cached;

    const blob = await this.getImageBlob(idOrPath);
    if (!blob) return null;

    const id = this.normalizeId(idOrPath);
    const path = this.toRelativePath(id);
    const url = this.createBlobUrl(blob);
    this.memoryUrlCache.set(id, url);
    this.memoryUrlCache.set(path, url);
    return url;
  }

  /**
   * 列出本地所有已存储的图片元数据
   */
  public async listImages(): Promise<ImageMeta[]> {
    const db = await this.getDB();
    if (db) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => {
            const records = (req.result as StoredImageRecord[]) || [];
            resolve(records.map(r => r.meta));
          };
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });
    }

    return Array.from(this.fallbackStore.values()).map(r => r.meta);
  }

  /**
   * 获取所有等待上传到 WebDAV 的图片列表
   */
  public async getPendingUploads(): Promise<Array<{ id: string; path: string; blob: Blob; meta: ImageMeta }>> {
    const db = await this.getDB();
    if (db) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => {
            const records = (req.result as StoredImageRecord[]) || [];
            const pending = records
              .filter(r => r.meta.uploadStatus === 'pending' || r.meta.uploadStatus === 'failed')
              .map(r => ({
                id: r.id,
                path: r.meta.path,
                blob: r.blob,
                meta: r.meta
              }));
            resolve(pending);
          };
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });
    }

    return Array.from(this.fallbackStore.values())
      .filter(r => r.meta.uploadStatus === 'pending' || r.meta.uploadStatus === 'failed')
      .map(r => ({
        id: r.id,
        path: r.meta.path,
        blob: r.blob,
        meta: r.meta
      }));
  }

  /**
   * 更新指定图片的上传状态
   */
  public async markUploadStatus(idOrPath: string, status: 'pending' | 'uploaded' | 'failed'): Promise<void> {
    const id = this.normalizeId(idOrPath);
    const db = await this.getDB();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(id);
          req.onsuccess = () => {
            const record = req.result as StoredImageRecord | undefined;
            if (record) {
              record.meta.uploadStatus = status;
              store.put(record);
            }
            resolve();
          };
          req.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    } else {
      const record = this.fallbackStore.get(id);
      if (record) {
        record.meta.uploadStatus = status;
      }
    }
  }

  /**
   * 从本地永久删除图片
   */
  public async deleteImage(idOrPath: string): Promise<boolean> {
    const id = this.normalizeId(idOrPath);
    const path = this.toRelativePath(id);

    // 释放 ObjectURL 资源
    const url = this.memoryUrlCache.get(id);
    if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    this.memoryUrlCache.delete(id);
    this.memoryUrlCache.delete(path);

    const db = await this.getDB();
    if (db) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.delete(id);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    }

    this.fallbackStore.delete(id);
    return true;
  }

  /**
   * 清空所有本地图片缓存 (用于测试或完全重置)
   */
  public async clearAll(): Promise<void> {
    for (const url of this.memoryUrlCache.values()) {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    }
    this.memoryUrlCache.clear();
    this.fallbackStore.clear();

    const db = await this.getDB();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
  }
}

export const imageRepository = ImageRepository.getInstance();
