# 教师助手 IM：消息分类、文件保存、转发、网盘与云端删除生命周期完整规则【工业级最优解版】

## 0. 总体设计结论

教师助手 IM 的消息与文件系统必须采用“消息记录、云文件对象、访问引用、长期资产、物理存储”分层设计。

最终架构不是简单地给每个云文件设置一个过期时间，也不是给每个文件创建一个定时任务，而是采用：

```text
消息层：Message
文件业务层：FileObject
物理存储层：FileBlob
访问引用层：FileReferenceLedger
聊天引用层：MessageFileRef
网盘引用层：DriveNode
表情资产层：StickerAsset
传输任务层：FileTransferTask
本地缓存层：LocalFileCache
后台清理层：FileGC
```

核心原则：

```text
文本是聊天记录，不是文件。
emoji 是文本内容或系统资源，不是用户文件。
系统表情只发资源 ID。
用户自定义表情是长期表情资产。
图片、视频、音频文件、文档、压缩包、普通文件是聊天文件。
聊天文件默认临时云端保存 7 天。
每一条聊天文件消息都有自己的云端访问有效期。
转发只创建新的聊天文件引用，不重新上传，不刷新旧消息。
保存到我的网盘或群网盘只创建长期引用，不复制 OSS 文件。
下载才在当前设备生成本地文件。
文件存在不等于某条消息仍然有访问权。
某条消息过期也不代表文件一定已经被删除。
云文件是否删除，由统一的 FileReferenceLedger 引用账本决定。
```

---

# 一、为什么要重构成工业级模型

之前的模型已经正确区分了：

```text
message_file：聊天消息引用
drive_node：网盘长期引用
sticker_asset：表情资产引用
file_object：云端业务文件
file_blob：OSS 物理文件
```

但如果后台删除时每次都分别查询：

```text
查 message_file
查 drive_node
查 sticker_asset
查 transfer_task
查安全保留
查风控保留
```

随着业务变复杂，会出现以下问题：

```text
1. 删除逻辑分散，容易漏判断。
2. 新增一种引用类型时，GC 逻辑必须改代码。
3. 高并发下容易误删。
4. 多表 join 成本越来越高。
5. 难以排查某个文件为什么不能删除。
6. 难以统计文件真实引用来源。
```

因此工业级最优解是增加一张统一的“文件引用账本”：

```text
file_reference_ledger
```

所有会让文件继续存在的原因，都必须在这张表里登记。

包括：

```text
聊天临时引用
个人网盘引用
群网盘引用
用户自定义表情引用
上传 / 转码 / 下载任务引用
安全扫描引用
系统保留引用
风控保留引用
人工保留引用
```

这样删除逻辑从“到处查表”变成：

```text
只要 file_reference_ledger 中还有 active 引用，文件就不能删。
```

---

# 二、核心对象模型

## 1. Message：聊天消息主表

所有聊天内容都必须有一条 `message` 记录。

```ts
type Message = {
  id: string;

  conversationId: string;
  senderUserId: string;

  messageType:
    | "text"
    | "emoji"
    | "sticker"
    | "image"
    | "video"
    | "audio"
    | "voice"
    | "file"
    | "drive_share"
    | "system"
    | "call_event";

  content: object;

  sendStatus:
    | "local_sending"
    | "server_received"
    | "delivered"
    | "failed";

  visibilityStatus:
    | "normal"
    | "revoked"
    | "deleted_for_me"
    | "deleted_by_admin";

  createdAt: string;
  updatedAt?: string;
  revokedAt?: string;
  deletedAt?: string;
};
```

说明：

```text
Message 只表示聊天记录。
Message 不等于文件。
Message 不直接保存 OSS 地址。
文件类消息必须通过 MessageFileRef 引用 FileObject。
```

---

## 2. FileBlob：真实物理文件

`file_blob` 表示 OSS 中真实保存的物理文件。

同一份物理文件可以只保存一份。

```ts
type FileBlob = {
  id: string;

  sha256: string;
  size: number;
  mimeType: string;
  ext: string;

  objectKey: string;
  storageProvider: "oss";

  storageClass:
    | "standard"
    | "infrequent_access"
    | "archive";

  status:
    | "available"
    | "pending_delete"
    | "deleted"
    | "blocked";

  createdAt: string;
  deletedAt?: string;
};
```

注意：

```text
FileBlob 是物理层。
业务权限不挂在 FileBlob 上。
前端不直接感知 FileBlob。
```

---

## 3. FileObject：云端业务文件对象

`file_object` 是聊天、网盘、群网盘、表情、转发共同引用的业务文件。

```ts
type FileObject = {
  id: string;
  blobId: string;

  createdByUserId: string;
  tenantId?: string;

  fileName: string;
  fileSize: number;
  mimeType: string;
  ext: string;

  fileCategory:
    | "image"
    | "video"
    | "audio"
    | "document"
    | "archive"
    | "other";

  thumbnailObjectKey?: string;
  previewObjectKey?: string;

  duration?: number;
  width?: number;
  height?: number;

  status:
    | "uploading"
    | "processing"
    | "available"
    | "pending_delete"
    | "deleted"
    | "blocked";

  safetyStatus:
    | "pending"
    | "passed"
    | "blocked"
    | "manual_review";

  // GC 聚合字段，只是性能优化，不是唯一真相
  activeRefCount: number;
  activeLongRefCount: number;
  activeTempRefCount: number;
  activeTaskRefCount: number;

  latestTempExpireAt?: string;
  gcCandidateAt?: string;

  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
```

核心原则：

```text
FileObject 不等于聊天消息。
FileObject 不等于网盘文件。
FileObject 是业务云文件。
FileObject 不能简单设置一个统一 expireAt。
```

原因：

```text
同一个 FileObject 可能被多条聊天消息引用。
每条聊天消息有自己的 7 天访问有效期。
新转发消息不能刷新旧消息的有效期。
```

---

## 4. FileReferenceLedger：统一文件引用账本

这是工业级最关键的表。

任何会让文件继续存在的业务原因，都必须在这里登记。

```ts
type FileReferenceLedger = {
  id: string;

  fileObjectId: string;

  refType:
    | "chat_temp"
    | "personal_drive"
    | "group_drive"
    | "sticker_asset"
    | "voice_message"
    | "transfer_task"
    | "processing_task"
    | "security_hold"
    | "legal_hold"
    | "system_hold";

  refSourceTable:
    | "message_file_ref"
    | "drive_node"
    | "sticker_asset"
    | "voice_message"
    | "file_transfer_task"
    | "file_processing_task"
    | "system";

  refSourceId: string;

  retentionClass:
    | "temporary"
    | "long_term"
    | "task"
    | "hold";

  ownerType:
    | "user"
    | "group"
    | "conversation"
    | "system";

  ownerId?: string;

  expireAt?: string;

  status:
    | "active"
    | "expired"
    | "released"
    | "deleted"
    | "blocked";

  createdAt: string;
  releasedAt?: string;
  expiredAt?: string;
};
```

解释：

```text
chat_temp：聊天文件临时引用，通常 7 天。
personal_drive：我的网盘长期引用。
group_drive：群网盘长期引用。
sticker_asset：用户自定义表情长期引用。
voice_message：语音消息媒体引用。
transfer_task：上传、下载、合并分片任务引用。
processing_task：封面生成、转码、安全扫描等处理引用。
security_hold：安全扫描或风控保留。
legal_hold：合规或人工保留。
system_hold：系统级保留。
```

删除判断的最终标准：

```text
只要 FileReferenceLedger 中还有 active 引用，FileObject 就不能物理删除。
```

---

## 5. MessageFileRef：聊天文件消息引用

`message_file_ref` 表示某一条聊天消息对某个 `file_object` 的访问凭证。

```ts
type MessageFileRef = {
  id: string;

  messageId: string;
  conversationId: string;
  fileObjectId: string;

  senderUserId: string;

  sourceType:
    | "local_upload"
    | "forward"
    | "personal_drive_forward"
    | "group_drive_forward"
    | "temp_sticker";

  expireAt: string;

  accessStatus:
    | "active"
    | "expired"
    | "revoked"
    | "deleted"
    | "blocked";

  createdAt: string;
};
```

创建 `message_file_ref` 时，必须同步创建一条：

```text
file_reference_ledger.refType = chat_temp
file_reference_ledger.retentionClass = temporary
file_reference_ledger.expireAt = message_file_ref.expireAt
```

核心规则：

```text
MessageFileRef 控制“这条消息能不能访问云文件”。
FileObject 控制“云文件业务对象是否存在”。
FileBlob 控制“OSS 中物理文件是否存在”。
三者不能混为一谈。
```

---

## 6. DriveNode：我的网盘 / 群网盘节点

```ts
type DriveNode = {
  id: string;

  driveType: "personal" | "group";

  ownerUserId?: string;
  groupId?: string;

  parentId?: string;

  type: "folder" | "file";
  name: string;

  fileObjectId?: string;

  createdBy: string;

  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
```

创建个人网盘文件时，必须同步创建：

```text
file_reference_ledger.refType = personal_drive
file_reference_ledger.retentionClass = long_term
```

创建群网盘文件时，必须同步创建：

```text
file_reference_ledger.refType = group_drive
file_reference_ledger.retentionClass = long_term
```

删除网盘文件时：

```text
删除 drive_node
释放对应 file_reference_ledger
不直接删除 file_object
不直接删除 OSS 文件
```

---

## 7. StickerAsset：用户自定义表情资产

```ts
type StickerAsset = {
  id: string;

  ownerUserId: string;
  fileObjectId: string;

  name?: string;

  stickerType:
    | "image"
    | "gif"
    | "webp";

  createdAt: string;
  deletedAt?: string;
};
```

创建用户自定义表情时，必须同步创建：

```text
file_reference_ledger.refType = sticker_asset
file_reference_ledger.retentionClass = long_term
```

只要表情资产存在，文件长期保留。

---

## 8. FileTransferTask：上传 / 下载 / 分片任务

```ts
type FileTransferTask = {
  id: string;

  fileObjectId?: string;
  blobId?: string;

  direction:
    | "upload"
    | "download";

  taskType:
    | "single_upload"
    | "multipart_upload"
    | "download"
    | "resume_upload"
    | "resume_download";

  status:
    | "waiting"
    | "running"
    | "paused"
    | "failed"
    | "completed"
    | "canceled";

  totalBytes: number;
  transferredBytes: number;

  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
```

上传、合并、下载、转码、安全扫描过程中，如果文件不能被删除，必须创建：

```text
file_reference_ledger.refType = transfer_task 或 processing_task
file_reference_ledger.retentionClass = task
```

任务完成或取消后，释放该引用。

---

## 9. LocalFileCache：本地文件索引

```ts
type LocalFileCache = {
  id: string;

  userId: string;
  deviceId: string;

  fileObjectId: string;

  localPath: string;

  source:
    | "send_original"
    | "download"
    | "preview_cache"
    | "voice_cache"
    | "sticker_cache";

  sha256?: string;
  fileSize: number;

  lastAccessedAt: string;
  createdAt: string;
};
```

本地文件规则：

```text
本地文件不由服务器控制。
本地文件路径可能失效。
播放或打开前必须检查文件是否仍存在、大小是否一致、必要时校验 hash。
```

---

# 三、消息分类总规则

## 1. 不走文件生命周期的消息

```text
普通文本消息
Unicode emoji
系统内置表情
系统消息
通话事件消息
```

这些消息：

```text
不进入 OSS。
不生成 FileBlob。
不生成 FileObject。
不生成 MessageFileRef。
不进入 FileReferenceLedger。
不支持保存到网盘。
不受 7 天聊天文件有效期影响。
```

---

## 2. 走聊天文件生命周期的消息

```text
图片
视频
音频文件
PDF
Word
PPT
Excel
TXT
Markdown
压缩包
普通文件
临时发送的 GIF / 图片表情
```

这些消息：

```text
上传到 OSS。
生成 FileBlob。
生成 FileObject。
生成 Message。
生成 MessageFileRef。
生成 FileReferenceLedger 临时引用。
默认 7 天聊天临时访问期。
可下载。
可转发。
可保存到我的网盘。
可保存到群网盘。
```

---

## 3. 走长期资产生命周期的内容

```text
用户自定义表情
我的网盘文件
群网盘文件
```

这些内容：

```text
生成 FileObject。
生成长期业务节点。
生成 FileReferenceLedger 长期引用。
不受聊天消息 7 天有效期影响。
直到用户删除对应资产或管理员删除对应资产。
```

---

## 4. 语音消息

语音消息不作为普通文件卡片处理。

语音消息属于聊天记录型媒体。

推荐规则：

```text
语音消息可存 OSS。
可生成 FileObject。
可生成 voice_message 业务记录。
可生成 FileReferenceLedger 引用。
不默认进入文件传输管理。
不默认支持保存到网盘。
不按普通聊天文件 7 天过期处理。
云端保存策略跟随聊天记录漫游策略或单独语音媒体策略。
```

建议：

```text
普通语音消息默认随聊天记录可播放。
如果要节省成本，可以配置 30 天 / 90 天语音媒体云端保留期。
但不要和“聊天文件 7 天临时下载”混在一起。
```

---

# 四、普通文本消息生命周期

文本消息直接存储在 `message.content` 中。

```ts
type TextMessageContent = {
  text: string;
};
```

规则：

```text
文本消息长期作为聊天记录保存。
不生成文件对象。
不占用 OSS。
不支持保存到网盘。
删除文本消息只影响消息可见性，不涉及文件清理。
```

用户删除文本消息：

```text
删除自己的记录：只对自己不可见。
撤回消息：按撤回规则展示。
管理员删除：群内不可见。
```

---

# 五、Emoji 与表情生命周期

## 1. Unicode Emoji

例如：

```text
😊 😂 ❤️ 👍
```

本质是文本内容。

规则：

```text
可合并在 text 消息中。
也可单独作为 emoji 消息。
不进入 OSS。
不生成文件对象。
不支持下载。
不支持存入网盘。
```

---

## 2. 系统内置表情

系统内置表情只发送资源 ID。

```ts
type BuiltInStickerMessageContent = {
  stickerId: string;
  stickerPackId: string;
};
```

规则：

```text
不上传用户文件。
不生成用户 FileObject。
不占用户网盘。
不受聊天文件 7 天有效期影响。
资源由系统公共资源管理。
```

---

## 3. 用户自定义表情

用户添加到“我的表情”的图片、GIF、WebP 属于长期表情资产。

流程：

```text
添加到我的表情
↓
上传到 OSS
↓
生成 FileBlob
↓
生成 FileObject
↓
生成 StickerAsset
↓
生成 FileReferenceLedger 长期引用
```

发送时：

```text
发送 StickerAsset 引用。
不重新上传。
不复制 OSS 文件。
```

删除时：

```text
用户从我的表情删除
↓
StickerAsset.deletedAt = now
↓
释放 file_reference_ledger 中 sticker_asset 引用
↓
后台 GC 重新判断 FileObject 是否还能删除
```

---

## 4. 临时 GIF / 图片表情

如果用户只是拖入一张 GIF 或图片当表情发出，没有添加到“我的表情”，则按聊天图片文件处理。

规则：

```text
生成 FileObject。
生成 MessageFileRef。
生成 chat_temp 引用。
默认 7 天临时访问期。
可转发、下载、保存到网盘。
过期后如果本地没有，则不能再打开。
```

---

# 六、图片消息生命周期

图片消息属于聊天文件。

发送流程：

```text
选择图片
↓
客户端生成本地预览卡片
↓
上传原图到 OSS
↓
生成 FileBlob
↓
生成 FileObject
↓
生成缩略图
↓
生成 Message
↓
生成 MessageFileRef
↓
生成 FileReferenceLedger chat_temp 引用
↓
消息发送成功
```

默认有效期：

```text
MessageFileRef.expireAt = createdAt + 7 天
```

打开图片时：

```text
先查本地原图。
再查本地下载文件。
再查本地预览缓存。
本地没有，再请求服务端检查 MessageFileRef 是否有效。
有效则生成短期预览 URL。
无效则显示图片已过期。
```

---

# 七、视频消息生命周期

视频消息属于聊天文件，但前端必须是独立视频卡片。

支持：

```text
封面图
播放按钮
时长
大小
上传进度
内置播放器
下载
转发
保存到我的网盘
保存到群网盘
```

发送流程：

```text
选择视频
↓
客户端生成本地视频卡片
↓
上传视频到 OSS
↓
生成 FileBlob
↓
生成 FileObject
↓
生成视频封面、时长、分辨率
↓
生成 Message
↓
生成 MessageFileRef
↓
生成 FileReferenceLedger chat_temp 引用
↓
消息发送成功
```

点击视频时：

```text
先查本地原始视频。
再查本地下载视频。
再查本地预览缓存。
本地有则用内置播放器播放本地文件。
本地没有则检查 MessageFileRef 是否有效。
有效则生成短期播放 URL。
过期则显示文件已过期，无法播放或下载。
```

如果发送方本地仍有原文件：

```text
云端文件已过期，但本地文件仍可播放。
是否重新上传？
```

重新上传：

```text
生成新的 FileObject。
生成新的 MessageFileRef。
不复活旧消息。
```

---

# 八、音频文件与语音消息

## 1. 音频文件

例如：

```text
mp3
wav
m4a
aac
flac
```

按普通文件处理。

规则：

```text
生成 FileObject。
生成 MessageFileRef。
生成 chat_temp 引用。
默认 7 天临时访问期。
可播放。
可下载。
可转发。
可保存到我的网盘。
可保存到群网盘。
```

---

## 2. 语音消息

例如按住说话生成的语音。

建议单独类型：

```ts
type VoiceMessageContent = {
  voiceMessageId: string;
  duration: number;
  waveform?: number[];
};
```

语音消息规则：

```text
语音消息是聊天记录型媒体，不是普通文件传输。
不展示普通文件卡片。
不进入当前会话传输列表。
不默认支持保存到网盘。
不默认显示“另存为”。
可播放、可转发、可撤回。
```

底层可使用 FileObject，但生命周期由语音策略控制。

推荐策略：

```text
普通语音默认随聊天记录漫游保存。
如需节省成本，可配置 30 天或 90 天云端媒体保留。
但不要按普通文件 7 天过期处理。
```

---

# 九、文档、压缩包、普通文件生命周期

## 1. 文档类

包括：

```text
PDF
Word
PPT
Excel
TXT
Markdown
```

统一按聊天文件处理。

规则：

```text
上传到 OSS。
生成 FileObject。
生成 MessageFileRef。
生成 chat_temp 引用。
默认 7 天临时访问期。
可下载、另存为、转发、保存到网盘。
```

预览建议：

```text
PDF：支持内置预览。
TXT / Markdown：支持文本预览。
Word / PPT / Excel：第一版可下载或调用系统打开，后续支持在线预览。
```

---

## 2. 压缩包

包括：

```text
zip
rar
7z
tar
gz
```

规则：

```text
不做在线预览。
显示文件卡片。
可下载、另存为、转发、保存到网盘。
默认 7 天临时访问期。
```

---

## 3. 普通文件

包括无法识别或不适合预览的文件。

例如：

```text
exe
apk
dmg
psd
ai
sketch
bin
dat
unknown
```

规则：

```text
上传到 OSS。
生成 FileObject。
生成 MessageFileRef。
生成 chat_temp 引用。
默认 7 天临时访问期。
不做预览。
可下载、另存为、转发、保存到网盘。
```

安全规则：

```text
高风险文件必须安全扫描。
可执行文件下载前提示风险。
被拦截文件 FileObject.status = blocked。
blocked 文件不能预览、下载、转发、保存到网盘。
```

---

# 十、小文件、大文件、超大文件

小文件和大文件只区别传输体验，不区别生命周期。

推荐阈值：

```text
小文件：< 100MB
大文件：≥ 100MB
超大文件：≥ 1GB
```

## 1. 小文件

```text
选择后直接发送。
无需确认弹窗。
聊天区显示上传进度。
上传完成后生成 FileObject 和 MessageFileRef。
默认 7 天临时访问期。
```

## 2. 大文件

```text
发送前轻确认。
必须支持分片上传。
必须支持断点续传。
必须支持暂停 / 继续。
必须支持失败重试。
必须进入当前会话“传输”管理。
```

发送弹窗：

```text
发送大文件

实验演示视频.mp4
1.2 GB

发送到：某某老师

[取消] [发送]

□ 同时存入我的网盘
```

群聊中，如果有权限：

```text
□ 同时存入群网盘
```

默认不勾选，避免污染网盘。

---

# 十一、聊天文件 7 天临时访问规则

适用范围：

```text
图片
视频
音频文件
PDF
Word
PPT
Excel
压缩包
普通文件
临时 GIF / 图片表情
```

规则：

```text
MessageFileRef.expireAt = MessageFileRef.createdAt + 7 天
```

注意：

```text
7 天是这条聊天文件消息的云端访问有效期。
不是 FileObject 的统一有效期。
不是 FileBlob 的统一有效期。
```

同一个 FileObject 可以被多条 MessageFileRef 引用。

示例：

```text
第 1 天：A 发给 B，生成 ref_1，expireAt = 第 8 天。
第 5 天：B 转发给 C，生成 ref_2，expireAt = 第 12 天。
第 9 天：A/B 原始消息已过期，不能从云端下载。
第 9 天：C 的转发消息仍有效，可以下载。
```

结论：

```text
转发可以让云文件因为新引用继续存在。
但转发不能刷新旧消息的访问权。
```

---

# 十二、转发规则

## 1. 聊天文件转发

转发前检查：

```text
当前用户是否有访问原消息的权限。
原 MessageFileRef 是否未过期。
FileObject 是否 available。
安全状态是否允许转发。
```

转发时：

```text
不重新上传。
不复制 OSS 文件。
创建新的 Message。
创建新的 MessageFileRef。
创建新的 FileReferenceLedger chat_temp 引用。
新消息获得新的 7 天访问期。
```

---

## 2. 过期文件转发

如果原消息已经过期：

```text
不能直接转发云文件。
```

如果本地仍有文件：

```text
可提示：云端文件已过期，但本地文件仍存在，是否重新上传后发送？
```

重新上传后：

```text
生成新的 FileObject。
生成新的 MessageFileRef。
不复活旧消息。
```

---

# 十三、从我的网盘转发到聊天

从我的网盘转发文件时：

```text
检查 personal drive_node 是否存在。
检查当前用户是否拥有该 drive_node。
检查 FileObject 是否 available。
```

转发行为：

```text
不重新上传。
不复制 OSS 文件。
创建新的 Message。
创建新的 MessageFileRef。
创建新的 chat_temp 引用。
目标会话获得 7 天临时访问期。
```

注意：

```text
发送方网盘长期保存，不代表接收方聊天消息永久可下载。
接收方如需长期保存，需要自己保存到我的网盘。
```

---

# 十四、从群网盘转发到聊天

从群网盘转发时：

```text
检查 group drive_node 是否存在。
检查当前用户是否仍在该群。
检查用户是否有群网盘访问 / 转发权限。
检查 FileObject 是否 available。
```

转发到其他会话：

```text
创建新的 MessageFileRef。
目标会话获得 7 天临时访问期。
不自动获得群网盘长期权限。
```

转发到原群聊：

```text
可显示“来自群网盘”。
只要群网盘节点存在且用户有权限，群成员可长期从群网盘访问。
聊天消息本身仍可拥有自己的临时引用。
```

---

# 十五、保存到我的网盘

用户在聊天文件消息中右键：

```text
保存到我的网盘
```

后端必须检查：

```text
MessageFileRef 是否存在。
当前用户是否有该消息访问权。
FileObject 是否 available。
文件是否未被 blocked。
```

保存行为：

```text
不复制 OSS 文件。
不保存固定下载链接。
不重新上传。
创建 personal DriveNode。
创建 FileReferenceLedger personal_drive 长期引用。
```

重复保存规则：

```text
同一目录同名文件可提示已存在。
允许另存为新节点。
多个 DriveNode 可以引用同一个 FileObject。
不复制物理文件。
```

---

# 十六、保存到群网盘

群聊中，群主或管理员可将聊天文件保存到群网盘。

后端检查：

```text
当前用户是否是群主 / 管理员，或群设置允许上传。
MessageFileRef 是否有效。
FileObject 是否 available。
文件是否未被 blocked。
```

保存行为：

```text
不复制 OSS 文件。
不重新上传。
创建 group DriveNode。
创建 FileReferenceLedger group_drive 长期引用。
```

只要 group DriveNode 存在：

```text
FileObject 长期保留。
群成员能否预览、下载、转发，由群网盘权限决定。
```

---

# 十七、下载与本地文件

下载才会在当前设备生成本地文件。

以下都不是下载：

```text
转发不是下载。
保存到我的网盘不是下载。
保存到群网盘不是下载。
添加到我的表情不是下载。
```

下载流程：

```text
用户点击下载 / 另存为
↓
后端按来源校验访问权
↓
生成短期签名下载 URL
↓
客户端下载文件
↓
写入本地目标目录
↓
记录 LocalFileCache
```

本地文件来源：

```text
send_original：发送方原始文件
download：用户主动下载
preview_cache：预览缓存
voice_cache：语音缓存
sticker_cache：表情缓存
```

---

# 十八、本地优先打开规则

所有可打开或可预览文件，都采用本地优先。

顺序：

```text
1. 查发送原始文件
2. 查用户主动下载文件
3. 查预览缓存
4. 本地文件存在且可读 → 打开本地
5. 本地不存在 → 请求后端校验云端访问权
6. 校验通过 → 获取短期预览 / 下载 URL
7. 校验失败 → 显示过期、无权限或文件不可用
```

本地文件校验：

```text
必须检查路径是否存在。
必须检查文件大小。
必要时检查 hash。
不能只相信 LocalFileCache 记录。
```

---

# 十九、过期后的聊天文件表现

当 MessageFileRef 过期后：

```text
聊天消息卡片仍保留。
文件名仍显示。
文件大小仍显示。
文件类型仍显示。
缩略图可显示缓存或灰色占位。
不能从云端预览。
不能从云端下载。
不能从云端转发。
不能保存到网盘。
```

右键菜单：

```text
复制文件名
查看详情
删除
```

如果本地文件仍存在：

```text
打开本地文件
打开所在文件夹
重新上传
复制文件名
删除
```

提示文案：

```text
文件已过期，无法播放或下载。
如果你曾经下载过，可以在本地文件夹中查找。
```

---

# 二十、访问权限规则

所有云文件访问必须通过后端鉴权。

禁止：

```text
把 OSS 永久地址写进 message.content。
把 OSS 永久地址写进 drive_node。
把下载链接当成网盘保存内容。
前端直接拼 OSS 地址。
```

正确流程：

```text
前端请求预览 / 下载
↓
后端根据访问来源校验权限
↓
校验 FileObject 状态
↓
校验安全状态
↓
生成短期签名 URL
↓
返回前端
```

短期 URL 建议：

```text
预览 URL：5 - 30 分钟有效
下载 URL：5 - 30 分钟有效
```

---

# 二十一、不同来源的访问判断

## 1. 从聊天消息访问

必须校验：

```text
MessageFileRef 是否存在。
MessageFileRef 是否属于该 Message。
当前用户是否是该 Conversation 成员。
MessageFileRef 是否未过期。
Message 是否未被撤回或管理员删除。
FileObject 是否 available。
SafetyStatus 是否 passed。
```

---

## 2. 从我的网盘访问

必须校验：

```text
DriveNode 是否存在。
DriveNode.ownerUserId 是否是当前用户。
DriveNode.deletedAt 是否为空。
FileObject 是否 available。
SafetyStatus 是否 passed。
```

不检查 MessageFileRef.expireAt。

---

## 3. 从群网盘访问

必须校验：

```text
Group DriveNode 是否存在。
当前用户是否仍在该群。
用户是否有群网盘访问权限。
DriveNode.deletedAt 是否为空。
FileObject 是否 available。
SafetyStatus 是否 passed。
```

不检查 MessageFileRef.expireAt。

---

## 4. 从自定义表情访问

必须校验：

```text
StickerAsset 是否存在。
StickerAsset.ownerUserId 是否是当前用户。
StickerAsset.deletedAt 是否为空。
FileObject 是否 available。
```

不检查 MessageFileRef.expireAt。

---

# 二十二、删除消息规则

## 1. 删除自己的聊天记录

```text
只影响当前用户可见性。
不删除对方消息。
不释放其他用户引用。
不直接删除 FileObject。
不直接删除 OSS 文件。
```

## 2. 撤回消息

撤回后：

```text
消息显示“已撤回”。
如果文件还没上传完成，可以取消上传任务。
如果文件已经上传完成，不立即删除 FileObject。
```

需要释放：

```text
该消息对应的 MessageFileRef。
该消息对应的 FileReferenceLedger chat_temp 引用。
```

然后由 GC 判断文件是否可删除。

## 3. 管理员删除群消息

管理员删除群消息后：

```text
群内消息不可见。
对应 MessageFileRef 标记 deleted。
释放对应 chat_temp 引用。
不自动删除已保存到群网盘的文件。
不影响其他会话中的转发文件。
```

---

# 二十三、网盘删除规则

用户从我的网盘删除文件：

```text
DriveNode.deletedAt = now。
释放对应 personal_drive 引用。
不直接删除 FileObject。
不直接删除 OSS 文件。
```

群主 / 管理员从群网盘删除文件：

```text
Group DriveNode.deletedAt = now。
释放对应 group_drive 引用。
不直接删除 FileObject。
不直接删除 OSS 文件。
```

文件是否最终删除，由 FileGC 统一判断。

---

# 二十四、云文件删除规则

云文件不能简单按 FileBlob.refCount 删除。

真正删除条件：

```text
FileReferenceLedger 中不存在任何 active 引用。
FileObject 没有活跃上传、下载、转码、扫描任务。
FileObject 没有 legal_hold、security_hold、system_hold。
FileObject.status = available 或 pending_delete。
```

满足条件后：

```text
进入 pending_delete。
延迟二次确认。
删除 OSS 物理文件。
更新 FileBlob.status = deleted。
更新 FileObject.status = deleted。
```

---

# 二十五、工业级 GC 清理机制

## 1. 不允许的做法

禁止：

```text
每个文件一个定时器。
每个文件一个独立延迟任务。
每秒扫描全表。
直接依赖 OSS 生命周期删除业务文件。
只靠 FileObject.expireAt 删除。
只靠 FileBlob.refCount 删除。
```

---

## 2. 正确做法

采用：

```text
数据库 expireAt 字段
索引
批量扫描
引用账本
异步队列
两阶段删除
定期校准
```

---

## 3. 过期引用扫描

索引：

```sql
CREATE INDEX idx_file_ref_expire
ON file_reference_ledger (status, retention_class, expire_at);
```

批量扫描：

```sql
SELECT id
FROM file_reference_ledger
WHERE status = 'active'
  AND retention_class = 'temporary'
  AND expire_at < NOW()
LIMIT 1000;
```

处理：

```text
将过期临时引用标记为 expired。
同步更新 MessageFileRef.accessStatus = expired。
将相关 FileObject 放入 GC 候选队列。
```

---

## 4. GC 候选处理

每次引用释放或过期后，不立即删除文件，而是将 `fileObjectId` 放入 GC 候选队列。

GC Worker 处理：

```text
获取 fileObjectId。
加分布式锁。
重新查询 FileReferenceLedger。
确认没有 active 引用。
确认没有活跃任务。
确认没有安全 / 合规保留。
标记 FileObject.status = pending_delete。
设置 gcCandidateAt = now。
```

---

## 5. 两阶段删除

第一阶段：

```text
FileObject.status = pending_delete。
FileBlob.status = pending_delete。
不立即删除 OSS。
```

第二阶段，延迟 24 - 72 小时后二次确认：

```text
再次检查 FileReferenceLedger 是否仍无 active 引用。
再次检查没有活跃任务。
确认没有安全保留。
```

如果仍可删除：

```text
删除 OSS object。
FileBlob.status = deleted。
FileObject.status = deleted。
记录 deletedAt。
```

如果期间出现新引用：

```text
取消 pending_delete。
恢复 FileObject.status = available。
```

---

## 6. 引用计数优化

`FileObject` 上可以维护聚合字段：

```text
activeRefCount
activeLongRefCount
activeTempRefCount
activeTaskRefCount
latestTempExpireAt
gcCandidateAt
```

但这些字段只是性能优化，不是唯一真相。

真正删除前必须重新查询：

```text
FileReferenceLedger 中是否还有 active 引用。
```

---

## 7. 定期校准

每天凌晨执行一次引用校准任务。

校准内容：

```text
统计 FileReferenceLedger 中各 fileObjectId 的 active 引用数。
回写 FileObject 聚合字段。
检查聚合字段和真实引用是否不一致。
发现不一致则修复并记录告警。
```

这样可以防止：

```text
并发写入失败。
事务中断。
重复释放引用。
引用计数不一致。
```

---

# 二十六、事务与并发规则

涉及以下操作必须使用数据库事务：

```text
发送文件消息：Message + MessageFileRef + FileReferenceLedger。
保存到网盘：DriveNode + FileReferenceLedger。
保存到群网盘：DriveNode + FileReferenceLedger。
添加自定义表情：StickerAsset + FileReferenceLedger。
删除网盘文件：DriveNode.deletedAt + Ledger.release。
撤回文件消息：Message 状态 + MessageFileRef 状态 + Ledger.release。
```

推荐使用 Outbox Pattern：

```text
数据库事务内写业务表和 outbox_event。
事务提交后由异步 worker 处理 OSS、转码、封面、安全扫描、GC 队列。
```

避免：

```text
数据库写成功，但异步任务丢失。
OSS 删除成功，但数据库没更新。
消息发出，但文件引用没登记。
```

---

# 二十七、OSS 生命周期使用边界

OSS 生命周期可以用，但不能作为业务生命周期主逻辑。

可用于：

```text
清理未完成的 multipart 分片。
清理临时上传目录。
清理 pending_delete 已确认删除目录。
清理缩略图临时文件。
```

不可用于：

```text
直接删除聊天文件。
直接删除网盘文件。
决定某条消息是否过期。
决定用户是否有权限访问文件。
```

业务生命周期必须由数据库控制。

---

# 二十八、文件去重规则

推荐做物理层去重，但不能牺牲权限安全。

去重层级建议：

```text
同租户内 sha256 + size 去重。
必要时可以全局去重，但权限必须完全隔离。
```

规则：

```text
FileBlob 可以复用。
FileObject 可以多个。
不同用户 / 不同业务来源可以拥有不同 FileObject。
权限永远挂在 FileReferenceLedger / DriveNode / MessageFileRef 上。
不能因为两个用户文件 hash 相同，就让他们互相访问。
```

---

# 二十九、上传成功与消息发送时机

推荐规则：

```text
发送方本地立即显示“发送中”卡片。
服务端只有在 FileObject 可用后，才向接收方投递正式文件消息。
```

好处：

```text
接收方不会看到永远不可用的文件卡片。
发送失败不会污染对方聊天记录。
发送方可以在本地看到上传进度。
```

如果需要类似 QQ 的实时传输感，可以在双方都在线时显示“对方正在发送文件”，但正式消息仍应在服务端文件可用后落库。

---

# 三十、传输管理规则

当前会话顶部设置：

```text
传输
```

传输管理显示：

```text
上传中
下载中
已完成
失败
暂停
取消
重试
```

大文件必须进入传输管理。

小文件可只在消息卡片显示进度，但后台仍然可以创建 transfer_task。

传输任务不等于文件长期引用。

传输任务存在期间，只是通过 FileReferenceLedger 创建 task 引用，防止文件被 GC 删除。

任务完成后释放 task 引用。

---

# 三十一、消息卡片右键菜单

## 1. 未过期聊天文件

私聊：

```text
打开 / 预览
下载
另存为
转发
保存到我的网盘
复制文件名
删除
```

群聊普通成员：

```text
打开 / 预览
下载
另存为
转发
保存到我的网盘
复制文件名
```

群主 / 管理员：

```text
打开 / 预览
下载
另存为
转发
保存到我的网盘
保存到群网盘
复制文件名
删除
```

## 2. 已过期聊天文件

```text
复制文件名
查看详情
删除
```

如果本地仍有文件：

```text
打开本地文件
打开所在文件夹
重新上传
复制文件名
查看详情
删除
```

## 3. 网盘文件

我的网盘：

```text
打开 / 预览
下载
另存为
转发
重命名
移动到
复制到
删除
查看详情
```

群网盘：

```text
打开 / 预览
下载
另存为
转发
重命名
移动到
删除
查看详情
```

具体菜单由权限决定。

---

# 三十二、最终生命周期表

| 类型            | 是否进 OSS | 是否生成 FileObject | 是否生成 MessageFileRef | 是否生成 FileReferenceLedger | 是否 7 天临时访问 | 是否可存网盘 | 删除依据             |
| ------------- | ------- | --------------- | ------------------- | ------------------------ | ---------- | ------ | ---------------- |
| 文本            | 否       | 否               | 否                   | 否                        | 否          | 否      | 聊天记录策略           |
| Unicode emoji | 否       | 否               | 否                   | 否                        | 否          | 否      | 聊天记录策略           |
| 系统内置表情        | 系统公共资源  | 否               | 否                   | 否                        | 否          | 否      | 系统资源策略           |
| 用户自定义表情       | 是       | 是               | 否                   | 是                        | 否          | 不建议    | sticker_asset 引用 |
| 临时 GIF / 图片表情 | 是       | 是               | 是                   | 是                        | 是          | 是      | ledger 引用        |
| 图片            | 是       | 是               | 是                   | 是                        | 是          | 是      | ledger 引用        |
| 视频            | 是       | 是               | 是                   | 是                        | 是          | 是      | ledger 引用        |
| 音频文件          | 是       | 是               | 是                   | 是                        | 是          | 是      | ledger 引用        |
| 语音消息          | 是       | 是/可选            | 否/专用引用              | 是                        | 不按 7 天     | 不建议    | 语音策略 / ledger    |
| PDF           | 是       | 是               | 是                   | 是                        | 是          | 是      | ledger 引用        |
| Word          | 是       | 是               | 是                   | 是                        | 是          | 是      | ledger 引用        |
| PPT           | 是       | 是               | 是                   | 是                        | 是          | 是      | ledger 引用        |
| Excel         | 是       | 是               | 是                   | 是                        | 是          | 是      | ledger 引用        |
| 压缩包           | 是       | 是               | 是                   | 是                        | 是          | 是      | ledger 引用        |
| 普通文件          | 是       | 是               | 是                   | 是                        | 是          | 是      | ledger 引用        |
| 系统消息          | 否       | 否               | 否                   | 否                        | 否          | 否      | 系统消息策略           |
| 通话事件          | 否       | 否               | 否                   | 否                        | 否          | 否      | 通话记录策略           |

---

# 三十三、最终一句话规则

教师助手 IM 的最优工业级文件生命周期方案是：文本、emoji、系统消息是聊天记录，不走 OSS 文件生命周期；系统内置表情只发送资源 ID；用户自定义表情是长期表情资产；图片、视频、音频文件、文档、压缩包、普通文件和临时 GIF 表情统一作为聊天文件处理。聊天文件上传后生成 FileObject，每条聊天文件消息通过 MessageFileRef 获得独立的 7 天云端访问权，并在 FileReferenceLedger 中登记临时引用。转发只创建新的 MessageFileRef 和新的临时引用，不重新上传，也不刷新旧消息。保存到我的网盘或群网盘只创建 DriveNode 和长期引用，不复制 OSS 文件。云文件是否能删除不由单个 expireAt 决定，而由 FileReferenceLedger 中是否仍存在 active 引用决定。文件删除必须经过批量扫描、GC 队列、分布式锁、两阶段 pending_delete、二次确认和 OSS 异步删除。用户打开文件时永远本地优先，本地没有再按聊天消息、个人网盘、群网盘或表情资产来源进行后端鉴权，过期、无权限、被拦截或已删除则不能播放、下载、转发或保存。


#

上一版 plan 作废，后续只以最新 `docs/plan7.md` 为准。新的核心不是“给文件加过期时间”，而是建立 `FileReferenceLedger` 统一引用账本，让消息、网盘、群网盘、表情、传输任务、GC 都按同一套生命周期运行。

**升级优化 Plan**

1. **数据模型与迁移**
- 梳理现有 `message / file_object / drive_node / upload_task` 等表，补齐 `file_reference_ledger`、`message_file_ref`、`file_blob`、`sticker_asset`、`file_transfer_task`、`local_file_cache`。
- 明确规则：`FileReferenceLedger` 是删除真相，`FileObject.activeRefCount` 等字段只做性能缓存。
- 迁移旧数据：已有聊天文件生成 `MessageFileRef + chat_temp ledger`，已有网盘文件生成 `DriveNode + long_term ledger`。

2. **后端核心链路重构**
- 发送文件消息必须事务写入：`Message + MessageFileRef + FileReferenceLedger`。
- 保存到我的网盘/群网盘必须只创建 `DriveNode + long_term ledger`，不复制 OSS。
- 转发必须只创建新的 `MessageFileRef + chat_temp ledger`，不重新上传，不刷新旧消息有效期。
- 撤回、删除网盘、管理员删除群文件消息时，只释放对应 ledger 引用，不直接删 OSS。

3. **访问鉴权与本地优先**
- 前端禁止保存或拼接 OSS 永久地址，所有预览/下载都通过后端按来源鉴权。
- 聊天来源校验 `MessageFileRef`、会话成员、过期状态、消息可见性、`FileObject` 状态、安全状态。
- 网盘来源校验 `DriveNode` 权限，不检查聊天消息 7 天过期。
- 客户端打开文件统一走“本地原文件 → 本地下载 → 预览缓存 → 后端短期 URL”的顺序。

4. **消息类型与 UI 行为**
- 文本、emoji、系统消息不进入文件生命周期。
- 图片、视频、音频文件、文档、压缩包、普通文件统一作为聊天文件。
- 语音消息单独作为聊天媒体，不默认进入文件传输管理，不按普通文件 7 天规则处理。
- 右键菜单按状态区分：未过期、已过期但本地存在、已过期且本地不存在、个人网盘、群网盘。

5. **传输管理与任务引用**
- 大文件上传/下载进入传输管理：上传中、下载中、已完成、失败、暂停、取消、重试。
- 活跃上传、合并、转码、安全扫描任务创建 `transfer_task / processing_task` ledger 引用。
- 任务完成或取消后释放任务引用，避免 GC 误删正在处理的文件。

6. **GC 与云端删除**
- 禁止每个文件一个定时器，禁止直接依赖 OSS 生命周期删除业务文件。
- 后端实现批量过期扫描：把到期 `chat_temp` 标记为 `expired`，同步 `MessageFileRef.accessStatus`。
- 引用释放后进入 GC 队列，worker 加锁后重查 ledger。
- 删除采用两阶段：先 `pending_delete`，24-72 小时后二次确认，再异步删除 OSS。
- 每日做 ledger 与 `FileObject` 聚合字段校准，修复计数不一致。

7. **验证与上线顺序**
- 第一轮先做后端模型、迁移、事务链路和访问鉴权。
- 第二轮接入前端消息菜单、网盘保存、转发、过期态 UI。
- 第三轮接入 GC worker、outbox、传输任务引用、迁移校准。
- 第四轮做回归测试：发送、转发、保存网盘、删除、撤回、过期、本地优先、群权限、离线接收、大文件上传。

**验收标准**

文件不会因为某条消息过期而误删，也不会因为保存到网盘而复制 OSS；转发不会刷新旧消息有效期；聊天文件过期后卡片仍保留但不能云端预览/下载；网盘文件不受聊天 7 天限制；所有云端访问都经过后端鉴权；最终物理删除只由 `FileReferenceLedger` 无 active 引用后经 GC 完成。当前你提到的视频缩略图和网盘卡死 bug 先记录，暂不混入这次生命周期方案。



