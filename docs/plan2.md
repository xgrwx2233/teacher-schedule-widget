我们已经完成了1对1好友聊天窗口的UI创建、添加、搜素好友、聊天发送消息、联系人中的好友列表等功能。请问下一步要做什么：以下是我认为要做的两个方向：1、完善1对1聊天窗口的功能：包括聊天窗口中如何显示不同的内容，如图片、动图、引用、上传的文件、富文本表情输入、时间线、系统气泡等等、还有聊天历史、图片预览、文件预览下载功能，所有QQ聊天界面中出现的可能。2、做群聊功能，包括创建群、搜索群、申请添加群、验证群、群聊界面。请问选择哪个方向，如果有更好的开发计划请提出。另外，什么时候做我们上面讨论的三种语音对讲功能（普通1v1电话，教师向教室打电话，群对讲）

我的建议是：**不要直接二选一**。你现在下一步应该先做一个很短的 **“1 对 1 聊天基础补强阶段”**，但不要把 QQ 所有高级功能一次性做完；然后马上进入 **群聊基础功能**。语音对讲放在群聊基础稳定之后做。

也就是：

```text
下一步不是：
A. 把 1 对 1 聊天做成完整 QQ
B. 直接跳到群聊

而是：
1. 先补齐 IM 底座能力
2. 再做群聊
3. 再做 RTC 语音/对讲
```

你的项目原计划里也已经把顺序写得比较合理：先做单聊文本、会话列表、未读数、WebSocket 新消息、撤回、好友资料；再做群聊基础；再做对讲，并且 RTC Token 由后端生成，客户端不能生成。

---

## 一、现在最应该做的不是“QQ 全功能”，而是“消息底座”

你说的方向 1 里有很多功能：

```text
图片
动图
引用
文件
富文本表情输入
时间线
系统气泡
聊天历史
图片预览
文件预览下载
```

这些都要做，但不能一次性全做。因为 QQ 聊天界面的功能非常多，如果你现在追求“所有 QQ 里出现的可能”，很容易陷入 UI 细节，导致群聊、RTC、移动端同步全部延后。

你现在应该先补这些**底座级能力**：

```text
1. 消息类型体系
2. 消息渲染器
3. 文件/图片 OSS 上传下载链路
4. 聊天历史分页
5. 消息状态
6. 系统气泡
7. 本地缓存
```

这些能力一旦做好，后面群聊可以复用，1 对 1 电话可以复用，群对讲也可以复用。

---

## 二、推荐下一阶段：IM Core V1.5

我建议你把下一阶段命名为：

```text
IM Core V1.5：单聊基础补强 + 群聊复用底座
```

这个阶段只做下面这些。

### 1. 统一消息类型

先把消息模型设计好，不要每加一种消息就在前端临时写一个字段。

建议消息表/消息对象至少支持：

```text
message_type:
  text
  image
  file
  emoji
  system
  revoke
  call_event
```

先不要急着做：

```text
quote
rich_text
gif
voice_message
mixed
markdown
```

但模型里要预留 `content_json` 或 `metadata_json`，以后可以扩展。

建议结构：

```json
{
  "id": "msg_10001",
  "conversation_id": "conv_10001",
  "conversation_type": "direct",
  "sender_id": "u_10001",
  "message_type": "image",
  "content": "",
  "content_json": {
    "file_id": "file_10001",
    "width": 1080,
    "height": 720
  },
  "client_msg_id": "uuid",
  "server_seq": 1024,
  "conversation_seq": 88,
  "status": "sent",
  "created_at": "2026-06-20T10:00:00Z"
}
```

你原来的规划里也明确了消息状态应该统一为 `local_created`、`sending`、`sent`、`delivered`、`read`、`failed`、`revoked`，这一步必须先固化。

---

### 2. 做消息渲染器，而不是在页面里写一堆 if

不要在聊天页面里到处写：

```ts
if message.type === 'image'
if message.type === 'file'
if message.type === 'system'
```

建议做成：

```text
MessageRenderer
  ├── TextMessageRenderer
  ├── ImageMessageRenderer
  ├── FileMessageRenderer
  ├── SystemMessageRenderer
  ├── RevokeMessageRenderer
  └── CallEventMessageRenderer
```

这样群聊复用同一套渲染器，只是头像、昵称、群成员信息不同。

---

### 3. 先做图片和文件，不急着做动图和富文本

你已经有 OSS Bucket 和 ECS RAM Role，这时应该把 OSS 用起来。

下一步优先做：

```text
图片消息：
  选择图片
  上传到 ECS
  ECS 上传 OSS
  RDS 写 file_object
  message 保存 file_id
  前端显示缩略图
  点击图片预览

文件消息：
  选择文件
  上传 OSS
  RDS 写 file_object
  message 保存 file_id
  前端显示文件名、大小、下载按钮
  点击下载
```

暂时不要做：

```text
动图
富文本
复杂表情商店
图片编辑
文件在线预览 Office/PDF
```

这些属于体验增强，不是 IM 底座。

---

### 4. 做聊天历史分页和本地缓存

聊天软件不能每次打开都全量拉消息。你的项目计划里也明确提到：桌面端后续使用 SQLite，移动端继续用 SQLite/Drift，两端缓存结构尽量一致，不要每次打开聊天面板都全量拉历史消息。

建议先做：

```text
GET /conversations/{id}/messages?before_seq=xxx&limit=30
GET /conversations/{id}/messages?after_seq=xxx&limit=100
```

前端逻辑：

```text
打开会话：
  先读本地缓存最近 30 条
  再向后端拉增量
  往上滚动时分页加载历史
```

本地缓存表建议：

```text
local_conversation
local_message
local_file_object
local_sync_cursor
```

---

### 5. 系统气泡先做基础版

系统气泡你可以先做：

```text
今天 10:28
你撤回了一条消息
对方撤回了一条消息
已添加为好友，现在可以开始聊天
群成员已加入群聊
```

你的计划里也已经定义过系统状态气泡：居中显示、没有头像、视觉弱化，用于解释聊天上下文变化，不承载远程管理操作。

先不要做：

```text
复杂远程管理状态
RTC 详细事件流
设备控制状态
```

这些后面再接。

---

## 三、然后进入群聊，而不是继续无限完善单聊

当下面这些完成后，就应该进入群聊：

```text
1. text / image / file / system / revoke 消息类型可用
2. OSS 上传下载链路可用
3. 聊天历史分页可用
4. WebSocket message.new / message.ack 可用
5. 未读数可用
6. 本地缓存初版可用
```

此时就不要继续做富文本、动图、引用、复杂预览了。因为群聊是你后面群对讲、教师通信、班级管理的基础。

群聊基础阶段建议做：

```text
1. 创建群
2. 搜索群
3. 申请加群
4. 群验证
5. 群成员列表
6. 群会话
7. 群消息
8. 群未读数
9. 群头像
10. 群资料页
```

你原计划里 V2 也是群列表、群消息、群成员、群未读数、创建群、加群申请。

---

## 四、为什么不是现在直接做群聊？

你现在已经有 1 对 1 发送消息，但如果马上做群聊，可能会遇到这些问题：

```text
1. 单聊消息模型还不支持图片/文件，群聊又要重新写一遍
2. 没有统一 MessageRenderer，群聊 UI 会复制单聊代码
3. 没有 file_object，群文件后面会返工
4. 没有 conversation_seq / server_seq，群消息同步会乱
5. 没有本地缓存，群聊消息多了以后会卡
```

所以先补 IM Core V1.5，是为了避免群聊返工。

---

## 五、什么时候做三种语音对讲？

建议按这个顺序做：

```text
第一阶段：IM Core V1.5
第二阶段：群聊基础功能
第三阶段：RTC 基础设施
第四阶段：普通 1 对 1 电话
第五阶段：老师呼叫教室自动接通
第六阶段：群对讲
```

不要把 RTC 提前到群聊之前。因为群对讲依赖：

```text
群
群成员
群权限
群 WebSocket 通知
talk_room
Redis 临时状态
RTC Token
```

你的项目文档里也建议：RTC 逻辑不要直接写进页面，而应该封装 `RtcService`、`TalkRoomRepository`、`TalkRoomController`，并且移动端也要按同一套协议对齐。

---

## 六、三种语音功能的具体顺序

### 1. 先做普通 1 对 1 电话

这个最简单，适合验证阿里云 RTC：

```text
A 呼叫 B
B 接听
双方加入同一个 RTC channel
任意一方挂断
双方退出
```

它需要：

```text
call_session
call_member
rtc_token
WebSocket call.invite / call.accepted / call.ended
RtcService.joinChannel
RtcService.leaveChannel
```

这个可以作为 RTC 的第一条闭环。

---

### 2. 再做老师呼叫教室

这个比普通 1v1 难，因为它不是普通用户关系，而是设备管理：

```text
老师 A 呼叫教室设备 B
B 自动接通
只有老师 A 能挂断
```

它需要先有：

```text
classroom_device
teacher_classroom_permission
device_online_state
device_auto_answer_enabled
```

所以它应该放在 1 对 1 电话之后。

---

### 3. 最后做群对讲

群对讲最复杂，因为它不仅是 RTC，还涉及抢麦：

```text
所有人加入 RTC 房间
默认只听
按住说话申请发言权
Redis SET NX 抢麦
抢到的人 publish audio
松开释放
超时释放
断线释放
```

它依赖群聊基础功能，所以必须放在群聊之后。

---

## 七、我建议你的开发路线图

### 第 1 阶段：IM Core V1.5，先做 1 到 2 周

目标：让单聊消息底座能支撑群聊。

做这些：

```text
1. message_type 统一
2. MessageRenderer 拆分
3. file_object 表
4. 图片上传 OSS
5. 文件上传 OSS
6. 图片预览
7. 文件下载
8. 聊天历史分页
9. 系统气泡
10. 消息撤回
11. 本地缓存初版
```

不做这些：

```text
1. 复杂富文本
2. 动图商店
3. 引用回复
4. 复杂文件在线预览
5. 消息全文搜索
```

---

### 第 2 阶段：群聊基础，2 到 3 周

目标：完整群聊闭环。

做这些：

```text
1. group 表
2. group_member 表
3. conversation 支持 direct / group
4. 创建群
5. 搜索群
6. 申请加群
7. 审核加群
8. 群资料页
9. 群成员列表
10. 群消息
11. 群未读数
12. 群系统气泡
```

---

### 第 3 阶段：RTC 基础，1 周

目标：不做复杂业务，先验证 RTC 能通。

做这些：

```text
1. 阿里云 RTC 应用配置
2. 后端 /rtc/token
3. RtcService 封装
4. Tauri Web SDK 加入频道
5. 两个账号测试同频道语音
6. 麦克风权限处理
7. 加入、静音、退出
```

---

### 第 4 阶段：普通 1 对 1 电话，1 到 2 周

做这些：

```text
1. call_session 表
2. call_member 表
3. A 呼叫 B
4. B 来电弹窗
5. B 接听 / 拒绝
6. 双方入 RTC
7. 任意一方挂断
8. 通话记录
9. 通话事件系统气泡
```

---

### 第 5 阶段：老师呼叫教室，1 到 2 周

做这些：

```text
1. classroom_device 表
2. teacher_classroom_permission 表
3. 教室端自动接听
4. 只允许老师挂断
5. 教室端离线处理
6. 呼叫权限校验
7. 操作日志
```

---

### 第 6 阶段：群对讲，2 到 3 周

做这些：

```text
1. talk_room 表
2. talk_room_member 表
3. 群成员加入 RTC 房间
4. 默认只听
5. Redis 抢麦
6. 抢到麦才 publish audio
7. 松开释放
8. 超时释放
9. 断线释放
10. 主持人结束对讲
```

---

## 八、最终选择

你现在应该选：

```text
先做方向 1 的“基础补强版”，不是完整 QQ 版。
然后立刻做方向 2 的群聊基础功能。
语音对讲在群聊基础之后做。
```

更明确地说：

```text
现在马上做：
图片、文件、历史分页、系统气泡、消息状态、本地缓存、OSS 文件链路

暂时不做：
富文本、引用、动图、复杂文件预览、全文搜索

下一步做：
群聊

再下一步做：
RTC 1 对 1 电话 → 老师呼叫教室 → 群对讲
```

这样开发顺序最稳，也最符合你项目长期目标：**先把 IM 数据模型和同步机制打牢，再扩展群聊和 RTC，不要在 UI 功能里无限打转。**


严格说，**QQ 官方没有公开一个“QQ 聊天全部消息类型清单”**，而且不同端、不同版本会有差异。所以你做教师助手时，不要照抄 QQ 的全部业务，而是参考 QQ/微信/IM 的成熟分类，设计一套**可扩展的消息类型体系**。

腾讯云 IM 介绍里提到，它基于 QQ 底层 IM 能力，支持文字、图片、短语音、短视频等富媒体消息收发；其审核能力也覆盖文本、图片、语音、视频等多维度内容。QQ 官方 App Store 介绍中也能看到聊天消息、语音通话、视频聊天、文件传输等能力。([腾讯云][1])

## 一、按 QQ 聊天界面体验来看，常见消息类型大概有这些

### 1. 基础文本类

```text
纯文本消息
文本 + 表情混排
文本 + @某人
文本 + 链接
富文本 / 混合内容
```

这里要注意：**@某人、链接、表情不一定都要作为独立 message_type**。它们可以是文本消息里的扩展结构。

例如：

```json
{
  "message_type": "text",
  "content": "今天下午@张老师 开会",
  "mentions": ["u_10001"]
}
```

---

### 2. 表情类

```text
系统表情
QQ 表情
自定义表情
动图表情
收藏表情
大表情 / 贴纸
```

你项目里可以先合并成：

```text
emoji
sticker
```

如果是输入框里的普通 emoji，可以当成 text；如果是单独发送的大表情、动图表情，就当成 `sticker`。

---

### 3. 图片类

```text
普通图片
截图
粘贴图片
相册图片
长图
动图 GIF
表情包图片
图片原图
```

你项目里建议先统一成：

```text
image
```

然后用 metadata 区分：

```json
{
  "message_type": "image",
  "content_json": {
    "file_id": "file_10001",
    "width": 1080,
    "height": 720,
    "is_gif": false
  }
}
```

GIF 可以先当 image，后期再拆 `gif`。

---

### 4. 语音类

```text
语音消息
短语音
语音转文字
```

这和“语音通话”不是一回事。

```text
语音消息 = 发一段录音文件
语音通话 = RTC 实时通话
```

你的教师助手里可以设计：

```text
audio
```

---

### 5. 视频类

```text
短视频
本地视频文件
视频预览
```

可以设计为：

```text
video
```

视频文件也可以归到 `file`，但如果要在聊天气泡里直接预览播放，建议单独做 `video`。

---

### 6. 文件类

```text
Word / Excel / PPT
PDF
压缩包
安装包
普通附件
离线文件
文件夹发送
```

你的项目里建议统一：

```text
file
```

RDS 保存文件元数据，OSS 保存真实文件。

---

### 7. 链接 / 卡片类

QQ 里常见：

```text
网页链接卡片
QQ 小程序卡片
腾讯文档卡片
音乐分享卡片
视频分享卡片
群邀请卡片
名片分享
```

你项目可以统一成：

```text
link_card
```

或者更通用：

```text
card
```

例如：

```json
{
  "message_type": "card",
  "content_json": {
    "card_type": "link",
    "title": "课程安排",
    "description": "点击查看本周安排",
    "url": "https://...",
    "cover_file_id": "file_10002"
  }
}
```

---

### 8. 位置类

移动端 QQ 一般会有位置分享能力：

```text
发送位置
共享实时位置
```

你项目第一阶段可以不做。后期如果需要校园位置、教室位置，可以加：

```text
location
```

---

### 9. 引用 / 回复类

QQ/微信这类聊天都有：

```text
引用回复
回复某条消息
```

但我建议你不要把它设计成单独的 `message_type = quote`。

更好的做法是：**引用是消息关系，不是消息类型**。

例如：

```json
{
  "message_type": "text",
  "content": "好的，我看到了",
  "reply_to_message_id": "msg_10001"
}
```

这样图片也可以引用、文件也可以引用、文本也可以引用。

---

### 10. 转发类

```text
逐条转发
合并转发聊天记录
转发图片
转发文件
```

可以设计：

```text
forward
merge_forward
```

其中合并转发可以是一种特殊卡片：

```json
{
  "message_type": "merge_forward",
  "content_json": {
    "title": "聊天记录",
    "summary": ["张老师：好的", "李老师：收到"],
    "message_ids": ["msg_1", "msg_2"]
  }
}
```

---

### 11. 系统提示类

QQ 里有很多灰色居中的提示：

```text
你撤回了一条消息
对方撤回了一条消息
你们已经成为好友，现在可以开始聊天了
某某加入群聊
某某退出群聊
某某修改了群名
管理员开启了全员禁言
群公告已发布
```

你项目里应该设计：

```text
system
```

或细分：

```text
system_tip
```

---

### 12. 撤回类

撤回有两种实现方式。

一种是把原消息状态改成：

```text
revoked
```

然后前端显示“你撤回了一条消息”。

另一种是单独插入一条：

```text
message_type = revoke
```

我建议你采用：

```text
原消息 status = revoked
同时生成 system 气泡
```

这样历史记录和 UI 都清楚。

---

### 13. 音视频通话事件类

QQ 里会出现：

```text
语音通话
视频通话
通话已取消
通话已拒绝
通话时长 03:21
未接来电
```

这类不是真正的聊天内容，而是通话事件。你可以设计：

```text
call_event
```

例如：

```json
{
  "message_type": "call_event",
  "content_json": {
    "call_type": "audio",
    "event": "ended",
    "duration_seconds": 180
  }
}
```

你后面要做普通 1 对 1 电话、老师呼叫教室、群对讲，这个类型会用得上。

---

### 14. 群业务类

群聊里比单聊多很多系统消息：

```text
创建群
邀请入群
申请入群
同意入群
拒绝入群
退出群
踢出群
设置管理员
取消管理员
群公告
群禁言
群名称修改
群头像修改
群成员昵称修改
```

这些建议不要做成很多 UI 组件，而是统一为：

```text
system
```

然后用 `system_type` 区分。

---

### 15. 互动类 / 特殊类

QQ 里还有一些特殊玩法：

```text
戳一戳 / 拍一拍类互动
红包
转账
投票
接龙
群签到
骰子
石头剪刀布
匿名消息
临时会话提示
安全提醒
```

你的教师助手第一阶段不要做这些。后面如果有教学场景，可以考虑：

```text
poll        投票
notice      通知
homework    作业卡片
schedule    课程表卡片
```

这些更适合你的产品，而不是照搬 QQ 红包、骰子。

---

## 二、如果按“开发可落地”来分，建议你这样设计

你不需要把 QQ 的所有类型一次性做完。建议分层。

## V1 必做消息类型

```text
text          文本
image         图片
file          文件
system        系统气泡
revoke        撤回状态
call_event    通话事件
```

这是你下一阶段最应该做的。

---

## V2 再做

```text
sticker       大表情 / 表情包
audio         语音消息
video         视频消息
card          链接 / 课程表 / 文件分享卡片
merge_forward 合并转发
```

---

## V3 后做

```text
location      位置
poll          投票
notice        群通知
homework      作业 / 教学任务卡片
rich_text     富文本
```

---

## 三、推荐你的最终 message_type 枚举

对你的教师助手项目，我建议先定义成这样：

```text
text
image
file
audio
video
sticker
card
system
call_event
merge_forward
custom
```

然后不要把所有细节都放进 `message_type`，而是用 `content_json` 扩展。

例如图片：

```json
{
  "message_type": "image",
  "content_json": {
    "file_id": "file_10001",
    "width": 1080,
    "height": 720,
    "thumbnail_file_id": "file_10002",
    "is_gif": false
  }
}
```

文件：

```json
{
  "message_type": "file",
  "content_json": {
    "file_id": "file_20001",
    "file_name": "课程表.xlsx",
    "size_bytes": 238912,
    "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
}
```

系统气泡：

```json
{
  "message_type": "system",
  "content_json": {
    "system_type": "friend_accepted",
    "text": "你们已经成为好友，现在可以开始聊天"
  }
}
```

通话事件：

```json
{
  "message_type": "call_event",
  "content_json": {
    "call_id": "call_10001",
    "call_type": "audio",
    "event": "missed",
    "duration_seconds": 0
  }
}
```

---

## 四、几个重要设计原则

### 1. 引用回复不要做成独立类型

用字段：

```text
reply_to_message_id
```

这样所有消息都能被引用。

---

### 2. @人不要做成独立类型

用字段：

```text
mentions
```

---

### 3. 撤回不要只靠删除消息

保留原消息记录，把状态改成：

```text
revoked
```

这样同步、多端、审计都更稳。

---

### 4. 图片、文件、视频、语音都不要直接存 URL

应该存：

```text
file_id
```

真实文件在 OSS，元数据在 RDS，临时 URL 由后端生成。

---

### 5. 系统消息一定要统一

不要每个系统事件都新建一种 message_type。统一：

```text
message_type = system
system_type = group_member_joined / message_revoked / friend_accepted
```

---

## 五、最终建议

你可以把 QQ 的消息类型理解成这 10 大类：

```text
1. 文本类
2. 表情类
3. 图片类
4. 语音消息类
5. 视频消息类
6. 文件类
7. 链接 / 卡片类
8. 引用 / 转发类
9. 系统提示类
10. 音视频通话事件类
```

但你的教师助手不要一开始照 QQ 全做。下一步最合理的是先做：

```text
text
image
file
system
revoke
call_event
```

然后再扩展：

```text
sticker
audio
video
card
merge_forward
```

这样既能覆盖 QQ 聊天界面的主要体验，又不会让你现在的开发阶段失控。

[1]: https://cloud.tencent.com/document/product/269?utm_source=chatgpt.com "即时通信IM购买指南"



