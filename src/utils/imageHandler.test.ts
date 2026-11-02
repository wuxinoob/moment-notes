import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatFileSize, processAttachmentFile, getFilesFromEvent, downloadBlob } from './imageHandler';
import { imageRepository } from '../infrastructure/storage/ImageRepository';

describe('imageHandler 多媒体与通用文件处理工具单测', () => {
  beforeEach(async () => {
    await imageRepository.clearAll();
  });

  it('formatFileSize 格式化各种字节大小', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
    expect(formatFileSize(1024 * 1024 * 1024 * 1.8)).toBe('1.8 GB');
  });

  it('processAttachmentFile 正确处理图片生成图片 Markdown', async () => {
    const file = new File(['fake-image-bytes'], 'photo.png', { type: 'image/png' });
    const result = await processAttachmentFile(file, { autoCompress: false });

    expect(result.type).toBe('image');
    expect(result.originalName).toBe('photo.png');
    expect(result.markdownText).toContain('![photo.png](images/');
    expect(result.path).toContain('images/');
  });

  it('processAttachmentFile 正确处理音频生成音频 Markdown', async () => {
    const file = new File(['fake-audio-bytes'], 'meeting.mp3', { type: 'audio/mpeg' });
    const result = await processAttachmentFile(file);

    expect(result.type).toBe('audio');
    expect(result.originalName).toBe('meeting.mp3');
    expect(result.markdownText).toContain('[audio:meeting.mp3](attachments/audio_');
  });

  it('processAttachmentFile 正确处理视频生成视频 Markdown', async () => {
    const file = new File(['fake-video-bytes'], 'screen.mp4', { type: 'video/mp4' });
    const result = await processAttachmentFile(file);

    expect(result.type).toBe('video');
    expect(result.originalName).toBe('screen.mp4');
    expect(result.markdownText).toContain('[video:screen.mp4](attachments/video_');
  });

  it('processAttachmentFile 正确处理通用文档生成附件 Markdown', async () => {
    const file = new File(['fake-pdf-bytes'], 'spec.pdf', { type: 'application/pdf' });
    const result = await processAttachmentFile(file);

    expect(result.type).toBe('file');
    expect(result.originalName).toBe('spec.pdf');
    expect(result.markdownText).toContain('[📎 spec.pdf');
    expect(result.markdownText).toContain('](attachments/file_');
  });

  it('getFilesFromEvent 能够从 ClipboardEvent 或 DragEvent 提取文件列表', () => {
    const file1 = new File(['f1'], 'test1.txt', { type: 'text/plain' });
    const file2 = new File(['f2'], 'test2.png', { type: 'image/png' });

    // 模拟 ClipboardEvent
    const mockClipboardEvent = {
      clipboardData: {
        files: [file1, file2]
      }
    } as unknown as ClipboardEvent;

    const filesFromPaste = getFilesFromEvent(mockClipboardEvent);
    expect(filesFromPaste.length).toBe(2);
    expect(filesFromPaste[0].name).toBe('test1.txt');

    // 模拟 DragEvent
    const mockDragEvent = {
      dataTransfer: {
        files: [file1]
      }
    } as unknown as DragEvent;

    const filesFromDrop = getFilesFromEvent(mockDragEvent);
    expect(filesFromDrop.length).toBe(1);
    expect(filesFromDrop[0].name).toBe('test1.txt');
  });

  it('downloadBlob 支持 showSaveFilePicker 成功保存及 Abort 取消', async () => {
    const blob = new Blob(['sample-data'], { type: 'text/plain' });
    const mockWritable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const mockHandle = {
      createWritable: vi.fn().mockResolvedValue(mockWritable)
    };

    const mockAnchor = {
      href: '',
      download: '',
      target: '',
      click: vi.fn()
    };
    const mockDoc = {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn()
      }
    };

    const mockWin = {
      document: mockDoc,
      showSaveFilePicker: undefined as any
    };
    (globalThis as any).window = mockWin;
    (globalThis as any).document = mockDoc;
    if (!(globalThis as any).URL) {
      (globalThis as any).URL = {
        createObjectURL: vi.fn().mockReturnValue('blob:test'),
        revokeObjectURL: vi.fn()
      };
    } else {
      (globalThis as any).URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
      (globalThis as any).URL.revokeObjectURL = vi.fn();
    }

    // 1. 模拟 showSaveFilePicker 成功
    const mockPicker = vi.fn().mockResolvedValue(mockHandle);
    mockWin.showSaveFilePicker = mockPicker;
    (globalThis as any).showSaveFilePicker = mockPicker;
    const saveRes = await downloadBlob(blob, 'sample.txt');
    expect(saveRes).toBe('saved');
    expect(mockWritable.write).toHaveBeenCalledWith(blob);
    expect(mockWritable.close).toHaveBeenCalled();

    // 2. 模拟用户取消选择 (AbortError)
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';
    mockWin.showSaveFilePicker = vi.fn().mockRejectedValue(abortErr);
    (globalThis as any).showSaveFilePicker = mockWin.showSaveFilePicker;
    const cancelRes = await downloadBlob(blob, 'sample.txt');
    expect(cancelRes).toBe('canceled');

    // 3. 模拟无 showSaveFilePicker 时回退到 a 标签下载
    delete (mockWin as any).showSaveFilePicker;
    delete (globalThis as any).showSaveFilePicker;
    const fallbackRes = await downloadBlob(blob, 'sample.txt');
    expect(fallbackRes).toBe('fallback');
    expect(mockAnchor.click).toHaveBeenCalled();
  });
});
