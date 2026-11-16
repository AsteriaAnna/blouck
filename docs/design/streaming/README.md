# 流式链路

小文档，不放在一个超级大文档里。

- [asr.md](asr.md)：partial / segment final / hotwords / 自动结束
- [provisional.md](provisional.md)：节点 provisional 状态、同 ID、坐标、commit
- [relation-binding.md](relation-binding.md)：新节点与已有节点的关系绑定
- [issues.md](issues.md)：真实语音跑通后的文本/位置/启动时序问题

实现位置：

- 后端：`server/src/stream/session.ts`、`server/src/providers/doubao.ts`
- 前端：`web/src/store.ts`、`web/src/components/InputBar.tsx`、`web/src/components/World3D.tsx`
