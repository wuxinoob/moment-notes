import { Note, ImageMeta } from '@type';
import { imageRepository } from '../storage/ImageRepository';
import type { WebdavClient } from './WebdavSyncEngine';

// 孤儿图片保留宽限期：默认 7 天 (防止误删文本后撤销操作或跨端多机并发编辑时发生误删)
const DEFAULT_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 便签图片全生命周期管理服务 (引用扫描、孤儿判定、延迟垃圾回收 GC)
 */
export class ImageLifecycleService {
  private static instance: ImageLifecycleService;

  public static getInstance(): ImageLifecycleService {
    if (!ImageLifecycleService.instance) {
      ImageLifecycleService.instance = new ImageLifecycleService();
    }
    return ImageLifecycleService.instance;
  }

  /**
   * 从单个便签中提取所有引用的图片 ID (支持 Markdown 语法与 images 字段)
   */
  public extractImageIdsFromNote(note: Note): Set<string> {
    const ids = new Set<string>();
    if (!note) return ids;

    // 1. 从 images 属性数组中提取
    if (note.images && Array.isArray(note.images)) {
      note.images.forEach(img => {
        const id = imageRepository.normalizeId(img);
        if (id) ids.add(id);
      });
    }

    // 2. 从 content 正文 Markdown 与 HTML 中提取形如:
    // ![alt](images/img_123.png) 或 [audio:xxx](attachments/audio_123.mp3) 或 [📎 xxx](attachments/file_123.pdf) 或 attachment://xxx
    if (note.content) {
      const mdRegex = /(?:!\[.*?\]|\[.*?\])\((?:attachment:\/\/)?(?:attachments\/|images\/)?([a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)\)/gi;
      let match: RegExpExecArray | null;
      while ((match = mdRegex.exec(note.content)) !== null) {
        if (match[1]) {
          const id = imageRepository.normalizeId(match[1]);
          if (id) ids.add(id);
        }
      }

      const srcRegex = /src=["'](?:attachment:\/\/)?(?:attachments\/|images\/)?([a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)["']/gi;
      let srcMatch: RegExpExecArray | null;
      while ((srcMatch = srcRegex.exec(note.content)) !== null) {
        if (srcMatch[1]) {
          const id = imageRepository.normalizeId(srcMatch[1]);
          if (id) ids.add(id);
        }
      }
    }

    return ids;
  }

  /**
   * 收集便签集合中所有被有效引用的图片 ID
   * 注意：回收站中 (isDeleted: true) 但未彻底销毁 (!isPurged) 的便签引用的图片仍视为有效，防止还原便签后图片丢失
   */
  public collectActiveImageIds(notes: Note[]): Set<string> {
    const activeIds = new Set<string>();
    for (const note of notes) {
      // 只要便签未被彻底销毁 (isPurged)，其图片就保留
      if (note && !note.isPurged) {
        const ids = this.extractImageIdsFromNote(note);
        ids.forEach(id => activeIds.add(id));
      }
    }
    return activeIds;
  }

  /**
   * 找出无主孤儿图片 (未被任何有效便签引用，且已超过缓冲保护期)
   */
  public findOrphanImages(
    storedImages: ImageMeta[],
    activeImageIds: Set<string>,
    gracePeriodMs = DEFAULT_GRACE_PERIOD_MS
  ): ImageMeta[] {
    const now = Date.now();
    return storedImages.filter(img => {
      // 正在被引用的图片绝不清理
      if (activeImageIds.has(img.id)) {
        return false;
      }
      // 刚创建不久的图片予以宽限期保护
      if (now - img.createdAt < gracePeriodMs) {
        return false;
      }
      return true;
    });
  }

  /**
   * 执行完整的图片垃圾回收 (GC)
   * 1. 扫描所有非墓碑便签
   * 2. 本地清理过期的无主孤儿图片
   * 3. 若提供 WebDAV 客户端与远端目录，连带从云端发起 HTTP DELETE 清理
   */
  public async performImageGC(
    notes: Note[],
    client?: WebdavClient,
    options?: {
      gracePeriodDays?: number;
      remoteDir?: string;
    }
  ): Promise<{
    activeCount: number;
    cleanedLocal: number;
    cleanedRemote: number;
    errors: string[];
  }> {
    const activeIds = this.collectActiveImageIds(notes);
    const storedImages = await imageRepository.listImages();
    const graceMs = (options?.gracePeriodDays ?? 7) * 24 * 60 * 60 * 1000;
    const orphans = this.findOrphanImages(storedImages, activeIds, graceMs);

    let cleanedLocal = 0;
    let cleanedRemote = 0;
    const errors: string[] = [];

    const remoteDir = (options?.remoteDir || '/toolkit/moment_notes_images').replace(/\/+$/, '');

    for (const orphan of orphans) {
      // 1. 本地删除
      try {
        const ok = await imageRepository.deleteImage(orphan.id);
        if (ok) cleanedLocal++;
      } catch (err: any) {
        errors.push(`本地删除 ${orphan.id} 失败: ${err.message}`);
      }

      // 2. 远端云盘删除
      if (client) {
        try {
          const remoteFilePath = `${remoteDir}/${orphan.id}`;
          const res = await client.deleteFile(remoteFilePath);
          if (res.success) cleanedRemote++;
        } catch (err: any) {
          errors.push(`远端删除 ${orphan.id} 失败: ${err.message}`);
        }
      }
    }

    return {
      activeCount: activeIds.size,
      cleanedLocal,
      cleanedRemote,
      errors
    };
  }
}

export const imageLifecycleService = ImageLifecycleService.getInstance();
