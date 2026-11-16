# provisional 节点

## 状态

节点表新增：

```text
status: provisional | committed
```

- `provisional`：已出现、待确认；
- `committed`：正式节点。

## 同 ID

`stream/segment` 创建 provisional 节点；`stream/commit` 只改 status，不重新建节点。

## 位置

- provisional 的位置在服务端 `placeAround` 计算并写入 `nodes.x/y`；
- 前端直接渲染这个节点，不再用另一套 ghost 坐标；
- commit 不改坐标。

## 下游

provisional 不触发方向、题目、副本；commit 后才进入正式图逻辑（目前最小版尚未补下游触发）。
