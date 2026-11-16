# 使用的技术方法

只列当前代码实际使用的方法。

## 1. 技术栈

- 前端：React 18、TypeScript、Vite、Zustand、three.js、@react-three/fiber、@react-three/drei、react-markdown。
- 服务端：Node.js 24、Express 4、ws。
- 存储：Node 内置 `node:sqlite`，WAL 模式，文件由 `DB_PATH` 指定。
- 语言模型：DeepSeek Chat Completions，封装在 `server/src/providers/deepseek.ts`。
- 语音识别：豆包 Seed ASR Streaming 2.0，`bigmodel_async`，封装在 `server/src/providers/doubao.ts`。
- 无 key 时：`mockLLM` / `mockASR` 自动接管，链路仍可跑。

## 2. 语音正式链路

```text
InputBar
→ getUserMedia
→ AudioContext（浏览器原生采样率，通常 48k）
→ AudioWorklet PCMWorklet：连续相位重采样 48k→16k，输出 Int16
→ 3200 samples 一块（PCM16 = 6400 字节，约 200ms）通过 /ws/asr 发送
→ 服务端 doubao.ts 转豆包二进制 WebSocket 协议
→ partial / segment / final 回推
→ segment 调 /stream/segment
→ commit 调 /stream/commit
```

关键实现：

- `web/src/components/InputBar.tsx`：麦克风、Worklet、WS、keepalive、重连、segment/commit。
- `server/src/providers/doubao.ts`：首帧、音频帧、负序号终帧、gzip、二进制解析、45000081 处理。
- `server/src/stream/session.ts`：provisional 建图、focus 栈、parent、关系、commit。
- `web/src/store.ts`：`ingestSegment` / `commitStream` 状态更新。
- `web/src/components/World3D.tsx`：provisional 节点直接渲染，虚线“候选 ·”标签。

音频注意：

- **不要**强制 AudioContext 16k；
- **不要**在主线程对 worklet 输出的 Int16 再做 Float32 重采样；
- 停止前 flush 尾部 + 300ms 静音；
- 1.5s 无音频补静音 keepalive；
- 豆包 45000081 是“等待下一包音频超时”，按会话结束重连，不弹致命错误。

## 3. focus / 多焦点算法

实现：`server/src/stream/session.ts`

候选顺序：

```text
显式关系（属于/包括/分为/由…组成）
> 指代（它/这个/前者/后者/它们）
> 文本提到的已有节点
> 当前 focus
> 上一句 focus
```

focus 栈：

- SQLite `focus_stack.stack`，最多 12 个节点 ID；
- 栈顶当前主题；
- 一个句子创建多个兄弟节点时，兄弟也入栈；
- `前者` → 栈第二，`后者` → 栈顶；
- 分支回退：文本重新提到已有节点时，focus 跟过去。

parent：

- 关系另一端是已有节点时优先挂它；
- 否则挂本句提到的已有节点；
- 否则当前 focus；
- 不再默认所有新节点挂同一个 focus。

## 4. 关系绑定（当前范围）

已实现：

- `suggest` 关系在 commit 时升级 `formal`；
- 关系 source/target 用焦点栈、本句已有节点、新节点解析；
- `partOf` 方向**没有**强制归一，9.4 场景是模型输出正确，不要写成已实现。

**没有实现**：relation 稳定 ID/lifecycle、多谓词上限、冲突 disputed/revised、top-k 邻居候选。不要把这些写成已实现。

## 5. 节点布局

- `server/src/placement.ts`：`placeAround` 在父节点周围按间距/向外生长选点。
- `server/src/layout.ts`：`elkLayout` 全局布局。
- `server/src/wfc.ts`：WFC 岛屿布局。
- `server/src/assetops.ts`：建筑坐标、方向 frontier、隐藏/撤回、导出。
- 坐标写入 `nodes.x/y`；语音 provisional/commit 不重算。

## 6. 3D 渲染

`web/src/components/World3D.tsx`：

- GLB 浮岛来自 `web/public/assets3d/`，映射在 `manifest.json`；
- 节点、关系曲线、建筑、方向线、provisional 标签；
- 状态来自 `web/src/store.ts`，不直接请求接口。

## 7. 文字链路与出题/副本

`POST /extract` 是旧的批量链路：

- DeepSeek 抽取实体/关系；
- 规则检测副本（`detectBuildings` / `dungeons.ts`）；
- 出题/判题/方向也在该链路里。

语音链路目前只建 provisional/commit，**不触发**方向、题目、副本。不要把 `/extract` 的行为当成语音链路已有能力。

## 8. mock 与真实切换

- `server/src/env.ts` 根据 key 选择 provider；
- `providers/mock.ts` 提供 mock LLM/ASR；
- 豆包连接失败时部分错误会降级 mock，但 45000081 现在是会话结束语义，不是降级。
