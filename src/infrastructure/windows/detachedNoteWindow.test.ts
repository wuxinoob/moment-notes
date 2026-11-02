import { describe, expect, it } from 'vitest';
import {
  buildDetachedNoteWindowBrowserUrl,
  buildDetachedNoteWindowPath,
  getDetachedNoteId,
  isDetachedNoteWindow
} from './detachedNoteWindow';

describe('detachedNoteWindow', () => {
  it('应从独立便签窗口参数中解析便签 ID', () => {
    expect(getDetachedNoteId('?view=detached-note&noteId=note-1')).toBe('note-1');
    expect(isDetachedNoteWindow('?view=detached-note&noteId=note-1')).toBe(true);
  });

  it('缺少视图标识或便签 ID 时不应识别为独立便签窗口', () => {
    expect(getDetachedNoteId('?noteId=note-1')).toBeNull();
    expect(getDetachedNoteId('?view=detached-note')).toBeNull();
    expect(isDetachedNoteWindow('?view=dashboard&noteId=note-1')).toBe(false);
  });

  it('应生成可解析的相对 HTML 路径', () => {
    const path = buildDetachedNoteWindowPath('note id/中文');
    expect(path).toBe('index.html?view=detached-note&noteId=note+id%2F%E4%B8%AD%E6%96%87');
  });

  it('浏览器环境应复用当前服务器地址构建完整 URL', () => {
    const url = buildDetachedNoteWindowBrowserUrl(
      'note-2',
      'http://localhost:4021/current?foo=bar#hash'
    );

    expect(url).toBe('http://localhost:4021/current?view=detached-note&noteId=note-2');
  });
});
