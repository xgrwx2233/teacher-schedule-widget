1、plan7.md 末尾写了“上一版 plan 作废，后续只以最新 docs/plan7.md 为准”，而你现在要求 plan6.md + plan7.md 都是最高指示。建议解释为：plan7 覆盖文件生命周期、权限、访问鉴权；plan6 继续覆盖媒体统一浏览器 UI/UX 和窗口交互。---赞同。2、plan6.md 的 MediaItem 示例里有 url: string，容易被实现成前端保存/传递 OSS URL；plan7.md 明确禁止前端保存或拼接 OSS 永久地址，所有预览/下载必须经后端按来源鉴权。因此 MediaItem.url 只能是本地缓存地址或后端短期签名 URL，不能是永久 OSS URL。----请具体解释，没看懂。作用是什么，为什么这样做？你推荐的做法是什么？3、plan6.md 强调点击视频直接进入 Media Viewer 播放；plan7.md 强调聊天文件有 7 天 MessageFileRef 访问权，过期/无权限/被删除时不能云端预览、下载、转发或保存。所以 Media Viewer 打开前/加载时必须先走 MessageFileRef 鉴权，不能只看 fileObjectId。---plan7.md是对的。但是要补充一点，如果已经下载到了本地，可以直接播放，即先查本地，如果没有才进入7天访问权。4、plan6.md 关注“媒体队列”：图片/视频按消息顺序组成 Media Viewer 队列；plan7.md 关注“访问来源”：聊天消息、个人网盘、群网盘要分别鉴权。因此 Media Viewer 的每个 item 必须携带来源信息，例如 source=chat + messageId 或 source=drive + driveNodeId。---对。5、plan6.md 说视频工具栏提供下载/转发/存网盘；plan7.md 要求这些操作按状态区分：未过期可用，过期但本地存在只能本地打开/所在文件夹/重新上传，过期且本地不存在不能云端下载/预览/转发/保存。---按plan7.md的要求。6、plan6.md 的媒体队列来自当前会话消息列表；plan7.md 要求本地优先和后端鉴权。实现时不能只从 UI 消息列表拿 fileObjectId 播放，必须确保正式消息已有 MessageFileRef，尤其是刚上传完成、本地临时消息替换为服务端消息这一段。7、plan6.md 的媒体队列来自当前会话消息列表；plan7.md 要求本地优先和后端鉴权。实现时不能只从 UI 消息列表拿 fileObjectId 播放，必须确保正式消息已有 MessageFileRef，尤其是刚上传完成、本地临时消息替换为服务端消息这一段。---优先本地已保存，或本地上传，媒体队列还是来自当前会话消息列表。如果不能播放（本地没保存且过期）就显示不能播放，如果需要下载（例如已保存到网盘，就按照下载播放的流程来）8、plan6.md 允许点击视频打开时自动播放；plan7.md 要求本地优先顺序：本地原文件 → 本地下载 → 预览缓存 → 后端短期 URL。自动播放可以保留，但播放源必须按这个顺序解析。---对。


结论：**Codex 的分析大方向对，但你批注后的最终规则要再往前走一步：Media Viewer 不能直接拿 `url` 播放，而应该拿“媒体引用 + 来源信息”，再由一个统一的 `MediaAccessResolver` 决定播放源。**

也就是：

```text
plan6 负责：媒体统一浏览器的 UI/UX、窗口、队列、左右切换、工具栏。
plan7 负责：文件访问权、过期、下载、转发、保存、删除、鉴权。
```

如果冲突，一律按：

```text
plan7 的权限和生命周期 > plan6 的播放/下载/转发动作
```

因为 plan6 是“怎么看”，plan7 是“有没有资格看”。

---

# 一、先解释你没看懂的 `MediaItem.url`

plan6 里原来写了：

```ts
type MediaItem = {
  id: string;
  messageId: string;
  conversationId: string;
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
  previewUrl?: string;
};
```

这个 `url` 的作用是：**给 `<img>` 或 `<video>` 播放用的地址。**

例如：

```html
<img src="url" />
<video src="url" />
```

问题在于：如果开发人员把这个 `url` 理解成 OSS 永久地址，比如：

```text
https://oss.xxx.com/files/abc.mp4
```

那就危险了。

因为它会导致：

```text
1. 前端拿到了真实 OSS 地址。
2. 用户可能从浏览器开发者工具复制出来。
3. 文件即使聊天消息过期，旧 URL 可能还能访问。
4. 用户即使没有权限，也可能绕过后端直接访问 OSS。
5. 网盘删除、消息撤回、群权限变化，都无法立即控制这个 URL。
```

这和 plan7 冲突。plan7 明确要求：前端不能保存或拼接 OSS 永久地址，预览和下载必须由后端按来源鉴权后生成短期签名 URL。

所以 `url` 不是不能有，而是不能作为**长期字段**存在。

正确理解是：

```text
MediaItem 里不要放永久 url。
真正播放前，再解析出一个临时可用的播放地址。
```

这个临时播放地址只能是两种：

```text
1. 本地文件地址
   例如 local://... 或 file://...

2. 后端短期签名 URL
   有效期 5 - 30 分钟
```

---

# 二、我推荐的最终做法

把 plan6 的 `MediaItem.url` 改掉。

不要这样：

```ts
type MediaItem = {
  messageId: string;
  fileObjectId: string;
  url: string;
};
```

改成这样：

```ts
type MediaItem = {
  id: string;

  type: "image" | "video";

  conversationId?: string;
  messageId?: string;
  messageFileRefId?: string;

  fileObjectId: string;

  source:
    | "chat"
    | "personal_drive"
    | "group_drive"
    | "local_pending";

  sourceId: string;
  // chat: messageFileRefId
  // personal_drive: driveNodeId
  // group_drive: driveNodeId
  // local_pending: localTempId

  fileName?: string;
  fileSize?: number;

  width?: number;
  height?: number;
  duration?: number;

  thumbnailCacheKey?: string;

  senderId?: string;
  senderName?: string;

  sentAt?: string;
  seq?: number;

  localCandidates?: LocalCandidate[];
};
```

然后新增一个运行时解析结果：

```ts
type ResolvedMediaSource = {
  status:
    | "ready"
    | "expired"
    | "no_permission"
    | "deleted"
    | "blocked"
    | "not_uploaded"
    | "loading"
    | "failed";

  sourceType:
    | "local_original"
    | "local_download"
    | "local_preview_cache"
    | "signed_preview_url"
    | "signed_download_url"
    | "none";

  playableUrl?: string;

  expiresAt?: string;

  allowedActions: {
    preview: boolean;
    download: boolean;
    forward: boolean;
    saveToPersonalDrive: boolean;
    saveToGroupDrive: boolean;
    openLocal: boolean;
    openContainingFolder: boolean;
    reupload: boolean;
  };

  reasonText?: string;
};
```

这样 `MediaItem` 只是“这个媒体是谁”，`ResolvedMediaSource` 才是“现在能不能播放、用什么播放”。

---

# 三、最终优先级规则

## 1. plan6 保留

plan6 的这些内容继续有效：

```text
独立 Media Viewer 窗口
图片 / 视频统一浏览
按消息顺序左右切换
底部工具栏
快捷键
打开所在消息
复用同一个 media-viewer 窗口
```

plan6 已经明确要求图片和视频进入同一个独立 Media Viewer，并按当前会话消息顺序组成队列，这是正确的。

## 2. plan7 覆盖

plan7 覆盖这些规则：

```text
是否能预览
是否能下载
是否能转发
是否能保存到网盘
是否过期
是否需要鉴权
是否能访问 OSS
```

plan7 的核心是：每条聊天文件消息通过 `MessageFileRef` 获得独立 7 天云端访问权，网盘通过 `DriveNode` 长期引用，文件是否删除由 `FileReferenceLedger` 判断。

所以最终解释是：

```text
Media Viewer 负责体验。
MessageFileRef / DriveNode / FileReferenceLedger 负责资格。
```

---

# 四、Media Viewer 打开流程：工业级最终版

用户点击聊天里的图片或视频时，不要直接拿 `fileObjectId` 播放。

正确流程：

```text
用户点击图片 / 视频消息
↓
主窗口从当前会话构建 mediaList
↓
mediaList 只保存 messageId、messageFileRefId、fileObjectId、source，不保存永久 URL
↓
打开 Media Viewer
↓
Media Viewer 显示 loading
↓
MediaAccessResolver 解析当前媒体
↓
先查本地
↓
本地有 → 直接播放本地
↓
本地没有 → 按 source 去后端鉴权
↓
鉴权通过 → 后端返回短期签名 URL
↓
播放 / 预览
↓
鉴权失败 → 显示过期 / 无权限 / 已删除 / 被拦截
```

顺序必须是：

```text
本地原文件
↓
本地下载文件
↓
本地预览缓存
↓
后端短期 URL
```

这和你批注里的要求一致，也和 plan7 的“本地优先”一致。

---

# 五、媒体队列怎么处理？

你的判断对：**媒体队列仍然来自当前会话消息列表。**

但是队列里的每个 item 必须携带来源。

例如聊天消息来源：

```ts
{
  source: "chat",
  sourceId: "messageFileRefId",
  messageId: "msg_123",
  messageFileRefId: "mfr_456",
  fileObjectId: "file_789"
}
```

个人网盘来源：

```ts
{
  source: "personal_drive",
  sourceId: "driveNodeId",
  driveNodeId: "dn_123",
  fileObjectId: "file_789"
}
```

群网盘来源：

```ts
{
  source: "group_drive",
  sourceId: "groupDriveNodeId",
  driveNodeId: "gdn_123",
  fileObjectId: "file_789"
}
```

这样 Media Viewer 切换到某一项时，知道应该按哪种规则鉴权：

```text
chat → 查 MessageFileRef 是否过期
personal_drive → 查 DriveNode 是否属于当前用户
group_drive → 查用户是否仍在群、是否有群网盘权限
```

plan7 也已经明确：不同来源要走不同访问判断，聊天来源校验 `MessageFileRef`，个人网盘校验 `DriveNode`，群网盘校验群权限和 `DriveNode`。

---

# 六、过期但本地存在，怎么处理？

按你的批注，最终规则应该是：

```text
聊天消息过期，不代表本地不能播放。
```

所以：

## 情况 1：本地有

```text
打开 Media Viewer
↓
查到本地原文件 / 下载文件 / 预览缓存
↓
直接播放本地
```

工具栏显示：

```text
打开本地文件
打开所在文件夹
重新上传
复制文件名
查看详情
```

但不显示：

```text
云端下载
云端转发
保存到网盘
```

除非用户选择“重新上传”。

## 情况 2：本地没有，聊天消息过期

显示：

```text
文件已过期，无法播放或下载。
如果你曾经下载过，可以在本地文件夹中查找。
```

工具栏只保留：

```text
打开所在消息
复制文件名
查看详情
```

## 情况 3：本地没有，但该文件已经保存到我的网盘

这里建议做一个更好的 UX：

```text
这条聊天消息已过期，但你已将该文件保存到我的网盘。
[从我的网盘打开] [打开所在消息]
```

点击“从我的网盘打开”后，访问来源切换为：

```text
source = personal_drive
sourceId = driveNodeId
```

然后走网盘鉴权，不再检查聊天消息 7 天过期。

这点非常重要。
因为：

```text
聊天消息过期 ≠ 文件一定不能访问
```

如果用户自己保存过网盘，就应该允许从网盘入口继续访问。

---

# 七、Media Viewer 工具栏状态规则

plan6 说工具栏有下载、转发、存网盘。
plan7 要求按状态控制。
最终应该这样：

| 状态          | 预览     | 下载     | 转发          | 存我的网盘       | 存群网盘     | 本地打开     | 重新上传   |
| ----------- | ------ | ------ | ----------- | ----------- | -------- | -------- | ------ |
| 本地有文件       | 可以     | 不需要    | 需要重新上传或云端可用 | 需要云端可用或重新上传 | 同左       | 可以       | 可以     |
| 聊天未过期       | 可以     | 可以     | 可以          | 可以          | 有权限可用    | 如果本地有则可以 | 不需要    |
| 聊天已过期，本地没有  | 不可以    | 不可以    | 不可以         | 不可以         | 不可以      | 不可以      | 不可以    |
| 聊天已过期，本地有   | 可以播放本地 | 不显示云下载 | 不直接转发云端     | 不直接存云端      | 不直接存云端   | 可以       | 可以     |
| 我的网盘来源      | 可以     | 可以     | 可以          | 已在网盘中       | 可按权限存群网盘 | 如果本地有则可以 | 不需要    |
| 群网盘来源       | 可以     | 可以     | 可以          | 可以          | 已在群网盘中   | 如果本地有则可以 | 不需要    |
| 文件被删除       | 不可以    | 不可以    | 不可以         | 不可以         | 不可以      | 本地有则可打开  | 可重新上传  |
| 文件被 blocked | 不可以    | 不可以    | 不可以         | 不可以         | 不可以      | 不建议      | 不允许或警告 |

---

# 八、刚上传完成但还没正式消息，怎么处理？

这是你提到“视频能上传但不能预览/下载”的关键问题之一。

正确区分两个阶段：

## 阶段 A：本地临时消息

发送方刚选择视频：

```text
localTempMessage
fileObjectId 可能还没有
messageFileRefId 还没有
```

这时 Media Viewer 只能用：

```text
source = local_pending
```

播放源只能是本地原文件。

工具栏：

```text
播放本地
取消上传
查看上传进度
```

不能显示：

```text
下载
转发
保存到网盘
```

因为服务端正式文件还没生成。

## 阶段 B：服务端正式消息

上传完成后：

```text
FileObject available
Message 创建成功
MessageFileRef 创建成功
FileReferenceLedger 创建成功
```

客户端必须把本地临时消息替换成正式消息。

这时 MediaItem 才能拥有：

```text
messageId
messageFileRefId
fileObjectId
source = chat
```

此后才允许：

```text
云端预览
下载
转发
保存到网盘
```

plan7 已经强调发送文件消息必须事务写入 `Message + MessageFileRef + FileReferenceLedger`，转发和保存也必须基于引用而不是复制 OSS。

---

# 九、下载流程和预览流程要分开

不要让“下载”直接复用“预览 URL”。

建议后端提供两个动作：

```text
preview
download
```

例如：

```http
POST /media/access/resolve
```

请求：

```ts
type ResolveMediaAccessRequest = {
  action: "preview" | "download" | "forward" | "save_to_drive";

  source:
    | "chat"
    | "personal_drive"
    | "group_drive";

  sourceId: string;

  fileObjectId: string;
};
```

返回：

```ts
type ResolveMediaAccessResponse = {
  status:
    | "allowed"
    | "expired"
    | "no_permission"
    | "deleted"
    | "blocked";

  url?: string;
  urlExpiresAt?: string;

  fileName?: string;
  fileSize?: number;
  mimeType?: string;

  allowedActions: {
    preview: boolean;
    download: boolean;
    forward: boolean;
    saveToPersonalDrive: boolean;
    saveToGroupDrive: boolean;
  };

  fallback?: {
    hasLocal?: boolean;
    personalDriveNodeId?: string;
    groupDriveNodeId?: string;
  };

  message?: string;
};
```

这样 Media Viewer 不需要自己判断复杂权限，只需要展示后端返回的状态。

---

# 十、最终冲突解决方案

你可以把两个 plan 的关系写成这条最终规则：

```text
plan6 的 Media Viewer 继续作为统一图片/视频浏览器方案；
但 Media Viewer 不拥有文件权限，不保存永久 URL，不直接访问 OSS。
Media Viewer 只负责展示和交互。

所有媒体项必须携带 source + sourceId + fileObjectId。
播放前先走本地优先解析；
本地没有时，再按 source 向后端请求访问鉴权。
聊天来源按 MessageFileRef 判断 7 天访问权；
网盘来源按 DriveNode 判断长期访问权；
群网盘来源按群成员和 DriveNode 权限判断访问权。

如果鉴权通过，后端返回短期签名 URL；
如果鉴权失败，Media Viewer 显示过期、无权限、已删除或被拦截。
工具栏中的下载、转发、存网盘必须根据当前 item 的 resolved access state 动态启用或隐藏。
```

---

# 十一、给 Codex 的修正要求

你可以直接让 Codex 改成下面这套。

```text
请修正 Media Viewer 与文件生命周期规则的冲突。

最终优先级：
1. docs/plan7.md 负责文件生命周期、访问鉴权、下载、转发、保存网盘、过期、删除。
2. docs/plan6.md 负责 Media Viewer 独立窗口、图片/视频统一浏览、左右切换、工具栏、快捷键、视觉体验。
3. 如果两者冲突，文件访问类行为一律以 docs/plan7.md 为准。

具体修改：

一、修改 MediaItem 数据结构

不要在 MediaItem 中保存 OSS 永久 URL。
删除或废弃：
- url
- previewUrl 作为长期字段

改为：

type MediaItem = {
  id: string;
  type: "image" | "video";

  conversationId?: string;
  messageId?: string;
  messageFileRefId?: string;

  fileObjectId: string;

  source: "chat" | "personal_drive" | "group_drive" | "local_pending";
  sourceId: string;

  fileName?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  duration?: number;

  thumbnailCacheKey?: string;

  senderId?: string;
  senderName?: string;

  sentAt?: string;
  seq?: number;

  localCandidates?: LocalCandidate[];
};

二、新增 ResolvedMediaSource

type ResolvedMediaSource = {
  status:
    | "ready"
    | "expired"
    | "no_permission"
    | "deleted"
    | "blocked"
    | "not_uploaded"
    | "loading"
    | "failed";

  sourceType:
    | "local_original"
    | "local_download"
    | "local_preview_cache"
    | "signed_preview_url"
    | "signed_download_url"
    | "none";

  playableUrl?: string;
  expiresAt?: string;

  allowedActions: {
    preview: boolean;
    download: boolean;
    forward: boolean;
    saveToPersonalDrive: boolean;
    saveToGroupDrive: boolean;
    openLocal: boolean;
    openContainingFolder: boolean;
    reupload: boolean;
  };

  reasonText?: string;
};

三、新增 MediaAccessResolver

Media Viewer 切换到某个 item 时，统一调用 resolveMediaSource(item)。

resolveMediaSource 顺序：
1. 检查本地原文件。
2. 检查本地下载文件。
3. 检查本地预览缓存。
4. 如果本地可用，直接返回本地 playableUrl。
5. 如果本地不可用，并且 item.source = local_pending，返回 not_uploaded。
6. 如果本地不可用，并且 item.source = chat，调用后端校验 MessageFileRef。
7. 如果本地不可用，并且 item.source = personal_drive，调用后端校验 DriveNode。
8. 如果本地不可用，并且 item.source = group_drive，调用后端校验群网盘 DriveNode 和群权限。
9. 后端允许则返回短期签名 URL。
10. 后端拒绝则返回 expired / no_permission / deleted / blocked。

四、Media Viewer 的媒体队列仍来自当前会话消息列表

但是队列中的 item 必须包含：
- source
- sourceId
- messageFileRefId
- fileObjectId
- messageId
- conversationId

不能只包含 fileObjectId。

五、工具栏按 ResolvedMediaSource.allowedActions 动态显示

未过期聊天文件：
- 预览、下载、转发、存我的网盘、存群网盘按权限显示。

过期但本地存在：
- 可以打开本地文件。
- 可以打开所在文件夹。
- 可以重新上传。
- 不能云端下载、云端转发、云端存网盘。

过期且本地不存在：
- 显示“文件已过期，无法播放或下载”。
- 只保留打开所在消息、复制文件名、查看详情。

我的网盘来源：
- 不检查 MessageFileRef 7 天过期。
- 按 DriveNode 权限预览、下载、转发。

群网盘来源：
- 不检查 MessageFileRef 7 天过期。
- 按群成员和群网盘权限预览、下载、转发。

六、刚上传中的本地临时消息

当文件还没有生成正式 MessageFileRef 时：
- item.source = local_pending
- 只能播放本地原文件
- 不显示下载、转发、保存到网盘
- 上传完成后必须替换为正式 message + messageFileRef + fileObject

七、后端接口

新增：

POST /media/access/resolve

请求：
{
  action: "preview" | "download" | "forward" | "save_to_drive",
  source: "chat" | "personal_drive" | "group_drive",
  sourceId: string,
  fileObjectId: string
}

返回：
{
  status: "allowed" | "expired" | "no_permission" | "deleted" | "blocked",
  url?: string,
  urlExpiresAt?: string,
  allowedActions: {...},
  fallback?: {
    personalDriveNodeId?: string,
    groupDriveNodeId?: string
  },
  message?: string
}

八、验收标准

1. 前端代码中不能保存 OSS 永久 URL。
2. MediaItem 不再把 url 当作长期播放地址。
3. 点击聊天视频时，先查本地，再查 MessageFileRef。
4. 聊天文件过期但本地存在，可以播放本地。
5. 聊天文件过期且本地不存在，不能播放、下载、转发、存网盘。
6. 已保存到我的网盘的文件，可以通过 DriveNode 继续打开。
7. 从网盘打开的媒体不受聊天 MessageFileRef 7 天过期影响。
8. Media Viewer 队列仍按当前会话消息顺序左右切换。
9. 切换到某个已过期 item 时，不退出 Viewer，只在当前页显示过期状态。
10. 上传中的本地临时视频可以本地预览，但不能下载、转发、存网盘。
```

---

# 十二、最终一句话

**plan6 的 Media Viewer 是外壳和体验；plan7 的 MessageFileRef / DriveNode / FileReferenceLedger 是访问资格和生命周期。Media Viewer 可以按会话顺序浏览图片和视频，但每个媒体项都必须携带来源信息，播放前先查本地，本地没有再由后端按来源鉴权并返回短期 URL。前端永远不能保存 OSS 永久地址，工具栏动作必须根据当前媒体的真实访问状态动态变化。**
