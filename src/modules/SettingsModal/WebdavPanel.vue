<script lang="ts" setup>
import { ref, computed } from 'vue';
import {
  Cloud,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Plug,
  ArrowUpCircle,
  ArrowDownCircle,
  ShieldCheck
} from '@lucide/vue';
import { webdavSyncEngine, WebdavClient } from '../../infrastructure/sync/WebdavSyncEngine';
import { useStickyNotesStore } from '../../stores/stickyNotes';
import { useUiStore } from '../../stores/uiStore';

const stickyStore = useStickyNotesStore();
const uiStore = useUiStore();

const config = webdavSyncEngine.config;
const syncState = webdavSyncEngine.syncState;
const showPassword = ref(false);
const isTesting = ref(false);
const testResult = ref<{ success: boolean; message: string } | null>(null);

const formattedLastSync = computed(() => {
  if (!config.value.lastSyncTime) return '尚未同步';
  return new Date(config.value.lastSyncTime).toLocaleString();
});

const handleSave = () => {
  webdavSyncEngine.saveConfig(config.value);
};

const handleTestConnection = async () => {
  isTesting.value = true;
  testResult.value = null;
  handleSave();

  try {
    const client = new WebdavClient(config.value);
    const res = await client.testConnection();
    testResult.value = res;
    if (res.success) {
      uiStore.showToast('✅ WebDAV 连接测试成功！');
    } else {
      uiStore.showToast(`❌ ${res.message}`);
    }
  } catch (err: any) {
    testResult.value = { success: false, message: err.message || '网络连接异常' };
    uiStore.showToast(`❌ 连接失败: ${err.message}`);
  } finally {
    isTesting.value = false;
  }
};

const handleManualSync = async (mode: 'smart' | 'forcePush' | 'forcePull' = 'smart') => {
  handleSave();
  if (mode === 'forcePush') {
    uiStore.showToast('正在全量上传覆盖远端...');
  } else if (mode === 'forcePull') {
    uiStore.showToast('正在从远端拉取覆盖本地...');
  } else {
    uiStore.showToast('正在进行智能双向墓碑合并同步...');
  }

  const res = await stickyStore.syncWithWebdav({
    forcePush: mode === 'forcePush',
    forcePull: mode === 'forcePull'
  });
  if (res.success) {
    uiStore.showToast(`✅ ${res.message}`);
  } else {
    uiStore.showToast(`❌ ${res.message}`);
  }
};
</script>

<template>
  <div class="webdav-settings-panel">
    <!-- 状态横幅 -->
    <div class="sync-status-card" :class="syncState">
      <div class="status-left">
        <div class="status-icon-box">
          <Cloud v-if="syncState === 'idle'" class="icon-idle" />
          <RefreshCw v-else-if="syncState === 'syncing'" class="icon-syncing spin" />
          <CheckCircle2 v-else-if="syncState === 'success'" class="icon-success" />
          <AlertCircle v-else class="icon-error" />
        </div>
        <div class="status-info">
          <div class="status-title">
            {{
              syncState === 'syncing'
                ? '正在与云端同步...'
                : syncState === 'success'
                  ? 'WebDAV 云端已连接'
                  : syncState === 'error'
                    ? '同步出现异常'
                    : 'WebDAV 云同步'
            }}
          </div>
          <div class="status-sub">
            上次同步：{{ formattedLastSync }}
          </div>
        </div>
      </div>
      <button
        class="sync-now-btn"
        :disabled="!config.enabled || syncState === 'syncing'"
        @click="() => handleManualSync('smart')"
      >
        <RefreshCw class="btn-icon" :class="{ spin: syncState === 'syncing' }" />
        <span>立即同步</span>
      </button>
    </div>

    <!-- 表单区域 -->
    <div class="form-container">
      <!-- 启用开关 -->
      <div class="setting-row">
        <div class="row-label-group">
          <span class="row-title">启用 WebDAV 同步</span>
          <span class="row-desc">开启后便签与分类将自动同步至您的专属云盘</span>
        </div>
        <label class="switch-control">
          <input v-model="config.enabled" type="checkbox" @change="handleSave" />
          <span class="slider"></span>
        </label>
      </div>

      <!-- 服务器配置 -->
      <div v-if="config.enabled" class="fields-group">
        <!-- 服务器地址 -->
        <div class="input-field-item">
          <label class="field-label">WebDAV 服务器地址 (URL)</label>
          <input
            v-model="config.serverUrl"
            type="text"
            placeholder="如: https://dav.jianguoyun.com/dav/"
            class="text-input"
            @blur="handleSave"
          />
          <span class="field-hint">
            支持坚果云、Nextcloud、群晖 NAS、AList、InfiniCLOUD 等标准 WebDAV。
          </span>
        </div>

        <!-- 账号与密码 -->
        <div class="field-row-double">
          <div class="input-field-item">
            <label class="field-label">账号 / 用户名</label>
            <input
              v-model="config.username"
              type="text"
              placeholder="WebDAV 用户名"
              class="text-input"
              @blur="handleSave"
            />
          </div>

          <div class="input-field-item">
            <label class="field-label">应用密码 / Token</label>
            <div class="password-wrapper">
              <input
                v-model="config.password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="应用授权专用密码"
                class="text-input pwd-input"
                @blur="handleSave"
              />
              <button class="eye-btn" type="button" @click="showPassword = !showPassword">
                <EyeOff v-if="showPassword" class="eye-icon" />
                <Eye v-else class="eye-icon" />
              </button>
            </div>
          </div>
        </div>

        <!-- 远程文件路径 -->
        <div class="input-field-item">
          <label class="field-label">云端存储路径 (JSON 文件)</label>
          <input
            v-model="config.remotePath"
            type="text"
            placeholder="/ScriptKit/moment_notes.json"
            class="text-input"
            @blur="handleSave"
          />
          <span class="field-hint">云端将以标准 JSON 结构备份所有便签、分类与偏好设置</span>
        </div>

        <!-- 自动同步开关 -->
        <div class="setting-row sub-row">
          <div class="row-label-group">
            <span class="row-title">自动静默同步</span>
            <span class="row-desc">启动时自动拉取最新便签，编辑修改后 3 秒自动保存至云端</span>
          </div>
          <label class="switch-control">
            <input v-model="config.autoSync" type="checkbox" @change="handleSave" />
            <span class="slider"></span>
          </label>
        </div>

        <!-- 定时轮询间隔 -->
        <div v-if="config.autoSync" class="input-field-item">
          <label class="field-label">后台静默轮询间隔 (分钟)</label>
          <input
            v-model.number="config.syncIntervalMinutes"
            type="number"
            min="1"
            max="60"
            class="text-input"
            style="width: 140px;"
            @blur="handleSave"
          />
          <span class="field-hint">后台常驻期间定期检查并双向同步云端改动 (默认 5 分钟)</span>
        </div>

        <!-- 墓碑机制说明卡片 -->
        <div class="tombstone-info-box">
          <ShieldCheck class="shield-icon" />
          <div class="info-content">
            <span class="info-title">已启用分布式墓碑同步 (Tombstone Merge)</span>
            <span class="info-desc">跨设备删除、编辑与新建自动比对时间戳进行安全双向合并，彻底杜绝单侧删除后便签复活问题。</span>
          </div>
        </div>

        <!-- 测试与操作按钮栏 -->
        <div class="actions-row">
          <button class="tool-btn test-btn" :disabled="isTesting" @click="handleTestConnection">
            <Plug class="btn-icon" />
            <span>{{ isTesting ? '测试中...' : '测试连接' }}</span>
          </button>
          <button class="tool-btn sync-btn" :disabled="syncState === 'syncing'" @click="() => handleManualSync('smart')">
            <RefreshCw class="btn-icon" :class="{ spin: syncState === 'syncing' }" />
            <span>双向智能同步</span>
          </button>
          <button class="tool-btn force-btn" @click="() => handleManualSync('forcePush')">
            <ArrowUpCircle class="btn-icon" />
            <span>覆盖推送到云端</span>
          </button>
          <button class="tool-btn pull-btn" @click="() => handleManualSync('forcePull')">
            <ArrowDownCircle class="btn-icon" />
            <span>从云端强制拉取</span>
          </button>
        </div>

        <!-- 测试结果提示 -->
        <div v-if="testResult" class="test-result-box" :class="{ success: testResult.success, error: !testResult.success }">
          <component :is="testResult.success ? CheckCircle2 : AlertCircle" class="res-icon" />
          <span>{{ testResult.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.webdav-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.sync-status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--card-bg, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;

  &.success {
    border-color: rgba(34, 197, 94, 0.35);
    background: rgba(34, 197, 94, 0.08);
  }
  &.error {
    border-color: rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.08);
  }
  &.syncing {
    border-color: rgba(59, 130, 246, 0.35);
    background: rgba(59, 130, 246, 0.08);
  }

  .status-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .status-icon-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.08);

    .icon-idle { width: 20px; height: 20px; color: var(--text-secondary); }
    .icon-syncing { width: 20px; height: 20px; color: #3b82f6; }
    .icon-success { width: 20px; height: 20px; color: #22c55e; }
    .icon-error { width: 20px; height: 20px; color: #ef4444; }
  }

  .status-info {
    display: flex;
    flex-direction: column;
    gap: 2px;

    .status-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .status-sub {
      font-size: 12px;
      color: var(--text-secondary);
    }
  }

  .sync-now-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.18);
      transform: translateY(-1px);
    }
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-icon { width: 14px; height: 14px; }
  }
}

.form-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;

  &.sub-row {
    padding-top: 6px;
    border-top: 1px dashed rgba(255, 255, 255, 0.08);
  }

  .row-label-group {
    display: flex;
    flex-direction: column;
    gap: 3px;

    .row-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
    }
    .row-desc {
      font-size: 12px;
      color: var(--text-secondary);
    }
  }
}

.switch-control {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;

  input { opacity: 0; width: 0; height: 0; }
  .slider {
    position: absolute;
    cursor: pointer;
    top: 0; left: 0; right: 0; bottom: 0;
    background-color: rgba(255, 255, 255, 0.2);
    transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 24px;

    &:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border-radius: 50%;
    }
  }

  input:checked + .slider {
    background-color: #3b82f6;
    &:before {
      transform: translateX(20px);
    }
  }
}

.fields-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.input-field-item {
  display: flex;
  flex-direction: column;
  gap: 6px;

  .field-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .field-hint {
    font-size: 11px;
    color: var(--text-secondary);
  }
}

.field-row-double {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.text-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  outline: none;
  box-sizing: border-box;
  transition: all 0.2s ease;

  &:focus {
    border-color: #3b82f6;
    background: rgba(0, 0, 0, 0.25);
  }
}

.password-wrapper {
  position: relative;
  display: flex;
  align-items: center;

  .pwd-input {
    padding-right: 36px;
  }
  .eye-btn {
    position: absolute;
    right: 8px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;

    &:hover { color: var(--text-primary); }
    .eye-icon { width: 16px; height: 16px; }
  }
}

.tombstone-info-box {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;

  .shield-icon {
    width: 18px;
    height: 18px;
    color: #3b82f6;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .info-content {
    display: flex;
    flex-direction: column;
    gap: 2px;

    .info-title {
      font-size: 12px;
      font-weight: 600;
      color: #3b82f6;
    }
    .info-desc {
      font-size: 11px;
      color: var(--text-secondary);
      line-height: 1.4;
    }
  }
}

.actions-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 4px;

  .tool-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 1px solid transparent;

    .btn-icon { width: 14px; height: 14px; }
    &:hover:not(:disabled) {
      transform: translateY(-1px);
    }
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &.test-btn {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-primary);
      border-color: rgba(255, 255, 255, 0.15);
      &:hover:not(:disabled) { background: rgba(255, 255, 255, 0.15); }
    }
    &.sync-btn {
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
      border-color: rgba(59, 130, 246, 0.35);
      &:hover:not(:disabled) { background: rgba(59, 130, 246, 0.3); }
    }
    &.force-btn {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border-color: rgba(245, 158, 11, 0.3);
      &:hover:not(:disabled) { background: rgba(245, 158, 11, 0.25); }
    }
    &.pull-btn {
      background: rgba(168, 85, 247, 0.15);
      color: #c084fc;
      border-color: rgba(168, 85, 247, 0.3);
      &:hover:not(:disabled) { background: rgba(168, 85, 247, 0.25); }
    }
  }
}

.test-result-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;

  &.success {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }
  &.error {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .res-icon { width: 16px; height: 16px; flex-shrink: 0; }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
