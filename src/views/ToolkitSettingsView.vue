<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import { getToolkitCtx } from '@utils/storage';
import { webdavSyncEngine, WebdavClient } from '../infrastructure/sync/WebdavSyncEngine';
import {
  draftBufferRepository,
  categoryRepository,
  noteRepository
} from '../infrastructure/storage/Repository';

const ctx = getToolkitCtx();

// WebDAV 配置与状态
const config = webdavSyncEngine.config;
const syncState = webdavSyncEngine.syncState;
const showPassword = ref(false);
const isTesting = ref(false);
const testMessage = ref('');
const testSuccess = ref<boolean | null>(null);

// 暂存状态
const hasUnsynced = ref(draftBufferRepository.hasUnsyncedChanges());

const refreshStatus = () => {
  hasUnsynced.value = draftBufferRepository.hasUnsyncedChanges();
};

const formattedLastSync = computed(() => {
  if (!config.value.lastSyncTime) return '尚未同步';
  return new Date(config.value.lastSyncTime).toLocaleString();
});

const saveWebdavConfig = () => {
  webdavSyncEngine.saveConfig(config.value);
  testMessage.value = '配置已保存';
  testSuccess.value = true;
  setTimeout(() => {
    if (testMessage.value === '配置已保存') testMessage.value = '';
  }, 2500);
};

const testConnection = async () => {
  isTesting.value = true;
  testMessage.value = '';
  testSuccess.value = null;
  saveWebdavConfig();

  try {
    const client = new WebdavClient(config.value);
    const res = await client.testConnection();
    testSuccess.value = res.success;
    testMessage.value = res.message;
  } catch (err: any) {
    testSuccess.value = false;
    testMessage.value = err.message || '网络连接失败';
  } finally {
    isTesting.value = false;
  }
};

const manualSync = async () => {
  saveWebdavConfig();
  testMessage.value = '正在向 WebDAV 同步...';
  testSuccess.value = null;

  try {
    const res = await webdavSyncEngine.performSync(
      () => ({
        version: '2.0.0',
        timestamp: Date.now(),
        categories: categoryRepository.getAll(),
        notes: noteRepository.getAll()
      }),
      (merged) => {
        if (merged?.categories) categoryRepository.saveAll(merged.categories);
        if (merged?.notes) noteRepository.saveAll(merged.notes);
        draftBufferRepository.markSynced();
      },
      { silent: false }
    );
    testSuccess.value = res.success;
    testMessage.value = res.message;
    refreshStatus();
  } catch (e: any) {
    testSuccess.value = false;
    testMessage.value = e.message || '同步异常';
  }
};

const clearLocalDrafts = () => {
  draftBufferRepository.clearDraft();
  refreshStatus();
  testMessage.value = '本地临时草稿已清空';
  testSuccess.value = true;
};

// 内存优化设置 (仅在 Toolkit 插件环境下生效)
const MEMORY_DESTROY_KEY = 'moment_notes_memory_destroy_on_hide';
const memoryDestroyOnHide = ref(
  typeof localStorage !== 'undefined' ? localStorage.getItem(MEMORY_DESTROY_KEY) === 'true' : false
);

const handleMemorySettingChange = () => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MEMORY_DESTROY_KEY, String(memoryDestroyOnHide.value));
  }
  ctx?.bus?.publish?.('moment-notes:config-changed', {
    key: MEMORY_DESTROY_KEY,
    value: memoryDestroyOnHide.value
  });
  testMessage.value = memoryDestroyOnHide.value
    ? '已开启省内存模式：窗口不可见时将直接销毁'
    : '已关闭省内存模式：窗口隐藏时常驻后台以加快响应';
  testSuccess.value = true;
  setTimeout(() => {
    if (testMessage.value.startsWith('已')) testMessage.value = '';
  }, 3000);
};

// 打开独立便签主窗口
const openMainWindow = async () => {
  if (ctx?.bus) {
    ctx.bus.publish('moment-notes:open-window', { type: 'main' });
  } else if (ctx?.windows) {
    try {
      const label = 'plugin-moment-notes-main';
      const url = `pluginwin.html?plugin=${encodeURIComponent(
        ctx.id || 'custom.moment-notes'
      )}&label=${encodeURIComponent(label)}`;

      await ctx.windows.create(label, {
        url,
        title: '拾光便签',
        width: 1020,
        height: 720,
        center: true,
        decorations: false,
        transparent: true,
        shadow: true,
        skipTaskbar: true,
        resizable: true
      });
      // 呼出并置顶还原聚焦
      await ctx.windows.control?.(label, 'raise', true);
      ctx.log?.info?.('Notes window summoned');
    } catch (err) {
      console.error('[Settings] Failed to open main notes window:', err);
    }
  }
};

onMounted(() => {
  refreshStatus();
});
</script>

<template>
  <div class="tb-pane tb-pane-pad" style="max-width: 860px; margin: 0 auto; line-height: 1.5;">
    <!-- 顶部横幅：标题与快捷启动 -->
    <div class="tb-card tb-card-body" style="margin-bottom: 16px;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 class="tb-screen-title" style="margin: 0; font-size: 20px; font-weight: 600;">
            拾光便签 · 控制台
          </h2>
          <div class="tb-hint" style="margin-top: 4px;">
            便签主界面将以独立窗口运行，可自绘置顶并多窗口并排使用。
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <button class="tb-btn tb-btn-primary" style="padding: 8px 18px; font-weight: 500;" @click="openMainWindow">
            🚀 打开便签独立窗口
          </button>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 16px; margin-top: 14px; font-size: 13px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span>全局呼出热键:</span>
          <span class="tb-kbd">Ctrl+Alt+N</span>
        </div>
        <div class="tb-divider" style="height: 14px; width: 1px; margin: 0 4px;"></div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span>云同步状态:</span>
          <span v-if="!config.enabled" class="tb-badge tb-badge-warn">未启用</span>
          <span v-else-if="syncState === 'syncing'" class="tb-badge tb-badge-ok">正在同步...</span>
          <span v-else-if="syncState === 'error'" class="tb-badge tb-badge-bad">同步异常</span>
          <span v-else class="tb-badge tb-badge-ok">正常运行</span>
        </div>
        <div v-if="hasUnsynced" style="display: flex; align-items: center; gap: 6px;">
          <span class="tb-badge tb-badge-warn">有未提交草稿</span>
        </div>
      </div>
    </div>

    <!-- WebDAV 云同步配置卡片 -->
    <div class="tb-card" style="margin-bottom: 16px;">
      <div class="tb-card-head" style="display: flex; align-items: center; justify-content: space-between;">
        <div class="tb-section-title" style="margin: 0;">
          ☁️ WebDAV 云同步配置
        </div>
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input
            v-model="config.enabled"
            type="checkbox"
            style="accent-color: var(--color-brand);"
            @change="saveWebdavConfig"
          />
          <span class="tb-label" style="margin: 0;">启用 WebDAV 云同步</span>
        </label>
      </div>

      <div class="tb-card-body" style="display: flex; flex-direction: column; gap: 12px;">
        <div class="tb-field">
          <span class="tb-label">WebDAV 服务器地址</span>
          <input
            v-model="config.serverUrl"
            class="tb-input"
            type="text"
            placeholder="例如: https://dav.jianguoyun.com/dav/ 或 http://192.168.1.100:5244/dav/"
            @blur="saveWebdavConfig"
          />
          <div class="tb-hint">
            支持坚果云、Nextcloud、AList、InfiniCLOUD 等标准 WebDAV 服务
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="tb-field">
            <span class="tb-label">账号 / 用户名</span>
            <input
              v-model="config.username"
              class="tb-input"
              type="text"
              placeholder="WebDAV 用户名"
              @blur="saveWebdavConfig"
            />
          </div>
          <div class="tb-field">
            <span class="tb-label">密码 / 应用专有密码</span>
            <div style="display: flex; gap: 6px;">
              <input
                v-model="config.password"
                class="tb-input"
                :type="showPassword ? 'text' : 'password'"
                placeholder="密码或应用授权码"
                style="flex: 1;"
                @blur="saveWebdavConfig"
              />
              <button class="tb-btn tb-btn-ghost" type="button" @click="showPassword = !showPassword">
                {{ showPassword ? '隐藏' : '显示' }}
              </button>
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px;">
          <div class="tb-field">
            <span class="tb-label">远端存储路径</span>
            <input
              v-model="config.remotePath"
              class="tb-input"
              type="text"
              placeholder="/toolkit/moment_notes.json"
              @blur="saveWebdavConfig"
            />
          </div>
          <div class="tb-field">
            <span class="tb-label">自动同步间隔 (分钟)</span>
            <input
              v-model.number="config.syncIntervalMinutes"
              class="tb-input"
              type="number"
              min="1"
              max="60"
              @blur="saveWebdavConfig"
            />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 12px; align-items: center;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input
              v-model="config.syncImages"
              type="checkbox"
              style="accent-color: var(--color-brand);"
              @change="saveWebdavConfig"
            />
            <span class="tb-label" style="margin: 0;">同步便签图片</span>
          </label>
          <div v-if="config.syncImages !== false" class="tb-field" style="margin: 0;">
            <input
              v-model="config.imagesRemoteDir"
              class="tb-input"
              type="text"
              placeholder="/toolkit/moment_notes_images"
              @blur="saveWebdavConfig"
            />
          </div>
        </div>

        <!-- 动作操作条 -->
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-top: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <button
              class="tb-btn tb-btn-primary"
              :disabled="isTesting"
              @click="testConnection"
            >
              {{ isTesting ? '正在测试...' : '测试连接' }}
            </button>
            <button class="tb-btn" @click="manualSync">
              立即同步
            </button>
            <button class="tb-btn tb-btn-ghost" @click="saveWebdavConfig">
              保存配置
            </button>
          </div>

          <div class="tb-hint" style="font-size: 12px;">
            上次同步: {{ formattedLastSync }}
          </div>
        </div>

        <!-- 测试与操作反馈信息 -->
        <div
          v-if="testMessage"
          :class="['tb-badge', testSuccess === true ? 'tb-badge-ok' : testSuccess === false ? 'tb-badge-bad' : 'tb-badge-warn']"
          style="padding: 6px 12px; margin-top: 4px; font-size: 13px;"
        >
          {{ testMessage }}
        </div>
      </div>
    </div>

    <!-- 性能与内存优化设置 (仅在 Toolkit 插件二级页面生效) -->
    <div class="tb-card" style="margin-bottom: 16px;">
      <div class="tb-card-head">
        <div class="tb-section-title" style="margin: 0;">
          ⚡ 性能与内存占用优化
        </div>
      </div>
      <div class="tb-card-body" style="display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px;">
          <div>
            <div style="font-weight: 500; font-size: 13.5px;">
              不可见时彻底销毁窗口 (极致省内存)
            </div>
            <div class="tb-hint" style="font-size: 12px; margin-top: 4px; line-height: 1.5;">
              开启后，便签主悬浮窗在失焦或隐藏时将直接销毁 Webview 进程以彻底释放系统内存；每次通过全局快捷键（Ctrl+Alt+N）或控制台呼出时将重新创建并渲染窗口。关闭后窗口常驻后台仅执行隐藏，呼出更敏捷。
            </div>
          </div>
          <label style="display: flex; align-items: center; cursor: pointer; flex-shrink: 0;">
            <input
              v-model="memoryDestroyOnHide"
              type="checkbox"
              style="width: 18px; height: 18px; accent-color: var(--color-brand); cursor: pointer;"
              @change="handleMemorySettingChange"
            />
          </label>
        </div>
      </div>
    </div>

    <!-- 快捷键与常用操作速查 -->
    <div class="tb-card" style="margin-bottom: 16px;">
      <div class="tb-card-head">
        <div class="tb-section-title" style="margin: 0;">
          ⌨️ 快捷键指南
        </div>
      </div>
      <div class="tb-card-body" style="padding: 0;">
        <div class="tb-row">
          <span class="tb-row-label">全局呼出 / 切换便签窗口</span>
          <span class="tb-kbd">Ctrl+Alt+N</span>
        </div>
        <div class="tb-row">
          <span class="tb-row-label">便签窗口内新建便签</span>
          <span class="tb-kbd">Ctrl+N</span>
        </div>
        <div class="tb-row">
          <span class="tb-row-label">聚焦搜索输入框</span>
          <span class="tb-kbd">Ctrl+F</span>
        </div>
        <div class="tb-row">
          <span class="tb-row-label">保存便签编辑</span>
          <span class="tb-kbd">Ctrl+S</span>
        </div>
        <div class="tb-row">
          <span class="tb-row-label">取消编辑 / 退出弹窗</span>
          <span class="tb-kbd">Esc</span>
        </div>
      </div>
    </div>

    <!-- 数据与存储说明 -->
    <div class="tb-card">
      <div class="tb-card-head">
        <div class="tb-section-title" style="margin: 0;">
          📦 数据安全与存储
        </div>
      </div>
      <div class="tb-card-body" style="display: flex; flex-direction: column; gap: 8px;">
        <div class="tb-hint" style="line-height: 1.6;">
          • 主数据以 <b>WebDAV</b> 云端作为唯一权威持久化源。<br />
          • 本地未提交修改暂存于宿主独立沙箱：<code>%APPDATA%\com.tan18.toolkit\plugin-data\custom.moment-notes\data.json</code>，安全隔离且不受浏览器缓存清理影响。
        </div>
        <div style="margin-top: 6px;">
          <button class="tb-btn tb-btn-danger tb-btn-sm" @click="clearLocalDrafts">
            清空本地未同步草稿缓冲
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

