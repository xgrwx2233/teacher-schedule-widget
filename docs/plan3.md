
# 四、群聊完成后再做 RTC 基础设施

不要在群聊前做 RTC 业务。你可以先准备文档，但代码层面建议群聊基础完成后再做。

RTC 基础设施不是马上做电话，而是先做：

```text
1. 阿里云 RTC 应用配置
2. 后端 /rtc/token
3. RtcService 抽象
4. Tauri 端接 ARTC Web SDK
5. 麦克风权限检测
6. joinChannel / leaveChannel / muteMicrophone
7. 两个测试账号进入同一个测试频道能听到声音
```

这一步只验证“RTC 能通”，不做来电、接听、挂断业务。

---

# 五、RTC 业务顺序

## 1. 普通 1v1 电话

先做这个，因为最标准：

```text
A 呼叫 B
B 弹出来电
B 接听 / 拒绝
双方入 RTC
任一方挂断
生成 call_event 消息
```

需要：

```text
call_session
call_member
call.invite
call.accepted
call.rejected
call.ended
```

## 2. 老师呼叫教室

放在 1v1 电话之后，因为它需要设备身份和权限：

```text
老师 A 呼叫教室设备 B
B 自动接听
只有老师 A 能挂断
教室端掉线要自动结束或提示
```

需要新增：

```text
classroom_device
teacher_classroom_permission
device_online_state
```

## 3. 群对讲

最后做。它依赖群聊、群成员、RTC、Redis 抢麦。

流程：

```text
群成员加入 RTC 房间
默认只听
按住说话
Redis 抢麦
抢到麦的人 publish audio
松开释放
超时释放
断线释放
```

这是最复杂的，不要提前做。

---

# 六、我建议你的最终路线

更稳的版本是：

```text
0. IM Core V1.5 验收冻结
1. 通知中心基础壳
2. 群聊基础功能
3. 群申请 / 群邀请 / 通知中心联动
4. RTC 基础设施
5. 普通 1v1 电话
6. 老师呼叫教室
7. 群对讲
```

也就是说，你原来的路线是对的，但我建议变成：

```text
群聊基础功能
-> 通知中心联动
-> RTC 基础设施
-> 普通 1v1 电话
-> 老师呼叫教室
-> 群对讲
```

---

我开通了阿里云的实时音视频，建立应用实例，应用名称为：b03fe2f7-4dcc-4cf4-8820-d565b0e4b40c；
RTC_APP_ID=b03fe2f7-4dcc-4cf4-8820-d565b0e4b40c
RTC_APP_KEY=8b97dda65d2b1e722dae6c4a7d8c3bef

并添加了以下ECS两个安全组的入方向：

| 用途           | 来源                | 端口     |
| ------------ | ----------------- | ------ |
| SSH 登录       | `112.8.48.202/32` | `22`   |
| RTC token 测试 | `112.8.48.202/32` | `8000` |


RTC_APP_ID=b03fe2f7-4dcc-4cf4-8820-d565b0e4b40c
RTC_APP_KEY=8b97dda65d2b1e722dae6c4a7d8c3bef
RTC_TOKEN_TTL_SECONDS=3600