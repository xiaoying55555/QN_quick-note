# QuickNote · 界面与交互说明文档 v2
> 供 CODEX 编程实现使用

---

## 一、整体结构概览

App 由三个独立部分组成：
1. **主界面** — 笔记瀑布流 + 收藏夹管理
2. **笔记详情弹窗** — 从主界面点击笔记卡片后弹出
3. **快捷便签** — 全局快捷键唤起，用于即时记录

---

## 二、主界面

### 2.1 左侧栏：收藏夹

- 纵向列表，显示所有收藏夹名称
- 点击某个收藏夹，右侧瀑布流切换为该收藏夹下的笔记
- 「全部笔记」作为默认选项固定在顶部
- 「随手记」为系统默认收藏夹，不可删除
- 左侧栏底部有一个**设置按钮（齿轮/滑块图标）**，点击展开设置面板，包含：
  - 存储路径与备份
  - 全局快捷键自定义
  - 私密收藏夹（锁定，需密码访问）
  - 其他偏好设置

### 2.2 右侧主区域：笔记瀑布流

**布局规则**
- 三列瀑布流，Z 字型排列（从左到右，从上到下）
- 第一张卡片位置固定为「+ NEW NOTE」虚线新建卡片
- 鼠标滚轮向下滚动翻页，右侧显示一个**浅绿色细条进度条**指示滚动位置

**笔记卡片内容**
- 标题（加粗）
- 正文前两行文字预览
- 若有图片，显示图片缩略图（图片笔记优先展示图片）
- 底部：标签 + 附件数量图标（图片数 / 录音数）

**卡片交互**
- 单击卡片 → 打开笔记详情弹窗
- 新增或修改过的笔记自动排到最前面（第一列第一位，NEW NOTE 卡片之后）

### 2.3 顶部工具栏

**搜索框（居中）**
- 点击展开搜索输入
- 搜索范围：标题 + 正文内容 + 标签
- 实时过滤，匹配词高亮显示

**右上角图标（从右到左）**
- **绿色半弧形图标**：最小化整个主界面窗口（不退出，仅隐藏）。退出方式为托盘图标右键 → 退出
- **排序图标**：点击循环切换排序方式：
  - 按更新时间（默认）
  - 按名称排序
  - 自定义排序（此模式下卡片可自由拖拽重新排列位置）
  - 记忆用户上次选择，下次打开沿用

---

## 三、笔记详情弹窗

### 3.1 触发方式
- 主界面单击任意笔记卡片后弹出
- 弹窗为独立浮动窗口，可在屏幕上自由拖拽

### 3.2 窗口外观
- 白色背景，圆角，明显投影阴影（阴影要足够深，确保浮在主界面之上层次清晰）
- 最大尺寸参考上传的竖向长条图片比例
- 内容区域超出时，通过鼠标滚轮向下滚动，窗口大小本身不变

### 3.3 顶部按钮
- **左上角：置顶按钮**（图钉/箭头图标）
  - 点击后该弹窗置顶于所有窗口之上（`alwaysOnTop: true`）
  - 再次点击取消置顶
  - 置顶状态有视觉反馈（图标变色或填充）
- **右上角：绿色半弧形图标** → 关闭弹窗，自动保存所有已修改内容

### 3.4 弹窗内容区（从上到下）

```
[ 置顶按钮 ]                    [ 关闭按钮 ]
标题（可编辑）
─────────────────────────────────
[ 图片缩略图1 ] [ 图片缩略图2 ] [ 录音条1 ] ...  ← 附件预览区（有附件时显示）
─────────────────────────────────
（双击进入编辑模式后显示工具栏）
🎙 | 🖼 | A+ | A- | 🔒 | B | [ + Tag ]
─────────────────────────────────
正文内容区（可滚动）
─────────────────────────────────
[ 标签区 ]
```

### 3.5 编辑模式
- **默认状态**：只读模式，不显示工具栏
- **双击正文区域**：进入编辑模式，工具栏出现在附件预览区下方、正文上方
- 工具栏功能：
  - 🎙 录音：点击开始录音，再点停止，录音条自动插入附件预览区
  - 🖼 插入图片：点击选择图片文件，缩略图出现在附件预览区
  - A+ / A-：增大 / 减小字号
  - 🔒 高亮：选中文字后点击，添加高亮背景色
  - B 加粗：选中文字后点击，加粗
  - + Tag：添加标签

### 3.6 附件预览区
- 位置：标题下方，工具栏上方，正文上方
- 图片：显示缩略图，点击查看大图
- 录音：显示录音波形条 + 时长，点击播放
- 无附件时此区域不显示，不占空间

### 3.7 自动保存
- 关闭弹窗时自动保存所有更改，无需手动点击保存按钮

---

## 四、快捷便签（即时记录）

### 4.1 触发与关闭
- **全局快捷键**（默认 `Ctrl+Shift+N`，可在设置中修改）唤起便签
- 唤起后默认为**置顶模式**（浮于所有窗口之上）
- 右上角**绿色半弧形图标**：关闭便签（不是退出，下次快捷键可再次唤起）
- `Esc`：快速关闭，不保存
- `Ctrl+Enter`：快速保存并关闭

### 4.2 便签窗口
- 可拖拽移动位置
- 内容区可通过鼠标滚轮向下滚动
- 窗口大小固定（参考设计图中的比例），内容超出时内部滚动

### 4.3 顶部归档选择器
- 显示格式：`收藏夹名 / 笔记名`（绿色文字，可点击）
- **默认状态**：
  - 收藏夹：沿用上一次使用的收藏夹
  - 笔记：默认「新建笔记」
- 点击后展开选择器：
  - 可选择不同收藏夹
  - 可选择该收藏夹下某篇已有笔记（选择后内容将追加到该笔记末尾）
  - 可选择「新建笔记」
- 关闭便签后，下次唤起：收藏夹仍记住上次，笔记重置为「新建笔记」

### 4.4 内容输入
- **不自动读取剪贴板**，由用户手动输入或粘贴
- 支持文字输入
- **支持 Ctrl+V 直接粘贴图片**：从任意来源复制的图片（网页截图、截图工具等）可直接粘贴进输入区，显示缩略图预览，保存时自动写入本地 assets 文件夹
- 标题：用户手动填写，若不填则保存时自动取正文前 20 字

### 4.5 底部工具栏
- 🎙 **录音**：点击弹出录音条，开始录音；再点停止，录音自动附加到本条笔记
- 🔒 **高亮**：选中文字后点击，添加高亮
- B **加粗**：选中文字后点击，加粗

### 4.6 保存逻辑
- 保存后内容清空，便签归档选择器保留上次收藏夹，笔记重置为「新建笔记」
- 保存的笔记在主界面中自动排到最前面

---

## 五、数据存储

```
用户文档/QuickNote/
├── data.json          ← 所有笔记与收藏夹数据
├── config.json        ← 用户设置（快捷键、排序方式、上次收藏夹等）
└── assets/
    ├── img_uuid.png   ← 图片附件
    └── audio_uuid.mp3 ← 录音附件
```

**data.json 结构**
```json
{
  "collections": [
    {
      "id": "uuid",
      "name": "随手记",
      "isDefault": true,
      "isPrivate": false,
      "createdAt": "ISO时间戳"
    }
  ],
  "notes": [
    {
      "id": "uuid",
      "collectionId": "uuid",
      "title": "标题",
      "content": "正文纯文本",
      "attachments": [
        { "type": "image", "path": "assets/img_uuid.png" },
        { "type": "audio", "path": "assets/audio_uuid.mp3", "duration": 12 }
      ],
      "tags": ["编程", "软件开发"],
      "createdAt": "ISO时间戳",
      "updatedAt": "ISO时间戳"
    }
  ]
}
```

**config.json 结构**
```json
{
  "shortcut": "Ctrl+Shift+N",
  "dataPath": "C:/Users/.../Documents/QuickNote",
  "sortMode": "updatedAt",
  "lastCollectionId": "uuid",
  "theme": "light"
}
```

---

## 六、视觉规范

- **主色调**：白色 + 浅灰背景
- **强调色**：黄绿色（仅用于：导航选中态、保存按钮、归档选择器文字、少数标签）
- **笔记弹窗**：纯白背景，圆角 16px，投影阴影明显（确保浮于主界面之上层次清晰）
- **字体层级**：标题加粗大字，正文正常字重，标签和时间戳小字弱化
- **卡片**：白色圆角，轻微阴影，间距 16px，有呼吸感
- **整体风格**：克制、清晰、不花哨，参考 Linear / 早期 Notion

---

## 七、Electron 技术实现要求

> **这一章节非常重要，直接决定视觉效果是否能还原设计图。请严格按照以下配置实现。**

### 7.1 所有弹窗窗口（便签 + 笔记详情弹窗）必须使用以下配置

```javascript
new BrowserWindow({
  frame: false,           // 去掉系统默认边框和标题栏
  transparent: true,      // 窗口背景透明，圆角和阴影才能正确显示
  backgroundColor: '#00000000', // 完全透明底色
  hasShadow: false,       // 关闭系统阴影，改用 CSS 阴影控制
  resizable: false,       // 便签固定大小，不可拉伸
  alwaysOnTop: true,      // 便签默认置顶
  skipTaskbar: true,      // 不在任务栏显示
  webPreferences: {
    nodeIntegration: true,
    contextIsolation: false
  }
})
```

笔记详情弹窗额外允许 `resizable: true`，但便签固定大小。

### 7.2 主界面窗口配置

```javascript
new BrowserWindow({
  frame: false,           // 同样去掉系统边框
  transparent: false,     // 主界面不需要透明
  backgroundColor: '#F5F5F0', // 主界面背景色（浅灰米白）
  webPreferences: {
    nodeIntegration: true,
    contextIsolation: false
  }
})
```

### 7.3 圆角与阴影必须用 CSS 实现

所有窗口的圆角、阴影、背景色全部通过 CSS 控制，不依赖系统窗口样式：

```css
/* 便签和笔记弹窗的最外层容器 */
.window-container {
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08);
  background: #ffffff;
  overflow: hidden; /* 确保内部内容不超出圆角 */
  width: 100%;
  height: 100%;
}

/* body 必须透明，否则圆角外会出现白色方块 */
body {
  background: transparent !important;
  margin: 0;
  padding: 0;
}

/* html 同样透明 */
html {
  background: transparent;
}
```

### 7.4 拖拽区域设置

去掉系统标题栏后，窗口默认无法拖动，必须手动指定可拖拽区域：

```css
/* 顶部归档选择器区域（便签）/ 标题区域（笔记弹窗）设为可拖拽 */
.drag-region {
  -webkit-app-region: drag;
}

/* 拖拽区域内的所有按钮必须设为不可拖拽，否则点击无效 */
.drag-region button,
.drag-region input,
.drag-region select,
.drag-region a {
  -webkit-app-region: no-drag;
}
```

### 7.5 窗口隐藏与托盘

- App 启动后调用 `mainWindow.hide()` 而非关闭，保持进程驻留
- 使用 `Tray` 模块创建系统托盘图标
- 托盘右键菜单：「快速记录」/ 「打开主界面」/ 「退出」
- 点击关闭按钮（x）时调用 `window.hide()`，不调用 `window.close()`，防止进程退出
- 只有托盘菜单「退出」才真正调用 `app.quit()`

### 7.6 全局快捷键

```javascript
const { globalShortcut } = require('electron')

// 注册全局快捷键，即使 App 窗口不在焦点也能触发
globalShortcut.register('Ctrl+Shift+N', () => {
  quickNoteWindow.show()
  quickNoteWindow.focus()
})

// App 退出时必须注销，否则快捷键会残留
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
```

### 7.7 图片粘贴实现

便签和笔记弹窗均需支持从剪贴板粘贴图片：

```javascript
// 监听粘贴事件
document.addEventListener('paste', (e) => {
  const items = e.clipboardData.items
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile()
      const reader = new FileReader()
      reader.onload = (event) => {
        // 将图片 base64 数据保存为本地文件
        const base64Data = event.target.result.split(',')[1]
        // 通过 ipcRenderer 发送到主进程保存为 PNG 文件
        ipcRenderer.invoke('save-image', base64Data)
      }
      reader.readAsDataURL(blob)
    }
  }
})
```

### 7.8 多窗口通信

主界面、便签、笔记详情弹窗是三个独立的 BrowserWindow，数据通过主进程统一管理：

- 所有数据读写操作通过 `ipcRenderer.invoke()` 发送给主进程
- 主进程负责读写 JSON 文件，并在数据变更后通过 `ipcMain` 通知需要刷新的窗口
- 便签保存笔记后，主进程通知主界面窗口刷新瀑布流

### 7.9 数据写入安全

防止 JSON 文件写入过程中因崩溃导致数据损坏：

```javascript
const fs = require('fs')
const path = require('path')

function safeWriteJSON(filePath, data) {
  const tempPath = filePath + '.tmp'
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tempPath, filePath) // 原子性替换，防止写入中断
}
```

### 7.10 录音实现

使用浏览器原生 `MediaRecorder API`，无需额外安装库：

```javascript
navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
  const recorder = new MediaRecorder(stream)
  const chunks = []
  recorder.ondataavailable = e => chunks.push(e.data)
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'audio/webm' })
    // 通过 ipcRenderer 发送到主进程保存为本地文件
  }
  recorder.start()
  // 停止时调用 recorder.stop()
})
```

---

## 八、开发优先级

| 优先级 | 模块 |
|--------|------|
| P0 | Electron 项目初始化：透明窗口配置、托盘、全局快捷键 |
| P0 | 快捷便签：唤起、文字输入、图片粘贴、归档选择、保存、Esc/Ctrl+Enter |
| P0 | 本地数据读写：JSON 存储、收藏夹 CRUD、笔记 CRUD |
| P1 | 主界面：瀑布流卡片、收藏夹切换、新建笔记卡片 |
| P1 | 笔记详情弹窗：展示、双击编辑、置顶、自动保存 |
| P2 | 排序功能：按更新时间 / 名称 / 自定义拖拽 |
| P2 | 搜索：实时过滤、高亮匹配 |
| P3 | 附件：图片插入、录音、附件预览区 |
| P3 | 标签系统：添加、筛选 |
| P4 | 设置页：快捷键、存储路径、私密收藏夹 |
| P4 | 进度条、滚动优化、动效细节 |
