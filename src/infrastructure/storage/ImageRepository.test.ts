import { describe, it, expect, beforeEach } from 'vitest';
import { imageRepository } from './ImageRepository';

describe('ImageRepository 本地图片存储仓单测', () => {
  beforeEach(async () => {
    await imageRepository.clearAll();
  });

  it('normalizeId 与 toRelativePath 路径标准化处理', () => {
    expect(imageRepository.normalizeId('images/pic1.png')).toBe('pic1.png');
    expect(imageRepository.normalizeId('attachment://pic2.jpg')).toBe('pic2.jpg');
    expect(imageRepository.normalizeId('pic3.webp')).toBe('pic3.webp');
    expect(imageRepository.toRelativePath('pic1.png')).toBe('images/pic1.png');
  });

  it('saveImage 保存图片并正确生成元数据与内存缓存', async () => {
    const fakeBlob = new Blob(['fake image binary data'], { type: 'image/png' });
    const result = await imageRepository.saveImage(fakeBlob, {
      customId: 'test_image.png',
      autoCompress: false
    });

    expect(result.id).toBe('test_image.png');
    expect(result.path).toBe('images/test_image.png');
    expect(result.meta.size).toBe(fakeBlob.size);
    expect(result.meta.uploadStatus).toBe('pending');

    // 内存同步读取
    const syncUrl = imageRepository.getImageUrlSync('test_image.png');
    expect(syncUrl).toBeTruthy();

    // 异步获取 Blob
    const fetchedBlob = await imageRepository.getImageBlob('test_image.png');
    expect(fetchedBlob).toBeTruthy();
    expect(fetchedBlob?.size).toBe(fakeBlob.size);
  });

  it('getPendingUploads 与 markUploadStatus 上传状态管理', async () => {
    const fakeBlob = new Blob(['abc'], { type: 'image/jpeg' });
    await imageRepository.saveImage(fakeBlob, { customId: 'p1.jpg', autoCompress: false });

    let pending = await imageRepository.getPendingUploads();
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe('p1.jpg');

    await imageRepository.markUploadStatus('p1.jpg', 'uploaded');
    pending = await imageRepository.getPendingUploads();
    expect(pending.length).toBe(0);

    const list = await imageRepository.listImages();
    expect(list.find(i => i.id === 'p1.jpg')?.uploadStatus).toBe('uploaded');
  });

  it('deleteImage 能正确删除图片与清理内存缓存', async () => {
    const fakeBlob = new Blob(['test-del'], { type: 'image/png' });
    await imageRepository.saveImage(fakeBlob, { customId: 'del.png', autoCompress: false });

    expect(imageRepository.getImageUrlSync('del.png')).toBeTruthy();

    const ok = await imageRepository.deleteImage('del.png');
    expect(ok).toBe(true);

    expect(imageRepository.getImageUrlSync('del.png')).toBeNull();
    const blob = await imageRepository.getImageBlob('del.png');
    expect(blob).toBeNull();
  });

  it('saveAttachment 支持保存音视频与通用文件附件并正确归类', async () => {
    // 1. 音频
    const audioBlob = new Blob(['fake mp3 data'], { type: 'audio/mpeg' });
    const audioRes = await imageRepository.saveAttachment(audioBlob, { originalName: 'voice.mp3' });
    expect(audioRes.id).toMatch(/^audio_/);
    expect(audioRes.path).toBe(`attachments/${audioRes.id}`);
    expect(audioRes.meta.type).toBe('audio');
    expect(audioRes.meta.originalName).toBe('voice.mp3');

    // 2. 视频
    const videoBlob = new Blob(['fake mp4 data'], { type: 'video/mp4' });
    const videoRes = await imageRepository.saveAttachment(videoBlob, { originalName: 'movie.mp4' });
    expect(videoRes.id).toMatch(/^video_/);
    expect(videoRes.path).toBe(`attachments/${videoRes.id}`);
    expect(videoRes.meta.type).toBe('video');

    // 3. PDF 文档
    const pdfBlob = new Blob(['fake pdf data'], { type: 'application/pdf' });
    const pdfRes = await imageRepository.saveAttachment(pdfBlob, { originalName: 'manual.pdf' });
    expect(pdfRes.id).toMatch(/^file_/);
    expect(pdfRes.path).toBe(`attachments/${pdfRes.id}`);
    expect(pdfRes.meta.type).toBe('file');

    // 4. 元数据同步缓存查询
    const metaSync = imageRepository.getMetaSync(pdfRes.id);
    expect(metaSync?.originalName).toBe('manual.pdf');
    expect(metaSync?.type).toBe('file');
  });

  it('normalizeId 与 toRelativePath 兼容 attachments/ 前缀与多媒体路径转换', () => {
    expect(imageRepository.normalizeId('attachments/audio_123.mp3')).toBe('audio_123.mp3');
    expect(imageRepository.normalizeId('attachment://attachments/file_456.pdf')).toBe('file_456.pdf');
    expect(imageRepository.toRelativePath('audio_123.mp3')).toBe('attachments/audio_123.mp3');
    expect(imageRepository.toRelativePath('file_456.pdf')).toBe('attachments/file_456.pdf');
    expect(imageRepository.toRelativePath('img_789.png')).toBe('images/img_789.png');
  });
});
