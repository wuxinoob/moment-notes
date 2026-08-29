<script lang="ts" setup>
import { ref, computed } from 'vue';
import { Cloud, CheckCircle2, AlertCircle, RefreshCw, Eye, EyeOff, Plug, ArrowUpCircle } from '@lucide/vue';
import { webdavSyncEngine } from '../../infrastructure/sync/WebdavSyncEngine';
import { useStickyNotesStore } from '../../stores/stickyNotes';
import { useUiStore } from '../../stores/uiStore';
import { WebdavClient } from '../../infrastructure/sync/WebdavSyncEngine';

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

const handleManualSync = async (forcePush = false) => {
  handleSave();
  uiStore.showToast(forcePush ? '正在全量上传覆盖远端...' : '正在进行 WebDAV 双向同步...');
  
  const res = await stickyStore.syncWithWebdav(forcePush);
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
            {{ syncState === 'syncing' ? '正在与云端同步...' : syncState === 'success' ? 'WebDAV 云端已连接' : syncState === 'error' ? '同步出现异常' : 'WebDAV 云同步' }}
          </div>
          <div class="status-sub">
            上次同步：{{ formattedLastSync }}
          </div>
        </div>
      </div>
      <button
        class="sync-now-btn"
        :disabled="!config.enabled || syncState === 'syncing'"
        @click="() => handleManualSync(false)"
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
          <span class="slider" />
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
            <span class="slider" />
          </label>
        </div>

        <!-- 测试与操作按钮栏 -->
        <div class="actions-row">
          <button class="tool-btn test-btn" :disabled="isTesting" @click="handleTestConnection">
            <Plug class="btn-icon" />
            <span>{{ isTesting ? '测试中...' : '测试连接' }}</span>
          </button>
          <button class="tool-btn force-btn" @click="() => handleManualSync(true)">
            <ArrowUpCircle class="btn-icon" />
            <span>覆盖推送到云端</span>
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
    border-color: rgba(234, 179, 8, 0.35);
    background: rgba(234, 179, 8, 0.08);
  }

  .status-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .status-icon-box {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;

    .icon-idle { width: 20px; height: 20px; color: var(--text-secondary); }
    .icon-syncing { width: 20px; height: 20px; color: #eab308; }
    .icon-success { width: 20px; height: 20px; color: #22c55e; }
    .icon-error { width: 20px; height: 20px; color: #ef4444; }
  }

  .status-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .status-sub {
    font-size: 11.5px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .sync-now-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--accent-color, #3b82f6);
    color: #ffffff;
    border: none;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover:not(:disabled) {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.form-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--card-bg, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));

  .row-label-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .row-desc {
    font-size: 11.5px;
    color: var(--text-secondary);
  }
}

.fields-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: var(--card-bg, rgba(255, 255, 255, 0.02));
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.06));
}

.input-field-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;

  .field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .field-hint {
    font-size: 11px;
    color: var(--text-tertiary, rgba(255, 255, 255, 0.4));
  }
}

.field-row-double {
  display: flex;
  gap: 12px;
}

.text-input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 9px;
  background: var(--input-bg, rgba(0, 0, 0, 0.2));
  border: 1px solid var(--input-border, rgba(255, 255, 255, 0.12));
  color: var(--text-primary);
  font-size: 12.5px;
  outline: none;
  transition: border-color 0.2s ease;

  &:focus {
    border-color: var(--accent-color, #3b82f6);
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
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;

    .eye-icon {
      width: 16px;
      height: 16px;
    }
  }
}

.actions-row {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--btn-border, rgba(255, 255, 255, 0.15));
  background: var(--btn-bg, rgba(255, 255, 255, 0.08));
  color: var(--text-primary);
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: var(--btn-hover-bg, rgba(255, 255, 255, 0.15));
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-icon {
    width: 15px;
    height: 15px;
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
    background: rgba(34, 197, 94, 0.12);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }
  &.error {
    background: rgba(239, 68, 68, 0.12);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .res-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
}

/* 开关样式 */
.switch-control {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;

  input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255, 255, 255, 0.2);
    transition: .3s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 22px;

    &:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s cubic-bezier(0.4, 0, 0.2, 1);
      border-radius: 50%;
    }
  }

  input:checked + .slider {
    background-color: var(--accent-color, #3b82f6);
  }

  input:checked + .slider:before {
    transform: translateX(18px);
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>