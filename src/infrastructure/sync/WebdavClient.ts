import { WebdavConfig } from '@type';

export type WebdavSyncErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'REMOTE_EMPTY'
  | 'REMOTE_CORRUPT_JSON'
  | 'REMOTE_INVALID_SCHEMA'
  | 'EMPTY_UPLOAD_BLOCKED'
  | 'WIPE_PROTECTION_BLOCKED'
  | 'PRECONDITION_FAILED'
  | 'HTTP_ERROR';

export class WebdavSyncError extends Error {
  public readonly code: WebdavSyncErrorCode;
  public readonly status?: number;
  public readonly isPreconditionFailed?: boolean;

  constructor(code: WebdavSyncErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'WebdavSyncError';
    this.code = code;
    this.status = status;
    if (code === 'PRECONDITION_FAILED' || status === 412) {
      this.isPreconditionFailed = true;
    }
  }
}

const isLikelyNetworkError = (err: any): boolean => {
  if (!err) return false;
  if (err instanceof TypeError) return true;
  const msg = String(err.message || err || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('err_')
  );
};

const normalizeEtag = (rawEtag: string | null | undefined): string | undefined => {
  if (!rawEtag) return undefined;
  const cleaned = rawEtag.replace(/^W\//, '').replace(/"/g, '').trim();
  return cleaned || rawEtag;
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

  public getFullUrl(path: string): string {
    let base = (this.config.serverUrl || '').trim();
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      base = `https://${base}`;
    }
    base = base.replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  private prepareJsonContent(data: any): string {
    let content: string;
    if (typeof data === 'string') {
      content = data;
      try {
        JSON.parse(content);
      } catch (err: any) {
        throw new WebdavSyncError(
          'EMPTY_UPLOAD_BLOCKED',
          `本地待上传 JSON 格式非法 (${err?.message || '解析失败'})，已拦截上传`
        );
      }
    } else {
      content = JSON.stringify(data, null, 2);
    }

    const trimmed = (content || '').trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
      throw new WebdavSyncError(
        'EMPTY_UPLOAD_BLOCKED',
        '待上传数据为空，已拦截上传以防清空云端文件'
      );
    }
    return content;
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
        return { success: false, message: `认证失败：用户名或应用密码错误 (HTTP ${res.status})` };
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
          await fetch(url, {
            method: 'MKCOL',
            headers: {
              Authorization: this.getAuthHeader()
            }
          });
        }
      } catch {
        // 忽略中间错误，尝试继续后续操作
      }
    }
    return true;
  }

  /**
   * 获取远端文件元数据 (通过轻量 HTTP HEAD 获取 Last-Modified 与 ETag，无需下载具体文件体)
   */
  public async getFileMeta(remotePath: string): Promise<{
    exists: boolean;
    lastModified?: number;
    etag?: string;
    contentLength?: number;
  }> {
    const url = this.getFullUrl(remotePath);
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: {
          Authorization: this.getAuthHeader(),
          'Cache-Control': 'no-cache'
        }
      });

      if (res.status === 404 || !res.ok) {
        return { exists: false };
      }

      const rawEtag = res.headers.get('ETag') || undefined;
      const cleanEtag = normalizeEtag(rawEtag);
      const lastModifiedHeader = res.headers.get('Last-Modified');
      const lastModified = lastModifiedHeader ? new Date(lastModifiedHeader).getTime() : undefined;
      const rawLength = res.headers.get('Content-Length');
      const contentLength = rawLength !== null && rawLength !== '' ? Number(rawLength) : undefined;

      return {
        exists: true,
        etag: cleanEtag || rawEtag,
        lastModified,
        contentLength: Number.isFinite(contentLength) ? contentLength : undefined
      };
    } catch {
      return { exists: false };
    }
  }

  /**
   * 下载远端 JSON 文件 (附带 ETag 标记与严格的空文件/非 JSON 诊断)
   */
  public async downloadJson<T = any>(remotePath: string): Promise<{ exists: boolean; data: T | null; etag?: string }> {
    const url = this.getFullUrl(remotePath);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
          'Cache-Control': 'no-cache'
        }
      });
    } catch (err: any) {
      if (isLikelyNetworkError(err)) {
        throw new WebdavSyncError(
          'NETWORK_ERROR',
          `网络连接失败 (${err?.message || '无法连接 WebDAV 服务器'})，请检查服务器地址或网络代理`
        );
      }
      throw err;
    }

    if (res.status === 404) {
      return { exists: false, data: null };
    }

    if (res.status === 401 || res.status === 403) {
      throw new WebdavSyncError(
        'AUTH_ERROR',
        `认证失败 (HTTP ${res.status})：用户名或应用专有密码无效，请重新检查配置`,
        res.status
      );
    }

    if (!res.ok) {
      throw new WebdavSyncError(
        'HTTP_ERROR',
        `下载远端备份失败 (HTTP ${res.status}: ${res.statusText || '服务器错误'})`,
        res.status
      );
    }

    const etag = res.headers.get('ETag') || undefined;
    const text = await res.text();
    const trimmed = text.trim();

    if (!trimmed) {
      throw new WebdavSyncError(
        'REMOTE_EMPTY',
        '远端备份文件为空 (0 字节)，可能上次同步上传被中断；请检查网盘历史版本，或确认本地数据无误后点击「覆盖推送到云端」恢复',
        res.status
      );
    }

    try {
      const parsed = JSON.parse(trimmed);
      return { exists: true, data: parsed, etag };
    } catch (parseErr: any) {
      if (trimmed.startsWith('<')) {
        throw new WebdavSyncError(
          'REMOTE_CORRUPT_JSON',
          '远端返回了网页/XML 而非 JSON（可能是认证过期跳转或反向代理错误页），已中止同步以防覆盖数据',
          res.status
        );
      }
      throw new WebdavSyncError(
        'REMOTE_CORRUPT_JSON',
        `远端备份 JSON 格式损坏，已中止同步以防覆盖数据 (${parseErr?.message || '解析异常'})`,
        res.status
      );
    }
  }

  private async putJsonDirect(
    remotePath: string,
    content: string,
    ifMatch?: string
  ): Promise<{ success: boolean; etag?: string }> {
    const url = this.getFullUrl(remotePath);
    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      'Content-Type': 'application/json; charset=utf-8'
    };
    if (ifMatch) {
      headers['If-Match'] = ifMatch;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'PUT',
        headers,
        body: content
      });
    } catch (err: any) {
      if (isLikelyNetworkError(err)) {
        throw new WebdavSyncError(
          'NETWORK_ERROR',
          `上传请求网络中断 (${err?.message || '连接断开'})，请稍后重试`
        );
      }
      throw err;
    }

    if (res.status === 412) {
      throw new WebdavSyncError(
        'PRECONDITION_FAILED',
        '412 Precondition Failed: 远端文件在此期间已被其他设备更新',
        412
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new WebdavSyncError(
        'AUTH_ERROR',
        `上传认证/权限不足 (HTTP ${res.status})，请检查账号写入权限`,
        res.status
      );
    }

    if (res.status === 404 || res.status === 409) {
      throw new WebdavSyncError(
        'HTTP_ERROR',
        `上传失败 (HTTP ${res.status})：远端目录不存在或冲突`,
        res.status
      );
    }

    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new WebdavSyncError(
        'HTTP_ERROR',
        `上传失败 HTTP ${res.status}: ${res.statusText || '服务器错误'}`,
        res.status
      );
    }

    const rawEtag = res.headers?.get?.('ETag') || undefined;
    return { success: true, etag: normalizeEtag(rawEtag) };
  }

  /**
   * 直接上传 JSON 文件至 WebDAV 远端 (支持 Pre-PUT 空数据拦截与 If-Match 乐观并发锁)
   */
  public async uploadJson(remotePath: string, data: any, ifMatch?: string): Promise<{ success: boolean; etag?: string }> {
    const content = this.prepareJsonContent(data);

    const lastSlash = remotePath.lastIndexOf('/');
    if (lastSlash > 0) {
      const dirPath = remotePath.substring(0, lastSlash);
      await this.ensureDirectory(dirPath);
    }

    return await this.putJsonDirect(remotePath, content, ifMatch);
  }

  /**
   * 原子安全上传 JSON (PUT .tmp -> MOVE 覆盖原文件)
   * 若上传途中窗口关闭、系统休眠或网络断开，仅 .tmp 受损，主备份文件保持 100% 完整不被截断为 0 字节；
   * 若服务端或反向代理不支持 MOVE (400/403/405/501/502)，自动清理 .tmp 并平滑回退到直接 PUT。
   */
  public async uploadJsonAtomic(
    remotePath: string,
    data: any,
    ifMatch?: string
  ): Promise<{ success: boolean; etag?: string; usedFallbackPut?: boolean }> {
    const content = this.prepareJsonContent(data);

    const lastSlash = remotePath.lastIndexOf('/');
    if (lastSlash > 0) {
      const dirPath = remotePath.substring(0, lastSlash);
      await this.ensureDirectory(dirPath);
    }

    const tempPath = `${remotePath}.tmp`;
    // 1. 先完整写入临时文件 (不覆写线上主文件)
    await this.putJsonDirect(tempPath, content);

    // 2. 使用 WebDAV MOVE 原子替换主文件
    const sourceUrl = this.getFullUrl(tempPath);
    const destUrl = this.getFullUrl(remotePath);
    const moveHeaders: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Destination: destUrl,
      Overwrite: 'T'
    };
    if (ifMatch) {
      moveHeaders['If-Match'] = ifMatch;
    }

    try {
      const moveRes = await fetch(sourceUrl, {
        method: 'MOVE',
        headers: moveHeaders
      });

      if (moveRes.status === 412) {
        await this.deleteFile(tempPath);
        throw new WebdavSyncError(
          'PRECONDITION_FAILED',
          '412 Precondition Failed: 远端文件在此期间已被其他设备更新',
          412
        );
      }

      if (moveRes.ok || moveRes.status === 201 || moveRes.status === 204) {
        const rawEtag = moveRes.headers?.get?.('ETag') || undefined;
        return { success: true, etag: normalizeEtag(rawEtag) };
      }

      // 部分 WebDAV 服务/反向代理拒绝 MOVE 或 Destination 协议头不匹配：清理 .tmp 并回退直接 PUT
      if ([400, 403, 405, 501, 502, 503].includes(moveRes.status)) {
        await this.deleteFile(tempPath);
        const fallback = await this.putJsonDirect(remotePath, content, ifMatch);
        return { ...fallback, usedFallbackPut: true };
      }

      await this.deleteFile(tempPath);
      throw new WebdavSyncError(
        'HTTP_ERROR',
        `原子提交失败 (MOVE HTTP ${moveRes.status}: ${moveRes.statusText || '服务器错误'})`,
        moveRes.status
      );
    } catch (err: any) {
      if (err instanceof WebdavSyncError) {
        throw err;
      }
      // MOVE 本身网络/协议异常时清理 .tmp 并回退 PUT
      await this.deleteFile(tempPath);
      const fallback = await this.putJsonDirect(remotePath, content, ifMatch);
      return { ...fallback, usedFallbackPut: true };
    }
  }

  /**
   * 上传二进制文件 (图片附件等) 至 WebDAV 远端
   */
  public async uploadBinary(
    remotePath: string,
    data: Blob | ArrayBuffer,
    mimeType = 'image/png'
  ): Promise<{ success: boolean; etag?: string }> {
    const lastSlash = remotePath.lastIndexOf('/');
    if (lastSlash > 0) {
      const dirPath = remotePath.substring(0, lastSlash);
      await this.ensureDirectory(dirPath);
    }

    const url = this.getFullUrl(remotePath);
    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      'Content-Type': mimeType
    };

    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: data
    });

    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`二进制上传失败 HTTP ${res.status}: ${res.statusText}`);
    }

    const newEtag = res.headers.get('ETag') || undefined;
    return { success: true, etag: newEtag };
  }

  /**
   * 下载二进制文件 (图片附件等)
   */
  public async downloadBinary(remotePath: string): Promise<{ exists: boolean; data: Blob | null; etag?: string }> {
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
        throw new Error(`二进制下载失败 HTTP ${res.status}: ${res.statusText}`);
      }

      const etag = res.headers.get('ETag') || undefined;
      const blob = await res.blob();
      return { exists: true, data: blob, etag };
    } catch (err: any) {
      if (err.message && err.message.includes('404')) {
        return { exists: false, data: null };
      }
      throw err;
    }
  }

  /**
   * 删除 WebDAV 远端文件
   */
  public async deleteFile(remotePath: string): Promise<{ success: boolean }> {
    const url = this.getFullUrl(remotePath);
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: this.getAuthHeader()
        }
      });

      if (res.status === 404 || res.ok || res.status === 204) {
        return { success: true };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  }

  /**
   * 检查远端文件是否存在
   */
  public async checkFileExists(remotePath: string): Promise<boolean> {
    const url = this.getFullUrl(remotePath);
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: {
          Authorization: this.getAuthHeader()
        }
      }).catch(async () => {
        return await fetch(url, {
          method: 'PROPFIND',
          headers: {
            Authorization: this.getAuthHeader(),
            Depth: '0'
          }
        });
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }
}
