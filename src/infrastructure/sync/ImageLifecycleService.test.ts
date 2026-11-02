import { describe, it, expect, beforeEach, vi } from 'vitest';
import { imageLifecycleService } from './ImageLifecycleService';
import { imageRepository } from '../storage/ImageRepository';
import { Note, ImageMeta } from '@type';

describe('ImageLifecycleService 便签图片生命周期服务单测', () => {
  beforeEach(async () => {
    await imageRepository.clearAll();
  });

  it('extractImageIdsFromNote 正确从 Markdown 和 images 属性提取图片 ID', () => {
    const note: Note = {
      id: 'n1',
      categoryId: 'all',
      content: '这是一段便签正文\n![截图](images/screenshot_1.png)\n另外一张：![photo](attachment://photo_2.jpg)\n还有一张：![](plain_3.webp)',
      images: ['images/prop_4.png'],
      color: 'yellow',
      isPinned: false,
      createdAt: 1000,
      updatedAt: 1000
    };

    const ids = imageLifecycleService.extractImageIdsFromNote(note);
    expect(ids.has('screenshot_1.png')).toBe(true);
    expect(ids.has('photo_2.jpg')).toBe(true);
    expect(ids.has('plain_3.webp')).toBe(true);
    expect(ids.has('prop_4.png')).toBe(true);
    expect(ids.size).toBe(4);
  });

  it('extractImageIdsFromNote 正确从 Markdown 提取音频、视频与通用附件 ID', () => {
    const note: Note = {
      id: 'n_media',
      categoryId: 'all',
      content:
        '多媒体测试：\n[audio:录音](attachments/audio_rec.mp3)\n[video:演示](attachments/video_demo.mp4)\n[📎 报告.pdf (1.2 MB)](attachments/file_report.pdf)',
      color: 'yellow',
      isPinned: false,
      createdAt: 1000,
      updatedAt: 1000
    };

    const ids = imageLifecycleService.extractImageIdsFromNote(note);
    expect(ids.has('audio_rec.mp3')).toBe(true);
    expect(ids.has('video_demo.mp4')).toBe(true);
    expect(ids.has('file_report.pdf')).toBe(true);
    expect(ids.size).toBe(3);
  });

  it('collectActiveImageIds 仅跳过已彻底清除 (isPurged) 的便签，保留回收站便签引用', () => {
    const activeNote: Note = {
      id: 'n1',
      categoryId: 'all',
      content: '![img](images/active.png)',
      color: 'yellow',
      isPinned: false,
      createdAt: 1000,
      updatedAt: 1000
    };
    const trashNote: Note = {
      id: 'n2',
      categoryId: 'all',
      content: '![img](images/in_trash.png)',
      isDeleted: true,
      color: 'yellow',
      isPinned: false,
      createdAt: 1000,
      updatedAt: 1000
    };
    const purgedNote: Note = {
      id: 'n3',
      categoryId: 'all',
      content: '![img](images/purged.png)',
      isDeleted: true,
      isPurged: true,
      purgedAt: 2000,
      color: 'yellow',
      isPinned: false,
      createdAt: 1000,
      updatedAt: 1000
    };

    const activeIds = imageLifecycleService.collectActiveImageIds([activeNote, trashNote, purgedNote]);
    expect(activeIds.has('active.png')).toBe(true);
    expect(activeIds.has('in_trash.png')).toBe(true); // 回收站里的图片仍受保护
    expect(activeIds.has('purged.png')).toBe(false); // 彻底清除的不再被引用保护
  });

  it('findOrphanImages 正确判定超过宽限期的孤儿图片', () => {
    const now = Date.now();
    const activeIds = new Set(['used.png']);

    const images: ImageMeta[] = [
      {
        id: 'used.png',
        path: 'images/used.png',
        size: 100,
        mimeType: 'image/png',
        createdAt: now - 30 * 24 * 60 * 60 * 1000,
        uploadStatus: 'uploaded'
      },
      {
        id: 'recent_orphan.png',
        path: 'images/recent_orphan.png',
        size: 100,
        mimeType: 'image/png',
        createdAt: now - 2 * 24 * 60 * 60 * 1000, // 2天前，在 7 天宽限期内
        uploadStatus: 'uploaded'
      },
      {
        id: 'dead_orphan.png',
        path: 'images/dead_orphan.png',
        size: 100,
        mimeType: 'image/png',
        createdAt: now - 10 * 24 * 60 * 60 * 1000, // 10天前，已超宽限期
        uploadStatus: 'uploaded'
      }
    ];

    const orphans = imageLifecycleService.findOrphanImages(images, activeIds, 7 * 24 * 60 * 60 * 1000);
    expect(orphans.length).toBe(1);
    expect(orphans[0].id).toBe('dead_orphan.png');
  });

  it('performImageGC 能联动本地存储与远端 WebDAV 执行垃圾回收', async () => {
    const now = Date.now();
    const fakeBlob = new Blob(['data'], { type: 'image/png' });

    // 存入一张活跃的图片
    await imageRepository.saveImage(fakeBlob, { customId: 'active.png', autoCompress: false });
    // 存入一张超期的孤儿图片
    const orphanRecord = await imageRepository.saveImage(fakeBlob, { customId: 'orphan.png', autoCompress: false });
    orphanRecord.meta.createdAt = now - 15 * 24 * 60 * 60 * 1000; // 模拟 15 天前

    const notes: Note[] = [
      {
        id: 'n1',
        categoryId: 'all',
        content: '![a](images/active.png)',
        color: 'yellow',
        isPinned: false,
        createdAt: 1000,
        updatedAt: 1000
      }
    ];

    // Mock WebdavClient
    const mockClient = {
      deleteFile: vi.fn().mockResolvedValue({ success: true })
    } as any;

    const result = await imageLifecycleService.performImageGC(notes, mockClient, {
      gracePeriodDays: 7,
      remoteDir: '/toolkit/moment_notes_images'
    });

    expect(result.activeCount).toBe(1);
    expect(result.cleanedLocal).toBe(1);
    expect(result.cleanedRemote).toBe(1);
    expect(mockClient.deleteFile).toHaveBeenCalledWith('/toolkit/moment_notes_images/orphan.png');

    // 验证本地确实已删除 orphan.png 但保留 active.png
    expect(await imageRepository.getImageBlob('orphan.png')).toBeNull();
    expect(await imageRepository.getImageBlob('active.png')).not.toBeNull();
  });
});
