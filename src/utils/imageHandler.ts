import { ref } from 'vue';

// 全局图片大图灯箱预览状态
export const isImagePreviewOpen = ref(false);
export const activePreviewUrl = ref('');
export const previewImageList = ref<string[]>([]);
export const currentImageIndex = ref(0);

/**
 * 唤起全局大图预览
 */
export function openImagePreview(url: string, images: string[] = [], index = 0) {
  if (!url) return;

  const list = images.length > 0 ? images : [url];
  const targetIndex = index >= 0 && index < list.length ? index : Math.max(0, list.indexOf(url));

  previewImageList.value = list;
  currentImageIndex.value = targetIndex !== -1 ? targetIndex : 0;
  activePreviewUrl.value = list[currentImageIndex.value] || url;
  isImagePreviewOpen.value = true;
}

/**
 * 切换到上一张图片
 */
export function prevImage() {
  if (previewImageList.value.length <= 1) return;
  currentImageIndex.value = (currentImageIndex.value - 1 + previewImageList.value.length) % previewImageList.value.length;
  activePreviewUrl.value = previewImageList.value[currentImageIndex.value];
}

/**
 * 切换到下一张图片
 */
export function nextImage() {
  if (previewImageList.value.length <= 1) return;
  currentImageIndex.value = (currentImageIndex.value + 1) % previewImageList.value.length;
  activePreviewUrl.value = previewImageList.value[currentImageIndex.value];
}

/**
 * 关闭大图预览
 */
export function closeImagePreview() {
  isImagePreviewOpen.value = false;
  activePreviewUrl.value = '';
  previewImageList.value = [];
  currentImageIndex.value = 0;
}

import { imageRepository } from '../infrastructure/storage/ImageRepository';
import { webdavSyncEngine } from '../infrastructure/sync/WebdavSyncEngine';
import { AttachmentType } from '@type';

/**
 * 格式化文件字节大小
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 触发本地下载或另存为 Blob 文件
 * 支持原生 Chromium / WebView2 File System Access API (showSaveFilePicker) 及标准 a 标签回退
 */
export async function downloadBlob(
  blob: Blob,
  filename: string
): Promise<'saved' | 'canceled' | 'fallback' | 'failed'> {
  const win = typeof window !== 'undefined' ? window : (globalThis as any).window;

  // 1. 优先尝试现代 Chromium / WebView2 原生 File System Access API (showSaveFilePicker)
  // 此 API 可在 Tauri WebView2 中直接弹出 Windows 原生“另存为”对话框并将 Blob 写入用户所选路径
  const savePicker =
    win && typeof win.showSaveFilePicker === 'function'
      ? win.showSaveFilePicker.bind(win)
      : typeof (globalThis as any).showSaveFilePicker === 'function'
        ? (globalThis as any).showSaveFilePicker
        : null;

  if (savePicker) {
    try {
      const ext = filename.includes('.') ? filename.split('.').pop() || '' : '';
      const handle = await savePicker({
        suggestedName: filename,
        types: ext
          ? [
              {
                description: `${ext.toUpperCase()} 文件`,
                accept: {
                  [blob.type || 'application/octet-stream']: [`.${ext}`]
                }
              }
            ]
          : undefined
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // 用户主动在系统弹窗中点击“取消”
        return 'canceled';
      }
      console.warn('[downloadBlob] showSaveFilePicker failed, trying fallback:', err);
    }
  }

  // 2. 降级方案：创建 <a> 标签触发浏览器下载 (标准 Web / PWA 模式)
  try {
    const doc = typeof document !== 'undefined' ? document : win?.document;
    if (!doc?.createElement) return 'failed';

    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.target = '_blank';
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    return 'fallback';
  } catch (err) {
    console.error('[downloadBlob] fallback <a> download failed:', err);
    return 'failed';
  }
}

/**
 * 从粘贴/拖拽事件中提取所有 File 列表 (包括图片、音频、视频、文档)
 */
export function getFilesFromEvent(e: ClipboardEvent | DragEvent): File[] {
  const files: File[] = [];
  if ('clipboardData' in e && e.clipboardData?.files && e.clipboardData.files.length > 0) {
    for (let i = 0; i < e.clipboardData.files.length; i++) {
      files.push(e.clipboardData.files[i]);
    }
  } else if ('dataTransfer' in e && e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      files.push(e.dataTransfer.files[i]);
    }
  }
  return files;
}

/**
 * 从粘贴/拖拽事件中提取所有图片 File 列表
 */
export function getImageFilesFromEvent(e: ClipboardEvent | DragEvent): File[] {
  const files: File[] = [];
  const items = 'clipboardData' in e ? e.clipboardData?.items : e.dataTransfer?.items;
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }

  if (files.length === 0) {
    const rawFiles = getFilesFromEvent(e);
    for (const f of rawFiles) {
      if (f.type.startsWith('image/')) {
        files.push(f);
      }
    }
  }

  return files;
}

/**
 * 从粘贴/拖拽事件中获取首个文件 (兼容原图片方法)
 */
export function getImageFileFromEvent(e: ClipboardEvent | DragEvent): File | null {
  const files = getImageFilesFromEvent(e);
  if (files.length > 0) return files[0];
  const allFiles = getFilesFromEvent(e);
  if (allFiles.length > 0) return allFiles[0];
  return null;
}

/**
 * 将图片 File 转换为 Base64 或 Data URL
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = err => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * 处理多媒体/文档附件文件：落盘本地 IndexedDB，生成相对路径与 Markdown，触发后台异步上传
 */
export async function processAttachmentFile(
  file: File,
  options?: { autoCompress?: boolean; maxSizeMB?: number }
): Promise<{
  id: string;
  path: string;
  url: string;
  markdownText: string;
  type: AttachmentType;
  originalName: string;
  size: number;
}> {
  const saved = await imageRepository.saveImage(file, {
    originalName: file.name,
    autoCompress: options?.autoCompress !== false,
    maxSizeMB: options?.maxSizeMB || 5
  });

  // 触发后台异步上行同步 (若已配置 WebDAV)
  webdavSyncEngine.syncPendingImages().catch(err => {
    console.warn('[ImageHandler] Auto sync attachment error:', err);
  });

  const type = saved.meta.type || 'file';
  const cleanName = (file.name || '附件').replace(/[[\]()]/g, '');
  let markdownText = '';

  if (type === 'image') {
    markdownText = `\n![${cleanName}](${saved.path})\n`;
  } else if (type === 'audio') {
    markdownText = `\n[audio:${cleanName}](${saved.path})\n`;
  } else if (type === 'video') {
    markdownText = `\n[video:${cleanName}](${saved.path})\n`;
  } else {
    markdownText = `\n[📎 ${cleanName} (${formatFileSize(file.size)})](${saved.path})\n`;
  }

  return {
    id: saved.id,
    path: saved.path,
    url: saved.url,
    markdownText,
    type,
    originalName: file.name,
    size: file.size
  };
}

/**
 * 保持向前兼容的别名方法
 */
export const processPastedImage = processAttachmentFile;

