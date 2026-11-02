<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { openImagePreview, formatFileSize, downloadBlob } from '@utils/imageHandler';
import { isAssetUrl, extractAssetId } from '@utils/imageProcessing';
import { getOrLoadAssetUrl } from '@utils/useAssetImages';
import { imageRepository } from '../../infrastructure/storage/ImageRepository';
import { webdavSyncEngine } from '../../infrastructure/sync/WebdavSyncEngine';
import { useStickyNotesStore } from '@stores/stickyNotes';

const props = defineProps<{
  content: string;
}>();

const store = useStickyNotesStore();

// 配置 marked
marked.setOptions({
  gfm: true,
  breaks: true
});

// 已解析的附件相对路径 -> 真实访问地址 (Blob URL / Data URL)
const resolvedAttachmentUrls = ref<Record<string, string>>({});

// 异步解析正文中的媒体与附件引用 (images/... 或 attachments/... 或 attachment://...)
const resolveAttachmentsInContent = (content: string) => {
  if (!content) return;
  const regex = /(?:!\[.*?\]|\[.*?\])\((?:attachment:\/\/)?([^\s)]+)\)|(?:src|href)=["'](?:attachment:\/\/)?([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const rawRef = match[1] || match[2];
    if (!rawRef) continue;

    if (isAssetUrl(rawRef)) {
      const assetId = extractAssetId(rawRef);
      if (assetId && !resolvedAttachmentUrls.value[rawRef]) {
        getOrLoadAssetUrl(assetId).then(url => {
          if (url) {
            resolvedAttachmentUrls.value[rawRef] = url;
          }
        });
      }
      continue;
    }

    // 仅捕获系统本地附件或符合规则的媒体文件
    const isLocalAsset =
      rawRef.startsWith('images/') ||
      rawRef.startsWith('attachments/') ||
      /^(?:img_|audio_|video_|file_)/i.test(rawRef) ||
      /\.(?:png|jpe?g|webp|gif|svg|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov|mkv|pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt)$/i.test(rawRef);

    if (!isLocalAsset) continue;

    const id = imageRepository.normalizeId(rawRef);
    if (!id || resolvedAttachmentUrls.value[id]) continue;

    // 1. 同步内存速查
    const syncUrl = imageRepository.getImageUrlSync(id);
    if (syncUrl) {
      resolvedAttachmentUrls.value[id] = syncUrl;
      continue;
    }

    // 2. 异步本地 IndexedDB 恢复
    imageRepository.getImageUrl(id).then(url => {
      if (url) {
        resolvedAttachmentUrls.value[id] = url;
      } else {
        // 3. 远端懒加载下载 (若跨端刚同步过来)
        webdavSyncEngine.downloadImageIfMissing(id).then(blob => {
          if (blob) {
            imageRepository.getImageUrl(id).then(downloadedUrl => {
              if (downloadedUrl) {
                resolvedAttachmentUrls.value[id] = downloadedUrl;
              }
            });
          }
        });
      }
    });
  }
};

watch(
  () => props.content,
  newVal => {
    resolveAttachmentsInContent(newVal);
  },
  { immediate: true }
);

// 获取各种文件扩展名的对应 SVG 图标
const getAttachmentIconSvg = (ext: string): string => {
  const e = ext.toLowerCase();
  if (e === 'pdf') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e53935" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M10 12v6"/><path d="M10 12h2a2 2 0 0 1 0 4h-2"/></svg>`;
  }
  if (['doc', 'docx'].includes(e)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1976d2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>`;
  }
  if (['xls', 'xlsx', 'csv'].includes(e)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M12 9v12"/></svg>`;
  }
  if (['ppt', 'pptx'].includes(e)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e65100" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="14" r="3"/></svg>`;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f57c00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect width="22" height="5" x="1" y="3" rx="1"/><line x1="10" x2="14" y1="12" y2="12"/></svg>`;
  }
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(e)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7b1fa2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  }
  if (['mp4', 'webm', 'ogv', 'mov', 'mkv'].includes(e)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0288d1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="15" x="2" y="5" rx="2"/><polyline points="10 10 14 12.5 10 15"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`;
};

const downloadSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>`;

// 替换相对路径为真实 Blob URL 后的内容，并渲染多媒体/文件卡片
const processedContent = computed(() => {
  if (!props.content) return '';

  let res = props.content;

  // 0. 解析 asset:// 本地图片: ![alt](asset://hash.png)
  const assetRegex = /!\[(.*?)\]\((asset:\/\/[^\s)]+)\)/gi;
  res = res.replace(assetRegex, (_match, alt, fullRef) => {
    const resolved = resolvedAttachmentUrls.value[fullRef];
    if (resolved) {
      return `![${alt}](${resolved})`;
    }
    return `![${alt || '图片'}](data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40" viewBox="0 0 160 40"><rect width="160" height="40" rx="6" fill="%2388888820"/><text x="50%25" y="55%25" text-anchor="middle" dominant-baseline="middle" fill="%23888888" font-size="11" font-family="sans-serif">加载图片中...</text></svg>)`;
  });

  // 1. 解析图片: ![alt](images/img_xxx.png)
  const imageRegex = /!\[(.*?)\]\(((?:attachment:\/\/)?(?:images\/|attachments\/)?([a-zA-Z0-9_.-]+\.(?:png|jpe?g|webp|gif|svg|bmp|ico)))\)/gi;
  res = res.replace(imageRegex, (_match, alt, _fullRef, filename) => {
    const id = imageRepository.normalizeId(filename);
    const resolved = resolvedAttachmentUrls.value[id] || imageRepository.getImageUrlSync(id);
    if (resolved) {
      return `![${alt}](${resolved})`;
    }
    return `![${alt || '图片'}](data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40" viewBox="0 0 160 40"><rect width="160" height="40" rx="6" fill="%2388888820"/><text x="50%25" y="55%25" text-anchor="middle" dominant-baseline="middle" fill="%23888888" font-size="11" font-family="sans-serif">加载图片中...</text></svg>)`;
  });

  // 2. 解析音频: [audio:title](path)
  const audioRegex = /\[audio:(.*?)\]\(((?:attachment:\/\/)?(?:images\/|attachments\/)?([^\s)]+))\)/gi;
  res = res.replace(audioRegex, (_match, title, _fullRef, filename) => {
    const id = imageRepository.normalizeId(filename);
    const resolved = resolvedAttachmentUrls.value[id] || imageRepository.getImageUrlSync(id);
    const meta = imageRepository.getMetaSync(id);
    const sizeStr = meta?.size ? formatFileSize(meta.size) : '';
    const cleanTitle = (title || filename || '音频').replace(/[<>&"]/g, '');

    const audioSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    const sizeBadge = sizeStr ? `<span class="media-audio-size">${sizeStr}</span>` : '';
    return `\n\n<div class="media-audio-card" data-asset-id="${id}" data-filename="${cleanTitle}" data-url="${resolved || ''}"><div class="media-audio-header"><span class="media-audio-icon">${audioSvg}</span><span class="media-audio-title" title="${cleanTitle}">${cleanTitle}</span>${sizeBadge}</div><audio controls preload="metadata" src="${resolved || ''}" class="media-audio-element">您的浏览器不支持音频播放</audio></div>\n\n`;
  });

  // 3. 解析视频: [video:title](path)
  const videoRegex = /\[video:(.*?)\]\(((?:attachment:\/\/)?(?:images\/|attachments\/)?([^\s)]+))\)/gi;
  res = res.replace(videoRegex, (_match, title, _fullRef, filename) => {
    const id = imageRepository.normalizeId(filename);
    const resolved = resolvedAttachmentUrls.value[id] || imageRepository.getImageUrlSync(id);
    const meta = imageRepository.getMetaSync(id);
    const sizeStr = meta?.size ? formatFileSize(meta.size) : '';
    const cleanTitle = (title || filename || '视频').replace(/[<>&"]/g, '');

    const videoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="15" x="2" y="5" rx="2"/><polyline points="10 10 14 12.5 10 15"/></svg>`;
    const sizeBadge = sizeStr ? `<span class="media-video-size">${sizeStr}</span>` : '';
    return `\n\n<div class="media-video-card" data-asset-id="${id}" data-filename="${cleanTitle}" data-url="${resolved || ''}"><div class="media-video-header"><span class="media-video-icon">${videoSvg}</span><span class="media-video-title" title="${cleanTitle}">${cleanTitle}</span>${sizeBadge}</div><video controls preload="metadata" playsinline src="${resolved || ''}" class="media-video-element">您的浏览器不支持视频播放</video></div>\n\n`;
  });

  // 4. 解析通用文件附件: [📎 title (size)](path) 或 [title](attachments/file_xxx.ext)
  const fileRegex = /\[(?:📎\s*)?(.*?)\]\(((?:attachment:\/\/)?(?:images\/|attachments\/)?([^\s)]+))\)/gi;
  res = res.replace(fileRegex, (match, title, fullRef, filename) => {
    // 排除已处理的 audio/video
    if (match.startsWith('[audio:') || match.startsWith('[video:')) return match;

    const isLocalAsset =
      fullRef.startsWith('attachment://') ||
      fullRef.startsWith('attachments/') ||
      fullRef.startsWith('images/') ||
      /^(?:file_|img_|audio_|video_)/i.test(filename);

    if (!isLocalAsset) return match;

    const id = imageRepository.normalizeId(filename);
    const resolved = resolvedAttachmentUrls.value[id] || imageRepository.getImageUrlSync(id);
    const meta = imageRepository.getMetaSync(id);

    let cleanTitle = (title || filename || '附件').trim();
    let sizeDisplay = '';
    const sizeMatch = cleanTitle.match(/\s*\(([0-9.]+\s*[KMGT]?B)\)$/i);
    if (sizeMatch) {
      sizeDisplay = sizeMatch[1];
      cleanTitle = cleanTitle.replace(/\s*\([0-9.]+\s*[KMGT]?B\)$/i, '').trim();
    }
    if (!sizeDisplay && meta?.size) {
      sizeDisplay = formatFileSize(meta.size);
    }

    const safeTitle = cleanTitle.replace(/[<>&"]/g, '');
    const ext = (safeTitle.split('.').pop() || filename.split('.').pop() || 'file').toLowerCase();
    const iconSvg = getAttachmentIconSvg(ext);
    const isPdf = ext === 'pdf';
    const actionLabel = isPdf ? '预览' : '下载';

    const previewBtn = `<button class="chip-action-btn" type="button" data-action="${isPdf ? 'preview' : 'download'}" title="${isPdf ? '在浏览器新标签页中预览' : '下载到本地'}">${isPdf ? previewSvg : downloadSvg}<span class="action-text">${actionLabel}</span></button>`;
    const secondaryDownloadBtn = isPdf
      ? `<button class="chip-action-btn secondary" type="button" data-action="download" title="下载到本地">${downloadSvg}</button>`
      : '';

    return `\n\n<div class="attachment-file-chip" data-asset-id="${id}" data-filename="${safeTitle}" data-url="${resolved || ''}" data-ext="${ext}" title="点击${isPdf ? '预览 PDF' : '下载文件'}"><div class="chip-main"><span class="chip-icon">${iconSvg}</span><div class="chip-text"><span class="chip-filename" title="${safeTitle}">${safeTitle}</span><span class="chip-meta">${sizeDisplay || ext.toUpperCase()}</span></div></div><div class="chip-actions">${previewBtn}${secondaryDownloadBtn}</div></div>\n\n`;
  });

  return res;
});

// 解析并过滤 html
const renderedHtml = computed(() => {
  if (!processedContent.value) return '';
  const rawHtml = marked.parse(processedContent.value) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    ADD_TAGS: ['audio', 'video', 'source', 'button', 'svg', 'path', 'polyline', 'line', 'circle', 'rect'],
    ADD_ATTR: [
      'target',
      'class',
      'controls',
      'preload',
      'playsinline',
      'src',
      'type',
      'data-asset-id',
      'data-filename',
      'data-url',
      'data-ext',
      'data-action',
      'title',
      'viewBox',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'd',
      'x',
      'y',
      'x1',
      'y1',
      'x2',
      'y2',
      'cx',
      'cy',
      'r',
      'rx',
      'ry',
      'points'
    ]
  });
});

// 处理通用附件点击动作 (在线预览或下载)
const handleFileAttachmentAction = async (assetId: string, filename: string, action: string) => {
  if (!assetId) return;

  try {
    let blob = await imageRepository.getImageBlob(assetId);
    if (!blob) {
      store.showToast('正在从云端获取附件...', 'info');
      blob = await webdavSyncEngine.downloadImageIfMissing(assetId);
    }

    if (!blob) {
      store.showToast('附件加载失败，未找到本地或云端文件', 'error');
      return;
    }

    if (action === 'preview' && (filename.toLowerCase().endsWith('.pdf') || blob.type === 'application/pdf')) {
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      store.showToast(`已在新标签页中打开预览: ${filename}`, 'info');
    } else {
      const result = await downloadBlob(blob, filename);
      if (result === 'saved') {
        store.showToast(`文件已成功保存: ${filename}`, 'success');
      } else if (result === 'canceled') {
        // 用户取消无需报错
      } else if (result === 'failed') {
        store.showToast('下载触发失败，请重试', 'error');
      } else {
        store.showToast(`已开始下载: ${filename}`, 'success');
      }
    }
  } catch (err: any) {
    console.error('File action error:', err);
    store.showToast(`操作失败: ${err.message || '未知错误'}`, 'error');
  }
};

// 处理容器点击（捕获图片大图预览、多媒体附件动作、链接安全跳转等）
const handleContainerClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target) return;

  // 1. 处理文件附件 Chip 点击动作
  const chip = target.closest('.attachment-file-chip') as HTMLElement | null;
  if (chip) {
    e.stopPropagation();
    e.preventDefault();
    const assetId = chip.getAttribute('data-asset-id') || '';
    const filename = chip.getAttribute('data-filename') || 'attachment';
    const ext = chip.getAttribute('data-ext') || '';
    const actionBtn = target.closest('.chip-action-btn') as HTMLElement | null;
    const action = actionBtn?.getAttribute('data-action') || (ext === 'pdf' ? 'preview' : 'download');

    handleFileAttachmentAction(assetId, filename, action);
    return;
  }

  // 2. 图片点击唤起大图预览
  if (target.tagName === 'IMG') {
    e.stopPropagation();
    const src = (target as HTMLImageElement).src;
    if (src) {
      const container = e.currentTarget as HTMLElement | null;
      const imgElements = container ? Array.from(container.querySelectorAll('img')) : [];
      const imageList = imgElements.map(img => img.src).filter(Boolean);
      const index = imageList.indexOf(src);
      openImagePreview(src, imageList, index !== -1 ? index : 0);
    }
  } else if (target.tagName === 'A') {
    // 3. 外部链接在新窗口/浏览器中打开
    const href = (target as HTMLAnchorElement).getAttribute('href');
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      e.stopPropagation();
      e.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }
};
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div
    class="markdown-body"
    @click="handleContainerClick"
    v-html="renderedHtml"
  ></div>
</template>

<style lang="scss">
.markdown-body {
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.6;
  color: inherit;
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;

  p {
    margin-bottom: 0.5em;
    &:last-child {
      margin-bottom: 0;
    }
  }

  h1, h2, h3, h4, h5, h6 {
    font-weight: 700;
    line-height: 1.35;
    margin-top: 0.8em;
    margin-bottom: 0.4em;
    color: inherit;

    &:first-child {
      margin-top: 0;
    }
  }

  h1 { font-size: 1.3em; border-bottom: 1px dashed var(--popover-border); padding-bottom: 4px; }
  h2 { font-size: 1.15em; }
  h3 { font-size: 1.05em; }
  h4, h5, h6 { font-size: 1em; }

  ul, ol {
    padding-left: 1.4em;
    margin-bottom: 0.5em;
  }

  li {
    margin-bottom: 0.25em;

    input[type="checkbox"] {
      margin-right: 6px;
      vertical-align: middle;
    }
  }

  blockquote {
    margin: 0.5em 0;
    padding: 4px 10px;
    border-left: 3px solid var(--accent-color);
    background: rgba(0, 0, 0, 0.03);
    border-radius: 0 6px 6px 0;
    opacity: 0.9;

    .dark-theme & {
      background: rgba(255, 255, 255, 0.05);
    }
  }

  code {
    font-family: monospace, SFMono-Regular, Consolas;
    font-size: 0.88em;
    padding: 2px 5px;
    background: rgba(0, 0, 0, 0.06);
    border-radius: 4px;

    .dark-theme & {
      background: rgba(255, 255, 255, 0.12);
    }
  }

  pre {
    margin: 0.6em 0;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.06);
    border-radius: 8px;
    overflow-x: auto;

    .dark-theme & {
      background: rgba(0, 0, 0, 0.25);
    }

    code {
      padding: 0;
      background: transparent;
      font-size: 12px;
    }
  }

  a {
    color: var(--accent-color);
    text-decoration: underline;
    cursor: pointer;

    &:hover {
      opacity: 0.85;
    }
  }

  img {
    max-width: 100% !important;
    height: auto !important;
    box-sizing: border-box;
    display: block;
    border-radius: 8px;
    margin: 6px 0;
    cursor: zoom-in;
    transition: opacity 0.2s ease, filter 0.2s ease;

    &:hover {
      opacity: 0.92;
      filter: brightness(1.03);
    }
  }

  // 音频卡片样式
  .media-audio-card {
    margin: 8px 0;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.03);
    border: 1px solid var(--popover-border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;

    .dark-theme & {
      background: rgba(255, 255, 255, 0.04);
    }

    .media-audio-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 500;
      color: inherit;
      min-width: 0;
    }

    .media-audio-icon {
      display: flex;
      align-items: center;
      color: var(--accent-color);
      flex-shrink: 0;
    }

    .media-audio-title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .media-audio-size {
      font-size: 10px;
      opacity: 0.65;
      flex-shrink: 0;
    }

    .media-audio-element {
      width: 100%;
      height: 32px;
      border-radius: 4px;
      outline: none;
    }
  }

  // 视频卡片样式
  .media-video-card {
    margin: 8px 0;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.03);
    border: 1px solid var(--popover-border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;

    .dark-theme & {
      background: rgba(255, 255, 255, 0.04);
    }

    .media-video-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 500;
      color: inherit;
      min-width: 0;
    }

    .media-video-icon {
      display: flex;
      align-items: center;
      color: var(--accent-color);
      flex-shrink: 0;
    }

    .media-video-title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .media-video-size {
      font-size: 10px;
      opacity: 0.65;
      flex-shrink: 0;
    }

    .media-video-element {
      width: 100%;
      max-height: 280px;
      border-radius: 6px;
      background: #000;
      outline: none;
    }
  }

  // 通用文件卡片样式
  .attachment-file-chip {
    margin: 6px 0;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.03);
    border: 1px solid var(--popover-border);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    cursor: pointer;
    user-select: none;
    transition: all 0.18s ease;

    .dark-theme & {
      background: rgba(255, 255, 255, 0.04);
    }

    &:hover {
      background: var(--item-hover-bg);
      border-color: var(--accent-color);
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
    }

    .chip-main {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }

    .chip-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .chip-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }

    .chip-filename {
      font-size: 12px;
      font-weight: 500;
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: inherit;
    }

    .chip-meta {
      font-size: 10px;
      line-height: 1.2;
      opacity: 0.65;
      margin-top: 2px;
    }

    .chip-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .chip-action-btn {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 3px 8px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 500;
      background: var(--btn-bg);
      color: inherit;
      border: 1px solid var(--btn-border);
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover {
        background: var(--card-btn-hover-bg);
        color: var(--card-btn-hover-color);
        border-color: var(--card-btn-hover-bg);
      }

      &.secondary {
        padding: 3px 5px;
        opacity: 0.75;

        &:hover {
          opacity: 1;
        }
      }

      .action-text {
        font-size: 10px;
      }
    }
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.6em 0;
    font-size: 12px;

    th, td {
      padding: 4px 8px;
      border: 1px solid var(--popover-border);
      text-align: left;
    }

    th {
      background: rgba(0, 0, 0, 0.04);
      font-weight: 600;

      .dark-theme & {
        background: rgba(255, 255, 255, 0.06);
      }
    }
  }

  hr {
    border: none;
    border-top: 1px dashed var(--popover-border);
    margin: 0.8em 0;
  }
}
</style>
