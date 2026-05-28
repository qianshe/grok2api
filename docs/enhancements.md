# WebUI / Voice 增强说明

## 基于项目

本次增强基于 fork 项目进行：

- 上游项目：<https://github.com/chenyme/grok2api>
- 当前增强仓库：<https://github.com/qianshe/grok2api.git>

其中部分 WebUI / Voice / ChatKit 体验参考并延续自：

- [chenyme/grok2api#542](https://github.com/chenyme/grok2api/pull/542)

## 本次增强内容

### Chat 页 Voice 模式

- 支持在 Chat 页直接进入 Voice 模式。
- 支持选择语音音色。
- 支持选择 Voice 个性 / 角色。
- Chat 页只负责选择个性，不提供新增、编辑、删除自定义个性。

### Voice 语音对话

- 支持实时语音通话。
- 支持发送文本后由 Grok 语音回复。
- 支持保存语音会话历史。
- 支持重新进入并继续历史语音会话。
- 优化语音历史展示，减少重复消息和错误空态。

> 语音通话需要 VPN / 代理节点支持**流式传输**，否则可能影响实时连接、语音回包和通话稳定性。

### ChatKit 个性管理

- 支持统一管理 Voice 个性。
- 支持预设个性。
- 支持新增、编辑、删除自定义个性。
- Chat 页 Voice 模式可直接选择 ChatKit 中配置好的个性。

### 普通 Chat 朗读

- 普通 Chat 回复支持朗读。
- Web Free 模型支持朗读。
- Console 模型不触发朗读。

## 模型支持范围

### Web Free / 支持朗读

- `grok-4.20-0309-non-reasoning`
- `grok-4.20-fast`

### Console / 不触发朗读

- `grok-4.3`
- `grok-4`
- `grok-4.20`
- `grok-4.20-reasoning`
- `grok-4.20-non-reasoning`
- `grok-4.20-multi-agent`

### 图片模型

- `grok-imagine-image-lite`

## 使用入口

| 功能 | 入口 |
| :-- | :-- |
| Chat 页 Voice 模式 | `/webui/chat` |
| Voice 个性选择 | `/webui/chat` |
| 自定义个性管理 | `/webui/chatkit` |
| 普通 Chat 朗读 | `/webui/chat` |
