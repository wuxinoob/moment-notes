/** @type {import("@johnlindquist/kit")} */
// Name: Moment Notes (拾光便签)
// Description: 高颜值桌面便签工具 (常驻后台 / 秒开秒隐 / 极速唤起 / WebDAV 同步 / 自动云端分发)
// Author: Antigravity
// Background: true
// Shortcut: alt n

import "@johnlindquist/kit";
import fs from "fs";
import path from "path";
import net from "net";
import os from "os";
import { execSync } from "child_process";

// ====================================================================
// 0. 命名管道单实例守护与代码热更新自愈 (Named Pipe Auto-Evicting IPC)
// ====================================================================
const PIPE_NAME = "moment-notes-ipc";
const PIPE_PATH = process.platform === "win32"
  ? `\\\\.\\pipe\\${PIPE_NAME}`
  : path.join(os.tmpdir(), `${PIPE_NAME}.sock`);

let scriptMtime = Date.now();
try {
  const currentScriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  if (fs.existsSync(currentScriptPath)) {
    scriptMtime = Math.round(fs.statSync(currentScriptPath).mtimeMs);
  }
} catch {}

let pipeServer = null;
let pendingToggleRequest = false;

let toggleNotesHandler = () => {
  pendingToggleRequest = !pendingToggleRequest;
};
let showNotesHandler = () => {
  pendingToggleRequest = true;
};
let hideNotesHandler = () => {
  pendingToggleRequest = false;
};

// 1. 尝试向已有主实例握手通信
const handshakeResult = await new Promise((resolve) => {
  const client = net.connect(PIPE_PATH, () => {
    let response = "";
    client.write(`PING ${scriptMtime}\n`);

    client.on("data", (chunk) => {
      response += chunk.toString();
      if (response.includes("\n")) {
        const reply = response.trim();
        client.end();
        if (reply === "RELOAD") {
          resolve("UPGRADE_TO_PRIMARY");
        } else {
          resolve("WOKEN");
        }
      }
    });
  });

  client.on("error", () => {
    resolve("START_PRIMARY");
  });

  client.setTimeout(1500, () => {
    client.destroy();
    resolve("START_PRIMARY");
  });
});

if (handshakeResult === "WOKEN") {
  exit();
}

if (handshakeResult === "UPGRADE_TO_PRIMARY") {
  await new Promise((r) => setTimeout(r, 200));
}

// 2. 清理 Unix 残留 socket
if (process.platform !== "win32") {
  try { fs.unlinkSync(PIPE_PATH); } catch {}
}

// 3. 启动命名管道服务
try {
  pipeServer = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes("\n")) {
        const msg = buffer.trim();
        buffer = "";

        if (msg.startsWith("PING")) {
          const parts = msg.split(" ");
          const clientMtime = parseInt(parts[1] || "0", 10);
          if (clientMtime > scriptMtime + 1000) {
            socket.write("RELOAD\n");
            socket.end();
            try { pipeServer.close(); } catch {}
            try { notesWidget?.close(); } catch {}
            setTimeout(() => exit(), 50);
            return;
          } else {
            toggleNotesHandler();
            socket.write("PONG\n");
            socket.end();
            return;
          }
        } else if (msg === "toggle") {
          toggleNotesHandler();
          socket.write("OK\n");
          socket.end();
        } else if (msg === "show") {
          showNotesHandler();
          socket.write("OK\n");
          socket.end();
        } else if (msg === "hide") {
          hideNotesHandler();
          socket.write("OK\n");
          socket.end();
        }
      }
    });
  });

  pipeServer.on("error", (err) => {
    if (err.code === "EADDRINUSE" || err.code === "EEXIST") {
      exit();
    }
  });

  pipeServer.listen(PIPE_PATH);
} catch {
  exit();
}

// ====================================================================
// 1. 规范化路径解析与云端自动拉取 (Zero-Config Auto-Provisioning)
// ====================================================================
const GITHUB_REPO = "wuxinoob/moment-notes";
const RELEASE_ZIP_URL = `https://github.com/${GITHUB_REPO}/releases/download/latest/dist.zip`;

const kenvAssetsDir = kenvPath("assets", "moment-notes");
const kenvDistHtmlPath = path.join(kenvAssetsDir, "dist", "index.html");

// 候选寻址列表（按优先级尝试）
function findLocalDist() {
  const candidates = [
    // 优先级 1: Kenv 规范化资产目录 (~/.kenv/assets/moment-notes/dist/index.html)
    kenvDistHtmlPath,
    // 优先级 2: 本地源码开发目录 (支持热调试)
    "d:/Code/Y700/unsort/script_kit/moment-notes/dist/index.html",
    // 优先级 3: 相对于脚本自身的上级目录
    path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "moment-notes/dist/index.html"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

// 自动从 GitHub Release 下载预编译产物并解压
async function downloadAndExtractRelease() {
  await ensureDir(kenvAssetsDir);
  const zipPath = path.join(kenvAssetsDir, "dist.zip");
  const targetDistDir = path.join(kenvAssetsDir, "dist");

  await notify({
    title: "拾光便签",
    body: "⚡ 首次运行：未检测到本地前端组件，正在从 GitHub 下载最新版本..."
  });

  try {
    // 1. 下载 release dist.zip
    const response = await fetch(RELEASE_ZIP_URL, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(zipPath, Buffer.from(arrayBuffer));

    // 2. 解压到 ~/.kenv/assets/moment-notes/dist
    await ensureDir(targetDistDir);
    
    // Windows / Unix 原生免依赖高速解压
    try {
      execSync(`tar -xf "${zipPath}" -C "${targetDistDir}"`, { stdio: "ignore" });
    } catch {
      if (process.platform === "win32") {
        execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDistDir}' -Force"`, {
          windowsHide: true,
          stdio: "ignore"
        });
      } else {
        execSync(`unzip -o "${zipPath}" -d "${targetDistDir}"`, { stdio: "ignore" });
      }
    }

    // 3. 清理临时压缩包
    try {
      fs.unlinkSync(zipPath);
    } catch {}

    if (fs.existsSync(kenvDistHtmlPath)) {
      await notify({ title: "拾光便签", body: "✅ 组件就绪，正在启动拾光便签..." });
      return kenvDistHtmlPath;
    }
  } catch (err) {
    console.error("Failed to download release from GitHub:", err);
    // 回退尝试检查本地源码编译
    const localDevDir = "d:/Code/Y700/unsort/script_kit/moment-notes";
    if (fs.existsSync(path.join(localDevDir, "package.json"))) {
      await notify({ title: "拾光便签", body: "⚡ 正在通过本地源码自动编译..." });
      execSync("npm run build", { cwd: localDevDir, stdio: "ignore" });
      if (fs.existsSync(path.join(localDevDir, "dist", "index.html"))) {
        return path.join(localDevDir, "dist", "index.html");
      }
    }
    await notify({
      title: "拾光便签",
      body: `❌ 初始化失败：${err.message || "无法从 GitHub 获取组件，请检查网络"}`
    });
    exit();
  }
}

let distHtmlPath = findLocalDist();
if (!distHtmlPath) {
  distHtmlPath = await downloadAndExtractRelease();
}

// ====================================================================
// 2. 配置与窗口坐标记忆
// ====================================================================
const defaultWindowConfig = {
  width: 960,
  height: 660,
  remember_position: true,
  window_x: null,
  window_y: null
};

let rawConfig = await db("moment-notes-launcher", defaultWindowConfig);

function getDistFileUrl(filePath) {
  let clean = filePath.replace(/\\/g, "/");
  if (!clean.startsWith("file:///")) {
    clean = "file:///" + clean.replace(/^\/+/, "");
  }
  return encodeURI(clean);
}

// ====================================================================
// 3. 初始化持久化后台窗口 (预加载，实现 0ms 极速唤起)
// ====================================================================
let workArea = { x: 0, y: 0, width: 1920, height: 1080 };
try {
  const screenInfo = await getActiveScreen();
  if (screenInfo?.workArea) {
    workArea = screenInfo.workArea;
  }
} catch {}

const WIN_WIDTH = rawConfig.width || 960;
const WIN_HEIGHT = rawConfig.height || 660;

let posX = rawConfig.window_x;
let posY = rawConfig.window_y;

const isOutOfBounds = posX == null || posY == null ||
  posX < workArea.x - 50 || posX > workArea.x + workArea.width - 100 ||
  posY < workArea.y - 50 || posY > workArea.y + workArea.height - 100;

if (isOutOfBounds) {
  posX = Math.round(workArea.x + (workArea.width - WIN_WIDTH) / 2);
  posY = Math.round(workArea.y + (workArea.height - WIN_HEIGHT) / 2);
  rawConfig.window_x = posX;
  rawConfig.window_y = posY;
  await rawConfig.write();
}

const appUrl = getDistFileUrl(distHtmlPath);

// 创建常驻窗口 (默认隐藏，待唤起)
const notesWidget = await widget(appUrl, {
  show: false,
  width: WIN_WIDTH,
  height: WIN_HEIGHT,
  x: posX,
  y: posY,
  minWidth: 620,
  minHeight: 450,
  frame: false,
  transparent: true,
  alwaysOnTop: false,
  resizable: true,
  maximizable: true,
  minimizable: true,
  fullscreenable: true,
  hasShadow: true,
  skipTaskbar: true,   // 核心特性 1：不在 Windows 底部任务栏显示图标
  escapeToHide: true,  // 核心特性 2：按 Esc 键原生直接隐藏，不销毁窗口
});

let isVisible = false;

// 绑定真实窗口显隐调度函数
showNotesHandler = async () => {
  try {
    notesWidget.show();
    notesWidget.focus();
    isVisible = true;
  } catch {}
};

hideNotesHandler = async () => {
  try {
    notesWidget.hide();
    isVisible = false;
  } catch {}
};

toggleNotesHandler = async () => {
  if (isVisible) {
    await hideNotesHandler();
  } else {
    await showNotesHandler();
  }
};

// 首次启动时自动显示便签主面板 (若在启动期间收到了 toggle 信号则按最终状态呈现)
if (!pendingToggleRequest) {
  await showNotesHandler();
} else {
  await toggleNotesHandler();
}

// 核心修复：注入 Esc 按键拦截与通信，当用户在前端按 Esc 时精准同步 Node 端 isVisible 状态
try {
  await notesWidget.executeJavaScript(`
    (function() {
      window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          const hasModal = document.querySelector('.modal-overlay, .modal-backdrop, .preview-modal, .confirm-modal');
          if (!hasModal && window.ipcRenderer) {
            window.ipcRenderer.send('WIDGET_CUSTOM', {
              widgetId: window.widgetId,
              action: 'hide'
            });
          }
        }
      }, true);
    })();
  `);
} catch {}

// ====================================================================
// 5. 事件与生命周期管理 (0% CPU 驻留与干净回收)
// ====================================================================

// 核心防御：窗口被真正销毁或外部关闭时，安全终止 Node 进程并释放命名管道
notesWidget.onClose(() => {
  try { pipeServer?.close(); } catch {}
  if (process.platform !== "win32") {
    try { fs.unlinkSync(PIPE_PATH); } catch {}
  }
  exit();
});

// 监听前端发来的自定义 IPC 消息（如点击关闭按钮或快捷键）
notesWidget.onCustom(async (data) => {
  if (data?.action === "hide" || data?.action === "close") {
    await hideNotesHandler();
  } else if (data?.action === "quit") {
    notesWidget.close();
    exit();
  } else if (data?.action === "toggle") {
    await toggleNotesHandler();
  }
});

// 记录移动后的位置与尺寸 (防抖 500ms 保存，消除拖拽高频 I/O 尖峰)
let moveTimer = null;
notesWidget.onMoved(({ x, y }) => {
  if (Number.isFinite(x) && Number.isFinite(y)) {
    rawConfig.window_x = x;
    rawConfig.window_y = y;
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(async () => {
      await rawConfig.write();
    }, 500);
  }
});

let resizeTimer = null;
notesWidget.onResized(({ width, height }) => {
  if (Number.isFinite(width) && Number.isFinite(height)) {
    rawConfig.width = width;
    rawConfig.height = height;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      await rawConfig.write();
    }, 500);
  }
});
