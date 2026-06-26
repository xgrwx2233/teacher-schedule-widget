你的方向是对的：**图片预览和视频播放不要再做成聊天窗口内部 Modal，而应该抽离成一个独立的「媒体统一浏览器窗口」**。这和 QQ 的体验一致：图片、视频都在同一个独立窗口里预览，左右切换按消息顺序浏览，底部工具栏根据媒体类型自动变化。

我建议你最终定成：

```text
媒体统一浏览器窗口 = 图片预览 + 视频播放 + 左右切换 + 下载/转发/保存/缩放/旋转
```

不要再区分：

```text
图片预览窗口
视频播放窗口
```

而是统一成：

```text
Media Viewer
```

---

# 1. 产品定位

## 当前问题

你现在点击聊天区视频消息后，是在聊天窗口内部弹出播放器。这有几个问题：

1. 遮挡聊天内容。
2. 窗口尺寸受聊天主窗口限制。
3. 不像桌面端专业聊天软件。
4. 图片和视频体验割裂。
5. 不能像 QQ 一样按聊天顺序连续浏览图片 / 视频。

## 最终目标

点击聊天里的图片或视频后：

```text
打开独立媒体浏览器窗口
        ↓
显示当前图片 / 视频
        ↓
鼠标移动显示底部工具栏
        ↓
静止几秒后工具栏自动隐藏
        ↓
鼠标移到左右边缘显示上一项 / 下一项按钮
        ↓
按消息发送顺序切换图片和视频
```

---

# 2. 独立窗口设计

## 1. 窗口形式

推荐使用独立 Tauri Window，而不是网页内部 Modal。

窗口名称：

```text
media-viewer
```

窗口特征：

```text
独立窗口
黑色背景
可拖动
可最大化
可最小化
可关闭
支持全屏
支持置顶当前预览体验
```

视觉接近你给的 QQ 图：

```text
┌──────────────────────────────────────┐
│                             — □ ×    │
├──────────────────────────────────────┤
│                                      │
│              图片 / 视频内容          │
│                                      │
│                                      │
│              底部悬浮工具栏           │
└──────────────────────────────────────┘
```

## 2. 窗口背景

统一使用深色背景：

```css
background: #111111;
```

图片和视频都居中显示：

```css
object-fit: contain;
```

不要铺满裁切。老师看课件、图片、视频时，内容完整比视觉冲击更重要。

---

# 3. 媒体队列逻辑

这是整个功能的核心。

当用户点击聊天区某个图片或视频时，主聊天窗口要把当前会话里的所有图片和视频按消息发送顺序整理成一个队列。

```ts
type MediaItem = {
  id: string;
  messageId: string;
  conversationId: string;
  type: "image" | "video";

  url: string;
  thumbnailUrl?: string;
  previewUrl?: string;

  fileName?: string;
  fileSize?: number;

  width?: number;
  height?: number;

  duration?: number;

  senderId: string;
  senderName: string;

  sentAt: string;
  seq: number;
};
```

打开窗口时传入：

```ts
type MediaViewerPayload = {
  conversationId: string;
  currentMessageId: string;
  currentIndex: number;
  mediaList: MediaItem[];
};
```

排序规则：

```text
优先使用消息 seq
没有 seq 时使用 serverTime / sentAt
不要用本地渲染顺序
```

这样才能保证：

```text
上一张 / 下一张 = 聊天发送顺序
```

---

# 4. 上一个 / 下一个切换设计

## 1. 左右热区

窗口左右两侧各有一个隐形热区。

```text
左侧 80px：上一项热区
右侧 80px：下一项热区
```

鼠标移入左侧：

```text
显示左箭头
```

鼠标移入右侧：

```text
显示右箭头
```

视觉：

```text
        ◀                         ▶
```

按钮样式：

```css
.media-nav-button {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.48);
  color: #ffffff;
  backdrop-filter: blur(12px);
  transition: opacity 160ms ease, transform 160ms ease;
}
```

## 2. 边界状态

如果已经是第一项：

```text
左箭头隐藏或置灰
```

如果已经是最后一项：

```text
右箭头隐藏或置灰
```

不建议循环切换。
因为聊天记录是时间线，循环会打破用户对前后顺序的理解。

---

# 5. 底部工具栏自动隐藏

参考 QQ 的方式：鼠标动时显示，几秒不动自动隐藏。

## 规则

```text
鼠标移动：立即显示工具栏
鼠标停留 3 秒：工具栏淡出
鼠标在工具栏上：不隐藏
视频播放时静止 3 秒：工具栏隐藏，鼠标指针也隐藏
图片预览时静止 3 秒：工具栏隐藏，但鼠标指针可以不隐藏
```

我建议：

```text
视频模式：隐藏工具栏 + 隐藏鼠标指针
图片模式：隐藏工具栏，不强制隐藏鼠标指针
```

原因：图片模式经常需要缩放、拖动、看细节，隐藏鼠标会影响操作。

## 动效

```css
.media-toolbar {
  opacity: 1;
  transform: translate(-50%, 0);
  transition: opacity 180ms ease, transform 180ms ease;
}

.media-toolbar.hidden {
  opacity: 0;
  transform: translate(-50%, 16px);
  pointer-events: none;
}
```

---

# 6. 视频模式 UI

当当前项是视频时，底部工具栏显示视频控制。

## 视频展示区

```text
黑色背景
视频居中
保持原比例
不裁切
```

## 底部工具栏

```text
┌──────────────────────────────────────────────┐
│ 暂停  00:09  ━━━━━━━━━━━━━━━  03:21  静音  ⋯ │
│ 下载  转发  倍速  全屏                       │
└──────────────────────────────────────────────┘
```

更接近 QQ 的紧凑布局可以是：

```text
[暂停] 00:09 ━━━━━━━━━━━━━ 03:21 [音量] [下载] [转发] [倍速] [全屏] [...]
```

## 必备功能

| 功能         | 说明                                 |
| ---------- | ---------------------------------- |
| 播放 / 暂停    | 点击按钮或空格                            |
| 进度条拖动      | 支持点击和拖拽                            |
| 当前时间 / 总时长 | 例如 00:09 / 03:21                   |
| 音量 / 静音    | 点击静音，hover 展开音量条                   |
| 倍速         | 0.75x / 1.0x / 1.25x / 1.5x / 2.0x |
| 全屏         | 进入独立窗口全屏                           |
| 下载         | 保存到本地                              |
| 转发         | 转发给好友 / 群聊                         |
| 更多         | 存入网盘、复制文件名、查看消息位置                  |

## 视频更多菜单

```text
存入我的网盘
存入群网盘
复制文件名
打开所在消息
查看文件详情
```

---

# 7. 图片模式 UI

当切换到图片时，底部工具栏变成图片工具栏。

## 图片展示区

支持：

```text
居中显示
等比缩放
鼠标滚轮缩放
拖动画布
双击切换适应窗口 / 100%
旋转
```

## 图片工具栏

参考你图3的 QQ 体验，建议：

```text
[缩小] 24% [放大] [1:1] | [旋转] [标注] [OCR] | [转发] [下载] [...]
```

更完整：

```text
[－] 24% [+] [1:1] [适应窗口] | [左旋转] [右旋转] | [标注] [OCR] | [转发] [下载] [...]
```

## 功能优先级

第一层直接显示：

```text
缩小
缩放百分比
放大
1:1
旋转
转发
下载
更多
```

第二层放到更多菜单：

```text
存入我的网盘
存入群网盘
OCR 识别文字
标注 / 涂鸦
复制图片
打开所在消息
查看文件详情
```

因为你的产品要“简单高级”，不要把所有教学工具都堆在底部，否则会变得像修图软件。

---

# 8. 图片 / 视频统一工具栏逻辑

同一个底部 Toolbar，但根据类型切换内容。

```ts
if (currentMedia.type === "video") {
  return <VideoToolbar />;
}

if (currentMedia.type === "image") {
  return <ImageToolbar />;
}
```

共同保留：

```text
下载
转发
更多
```

视频独有：

```text
播放 / 暂停
进度条
音量
倍速
全屏
```

图片独有：

```text
缩放
1:1
适应窗口
旋转
标注
OCR
```

---

# 9. 顶部区域设计

顶部保持极简，不要压迫内容。

## 顶部标题栏

```text
左侧：文件名 / 当前序号
右侧：最小化 / 最大化 / 关闭
```

示例：

```text
实验演示视频.mp4      3 / 18                         —  □  ×
```

或者更 QQ：

```text
黑色标题栏，仅保留窗口控制按钮
```

我建议你的教师助手采用折中方案：

```text
默认只显示窗口控制按钮
鼠标移动时顶部显示文件名和序号
```

这样既干净，又方便知道当前浏览的是哪一个文件。

## 顶部信息浮层

鼠标移动时显示：

```text
美女老师群 · 3 / 18
实验演示视频.mp4
```

样式轻一点：

```css
.media-top-info {
  position: absolute;
  top: 16px;
  left: 24px;
  color: rgba(255, 255, 255, 0.86);
  font-size: 13px;
}
```

---

# 10. 键盘快捷键

成熟桌面端一定要支持键盘。

| 快捷键      | 功能            |
| -------- | ------------- |
| Esc      | 退出全屏；非全屏时关闭窗口 |
| ←        | 上一个媒体         |
| →        | 下一个媒体         |
| Space    | 视频播放 / 暂停     |
| ↑ / ↓    | 视频音量加减        |
| Ctrl + + | 图片放大          |
| Ctrl + - | 图片缩小          |
| Ctrl + 0 | 图片适应窗口        |
| Ctrl + 1 | 图片 1:1        |
| R        | 图片旋转          |
| F        | 全屏            |
| Ctrl + S | 下载 / 保存       |
| Ctrl + C | 复制图片或复制文件名    |

---

# 11. 右键菜单设计

在媒体窗口里右键，也应该提供操作。

## 图片右键

```text
复制图片
保存图片
另存为
转发
存入我的网盘
存入群网盘
OCR 识别文字
标注
打开所在消息
查看详情
```

## 视频右键

```text
播放 / 暂停
静音 / 取消静音
下载
另存为
转发
存入我的网盘
存入群网盘
复制文件名
打开所在消息
查看详情
```

如果用户没有群网盘权限，则隐藏：

```text
存入群网盘
```

---

# 12. 打开所在消息

这个功能建议一定要做。

在媒体窗口中点击：

```text
打开所在消息
```

行为：

```text
1. 激活主聊天窗口
2. 定位到对应 messageId
3. 滚动到消息
4. 高亮该消息 1.5 秒
```

这样老师在浏览图片 / 视频时，可以快速回到上下文。

---

# 13. 媒体切换时的状态规则

## 图片切换到图片

保持：

```text
重置缩放到适应窗口
重置旋转为 0
```

不建议继承上一张图片的缩放比例，否则用户容易迷路。

## 图片切换到视频

```text
停止图片拖拽状态
加载视频
默认暂停或自动播放
```

建议默认：

```text
用户点击视频打开时：自动播放
左右切换到视频时：默认暂停，显示播放按钮
```

原因：左右切换浏览时，如果自动播放视频，容易突然出声。

## 视频切换到图片

```text
暂停当前视频
清理 video 播放状态
显示图片工具栏
```

## 视频切换到视频

建议：

```text
当前视频暂停
下一个视频默认暂停
```

但如果用户明确点击播放按钮打开第一个视频，可以自动播放当前视频。

---

# 14. 加载与失败状态

## 加载中

```text
正在加载...
```

显示居中 loading。

## 图片加载失败

```text
图片加载失败
[重新加载] [下载原图]
```

## 视频加载失败

```text
视频加载失败
[重新加载] [下载视频]
```

## 文件无权限 / 已删除

```text
文件不可查看或已被删除
```

---

# 15. 媒体队列懒加载

如果当前聊天只加载了最近 50 条消息，媒体队列可能不完整。

建议设计一个接口：

```text
GET /conversations/:conversationId/media?aroundMessageId=xxx&limitBefore=50&limitAfter=50
```

返回：

```ts
type ConversationMediaResponse = {
  mediaList: MediaItem[];
  currentIndex: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};
```

当用户切到第一项附近时：

```text
自动加载更早媒体
```

切到最后一项附近时：

```text
自动加载更新媒体
```

这样体验更完整。

---

# 16. Tauri 多窗口实现建议

## 打开媒体窗口

如果窗口不存在：

```ts
createMediaViewerWindow(payload)
```

如果窗口已存在：

```ts
focusMediaViewerWindow()
emit("media-viewer:update", payload)
```

不要重复打开多个媒体窗口。
QQ 通常也是复用一个预览窗口。

## 推荐行为

```text
同一时间只保留一个 Media Viewer
再次点击新的图片 / 视频时，复用窗口并切换内容
```

原因：

1. 防止多个预览窗口混乱。
2. 更像 QQ。
3. 资源占用更低。

---

# 17. 视觉规格

## 窗口

```css
.media-viewer-root {
  background: #111111;
  color: #ffffff;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
```

## 内容区

```css
.media-stage {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

## 图片

```css
.media-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
}
```

## 视频

```css
.media-video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: #000;
}
```

## 底部工具栏

```css
.media-toolbar {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  min-height: 52px;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(30, 30, 30, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  gap: 12px;
  color: #ffffff;
}
```

---

# 18. 推荐最终界面结构

```text
Standalone Media Viewer Window

┌────────────────────────────────────────────────────┐
│  文件名 / 序号                              — □ ×  │
├────────────────────────────────────────────────────┤
│                                                    │
│      ◀                                    ▶         │
│                                                    │
│                  图片 / 视频内容                    │
│                                                    │
│                                                    │
│         ┌────────────────────────────────┐         │
│         │   根据图片/视频变化的工具栏       │         │
│         └────────────────────────────────┘         │
└────────────────────────────────────────────────────┘
```

---

# 19. 给 Codex 的开发提示词

你可以直接复制下面这段给 Codex：

```text
请将当前聊天窗口内部的视频播放弹窗，重构为独立的「媒体统一浏览器窗口 Media Viewer」。

目标：
1. 图片预览和视频播放使用同一个独立窗口。
2. 不再使用聊天窗口内部 Modal。
3. 点击聊天中的图片或视频时，打开独立 Media Viewer 窗口。
4. Media Viewer 支持按当前会话消息发送顺序浏览图片和视频。
5. 鼠标悬浮 / 移动时显示底部工具栏，静止 3 秒后工具栏自动隐藏。
6. 鼠标移动到窗口左右侧时，显示上一个 / 下一个悬浮按钮。
7. 点击上一个 / 下一个，按消息顺序切换图片或视频。
8. 当前媒体为视频时，底部显示视频播放工具栏。
9. 当前媒体为图片时，底部显示图片预览工具栏。

一、窗口架构

请使用 Tauri 多窗口机制创建独立窗口：

窗口 label：
media-viewer

窗口要求：
- 独立窗口，不是主聊天窗口内部弹窗。
- 背景 #111111。
- 支持最小化、最大化、关闭。
- 支持全屏。
- 同一时间只保留一个 media-viewer 窗口。
- 如果窗口已存在，再次点击图片 / 视频时复用窗口并更新内容。

二、打开逻辑

当用户点击聊天区图片或视频消息时：

1. 从当前会话消息列表中提取所有 image / video 消息。
2. 按消息发送顺序排序，优先使用 seq，其次使用 serverTime / sentAt。
3. 生成 mediaList。
4. 找到当前点击的消息在 mediaList 中的 currentIndex。
5. 打开或更新 media-viewer 窗口，并传入：
   - conversationId
   - currentIndex
   - mediaList

数据结构：

type MediaItem = {
  id: string;
  messageId: string;
  conversationId: string;
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  fileName?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  duration?: number;
  senderId: string;
  senderName: string;
  sentAt: string;
  seq: number;
};

三、主窗口与媒体窗口通信

如果 media-viewer 不存在：
- 创建窗口
- 初始化 payload

如果 media-viewer 已存在：
- focus 窗口
- emit media-viewer:update 事件
- 切换到新的 currentIndex

media-viewer 窗口内部监听：
- media-viewer:init
- media-viewer:update

四、左右切换按钮

在媒体窗口左右两侧设置隐形 hover 热区：

.left-hitbox:
- position absolute
- left 0
- top 0
- bottom 0
- width 80px

.right-hitbox:
- position absolute
- right 0
- top 0
- bottom 0
- width 80px

鼠标进入左侧热区：
- 显示左箭头按钮

鼠标进入右侧热区：
- 显示右箭头按钮

箭头样式：
- 48x48
- border-radius 50%
- background rgba(0,0,0,0.48)
- color white
- backdrop-filter blur(12px)
- transition 160ms

点击左箭头：
- currentIndex -= 1

点击右箭头：
- currentIndex += 1

边界：
- currentIndex === 0 时左箭头隐藏或 disabled
- currentIndex === mediaList.length - 1 时右箭头隐藏或 disabled
- 不要循环切换

五、底部工具栏自动隐藏

实现 showControls 状态。

规则：
1. 鼠标移动时 showControls = true。
2. 鼠标点击时 showControls = true。
3. 3 秒无鼠标移动后 showControls = false。
4. 鼠标位于底部工具栏上时，不自动隐藏。
5. 视频模式下隐藏工具栏时，也隐藏鼠标指针 cursor: none。
6. 图片模式下隐藏工具栏时，不强制隐藏鼠标指针。

工具栏样式：
.media-toolbar {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  min-height: 52px;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(30, 30, 30, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  gap: 12px;
  color: #ffffff;
}

隐藏状态：
opacity: 0;
transform: translate(-50%, 16px);
pointer-events: none;

六、视频模式

当 currentMedia.type === "video"：

内容区：
- 使用 HTML5 video。
- object-fit contain。
- 居中显示。
- 不裁切。

视频工具栏包括：
- 播放 / 暂停
- 当前时间
- 进度条
- 总时长
- 静音 / 音量
- 倍速 0.75x / 1.0x / 1.25x / 1.5x / 2.0x
- 全屏
- 下载
- 转发
- 更多

更多菜单：
- 存入我的网盘
- 存入群网盘
- 复制文件名
- 打开所在消息
- 查看详情

快捷键：
- Space 播放 / 暂停
- ← 上一个媒体
- → 下一个媒体
- ↑ 增加音量
- ↓ 降低音量
- Esc 关闭或退出全屏
- F 全屏

切换逻辑：
- 切换到其他媒体时暂停当前视频。
- 左右切换到视频时默认暂停。
- 用户直接点击视频消息打开时可以自动播放。

七、图片模式

当 currentMedia.type === "image"：

内容区：
- 图片居中显示。
- object-fit contain。
- 支持滚轮缩放。
- 支持拖动画布。
- 支持双击切换适应窗口 / 100%。
- 支持旋转。

图片工具栏包括：
- 缩小
- 缩放百分比
- 放大
- 1:1
- 适应窗口
- 左旋转
- 右旋转
- 转发
- 下载
- 更多

更多菜单：
- 复制图片
- 保存图片
- 另存为
- 存入我的网盘
- 存入群网盘
- OCR 识别文字
- 标注 / 涂鸦
- 打开所在消息
- 查看详情

快捷键：
- Ctrl + + 放大
- Ctrl + - 缩小
- Ctrl + 0 适应窗口
- Ctrl + 1 1:1
- R 旋转
- ← 上一个媒体
- → 下一个媒体
- Esc 关闭窗口
- Ctrl + S 保存

切换逻辑：
- 图片切换到下一张时，默认重置为适应窗口。
- 旋转角度重置为 0。
- 不继承上一张图片的缩放比例。

八、顶部信息

鼠标移动时，在左上角显示轻量信息：

- 会话名称
- 当前序号 / 总数
- 文件名

例如：
美女老师群 · 3 / 18
实验演示视频.mp4

静止 3 秒后和工具栏一起淡出。

九、打开所在消息

媒体窗口更多菜单中增加：
打开所在消息

点击后：
1. 激活主聊天窗口。
2. 根据 messageId 定位原消息。
3. 滚动到原消息。
4. 对原消息执行 1.5 秒高亮动画。

十、加载与失败状态

图片加载中：
显示 loading。

图片加载失败：
显示：
图片加载失败
[重新加载] [下载原图]

视频加载失败：
显示：
视频加载失败
[重新加载] [下载视频]

文件无权限或已删除：
显示：
文件不可查看或已被删除

十一、懒加载媒体队列

如果当前 mediaList 只包含当前已加载聊天消息，可以预留接口：

GET /conversations/:conversationId/media?aroundMessageId=xxx&limitBefore=50&limitAfter=50

返回：
{
  mediaList,
  currentIndex,
  hasMoreBefore,
  hasMoreAfter
}

当 currentIndex 接近 0 时，自动加载更早媒体。
当 currentIndex 接近 mediaList.length - 1 时，自动加载更新媒体。

十二、验收标准

1. 点击聊天图片，打开独立媒体浏览器窗口。
2. 点击聊天视频，也打开同一个媒体浏览器窗口。
3. 不再使用聊天窗口内部视频弹窗。
4. 图片和视频可以在同一个窗口里左右切换。
5. 切换顺序与聊天消息发送顺序一致。
6. 鼠标移动时显示底部工具栏。
7. 静止 3 秒后工具栏隐藏。
8. 视频工具栏显示播放、进度、音量、倍速、全屏等。
9. 图片工具栏显示缩放、1:1、旋转、下载、转发等。
10. 左右侧 hover 会出现上一项 / 下一项按钮。
11. 到第一项 / 最后一项时按钮 disabled 或隐藏。
12. Esc、左右方向键、空格等快捷键可用。
13. 可以从媒体窗口打开所在消息并定位高亮。
14. 关闭媒体窗口不会影响主聊天窗口。
15. 再次点击新媒体时复用已有 media-viewer 窗口。
```

---

# 20. 最终建议一句话

你这个功能应该定为：

```text
图片预览和视频播放统一进入独立 Media Viewer 窗口；
媒体按当前会话消息顺序组成队列；
左右 hover 显示切换按钮；
底部工具栏根据图片 / 视频动态切换；
鼠标静止后自动隐藏工具栏；
支持下载、转发、存入网盘、打开所在消息。
```

这套做完后，你的视频播放、图片预览、网盘媒体预览都会统一，整体会立刻接近 QQ 这类成熟桌面聊天软件的标准。
