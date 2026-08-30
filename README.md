# 📌 拾光便签 (MomentNotes) - WebDAV & Script Kit 增强版

> **高颜值、高生产力的跨平台便签工具，支持 WebDAV 智能云同步与 Script Kit 桌面极速常驻。**
>
> 本项目在原版 [LingLingDayo/moment-notes](https://github.com/LingLingDayo/moment-notes) 优秀设计的基础上进行了深度二次开发，打造了**全生态兼容（uTools / Script Kit / 独立 Web 浏览器）**与**企业级 WebDAV 分布式云同步**的全新体验。

---

## 🌟 核心差异与增强特性 (Key Differences from Upstream)

| 核心特性 | 原版 (Upstream) | 增强版 (This Fork) |
| :--- | :--- | :--- |
| **云端数据同步** | 仅依赖 uTools 账号体系 | 🚀 **原生 WebDAV 云同步**（坚果云 / Nextcloud / 群晖 NAS / AList 等） |
| **多端冲突解决** | 平台内部简单覆盖 | 🛡️ **分布式墓碑合并算法 (Tombstone)**，彻底根治单端删除后幽灵复活 |
| **桌面独立运行** | 仅限 uTools 插件内运行 | 🪟 **支持 Script Kit 桌面悬浮窗**（无边框圆角、流体拖拽、常驻单例） |
| **浏览器独立运行** | 缺少部分离线降级 | 🌐 **标准 Web 环境零依赖运行**（支持任意现代浏览器直接打开） |
| **分发与自动化** | 手动打包 `.upx` | 🤖 **GitHub Actions CI/CD 自动编译**，Release 资产秒级自动拉取 |

---

## 🌈 功能亮点

### ☁️ 1. WebDAV 智能云同步引擎 (Tombstone Sync Engine)
- **通用支持**：原生支持坚果云、Nextcloud、OwnCloud、群晖 NAS、AList、InfiniCLOUD 等所有标准 WebDAV 服务器；
- **墓碑机制 (Tombstone)**：采用分布式数据同步的工业级标准，删除操作带有 `deletedAt` 墓碑标记，跨设备双向同步时自动比对时间戳进行状态裁决，**彻底杜绝单设备删除后便签再次复活的问题**；
- **智能自愈与冲突保护**：若某设备在删除后重新进行了修改，算法自动裁决恢复并保留最新编辑；
- **灵活的备份与恢复选项**：支持“双向智能同步”、“覆盖推送到云端 (Force Push)”以及“从云端强制拉取覆盖 (Force Pull)”。

### 🪟 2. Script Kit 桌面极速悬浮窗集成
- **0ms 秒开秒隐**：常驻后台守护，按快捷键 <kbd>Alt</kbd> + <kbd>N</kbd> 瞬间呼出，按 <kbd>Esc</kbd> 极速隐藏；
- **单例互斥锁保护**：内置 HTTP 本地单例互斥调度，无论触发多少次快捷键永远保持单一窗口实例，杜绝重复创建；
- **高颜值 Fluent 视觉**：16px 纯净圆角、亚克力磨砂玻璃质感，杜绝 Windows DWM 渲染黑边；
- **原生极速拖拽**：顶栏原生系统级拖拽，按钮与搜索框防误触穿透隔离，多显示器窗口坐标防抖记忆。

### 📝 3. 原版经典体验全量保留
- **双击快捷动作**：非编辑状态下双击卡片可触发“复制并粘贴到光标处”、“全屏沉浸查看”等；
- **无限层级分类**：支持多级分类与自由排序，配备“最近使用”与“最近删除”回收站；
- **Markdown & 富文本**：支持纯文本与 Markdown 自由切换，内置图片全屏缩放旋转查看器；
- **全局多维搜索**：支持空格分隔多关键词及标题/内容/标签范围筛选。

---

## 🛠️ 快速上手与运行方式

### 方式一：在 Script Kit 中运行 (推荐桌面端使用)
只需将启动脚本 [`moment-notes.js`](./moment-notes.js) 放入您的 `~/.kenv/scripts/` 目录：
1. 按下 <kbd>Alt</kbd> + <kbd>N</kbd>；
2. 脚本将自动检测本地组件，若为首次运行会自动从 GitHub Releases 下载最新的 `dist.zip` 预编译包并极速解压启动；
3. 进入设置面板 ➔ 打开 **WebDAV 同步** ➔ 填入您的云盘地址与授权密码即可开启多端实时同步！

### 方式二：在独立 Web 浏览器中运行
直接双击打开编译生成的 `dist/index.html` 或通过任意静态 Web 服务器访问。

### 方式三：在 uTools 中作为插件运行
1. 呼出 uTools，搜索 **开发者工具**；
2. 点击 **新建项目**，选择本项目根目录下的 `public/plugin.json`；
3. 即可在 uTools 沙箱环境中作为便签插件运行。

---

## 💻 本地开发与构建

### 1. 安装依赖
```bash
npm install
```

### 2. 启动开发服务器
```bash
npm run dev
```

### 3. 本地构建并同步到 Script Kit
```bash
npm run sync:kenv
```

---

## 📄 开源许可证

本项目基于 MIT License 协议开源，感谢原作者 [LingLingDayo](https://github.com/LingLingDayo) 的优秀开源贡献！
