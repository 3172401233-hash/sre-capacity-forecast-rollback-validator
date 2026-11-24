# sre-capacity-forecast-rollback-validator

容量预测与扩容回滚的**离线验证器**。根据历史流量序列、事故异常窗口、预测
误差、当前副本数、扩缩容延迟、单位成本和冷却期，判断扩容建议是否可信，并
计算满足冷却期与批任务约束的最早回滚窗口。

## 重要说明：不调用扩容系统

本工具是纯计算的只读验证器：

- 不连接 Kubernetes、HPA、VPA、云厂商伸缩组或任何编排平台；
- 不发起扩容、缩容、回滚或查询节点状态的 API 调用；
- 不需要任何网络权限、凭据或集群上下文；
- 所有输入由场景 JSON 提供，所有结果仅作为人工评审或自动化门禁的参考。

## 运行环境

- Node.js `24.16.0`（`engines` 要求 `>=24.16.0`）
- 零第三方依赖，仅使用 Node 内置模块（`node:test`、`node:fs`）

## 目录结构

```
src/
  baseline.js   事故窗口判定、样本剔除、基线统计（均值/标准差/极值）
  forecast.js   清洗后预测点与预测区间、naive 对照预测、窗口污染检测
  scaling.js    扩容可信度、所需副本、扩容建议与成本对比
  rollback.js   冷却期、缩容延迟、批任务与容量安全联合判定回滚窗口
  index.js      输入校验与整体编排
bin/cli.js      读取场景 JSON 并输出结果
test/           node:test 测试套件
examples/       事故场景示例
```

## 使用方式

```bash
node bin/cli.js examples/incident-scenario.json
npm test          # 等价于 node --test
```

## 输入字段（场景 JSON）

| 字段 | 含义 |
| --- | --- |
| `samples` | 历史流量序列，每项 `{ t, v }`，`t` 为时间戳、`v` 为流量值 |
| `anomalyWindows` | 事故窗口 `{ start, end }`，半开区间 `[start, end)` |
| `errorMargin` | 预测相对误差，区间为 `point ± errorMargin`，范围 `[0, 1)` |
| `errorThreshold` | 可信度阈值，误差超过它则扩容建议不可信 |
| `horizonMs` | 预测窗口长度，与事故窗口求交判断是否污染 |
| `now` | 当前时间戳 |
| `currentReplicas` | 当前副本数（整数，≥ 1） |
| `replicaCapacity` | 单副本可承载的流量 |
| `targetUtilization` | 目标利用率，范围 `(0, 1]`，默认 1 |
| `costPerReplicaPerHour` | 单副本每小时成本 |
| `rollback` | 可选回滚参数（见下） |

`rollback` 字段：

| 字段 | 含义 |
| --- | --- |
| `scaledUpAt` | 本次扩容生效时间戳 |
| `cooldownMs` | 节点/伸缩组冷却期 |
| `scaleDownLatencyMs` | 缩容操作生效延迟 |
| `baselineReplicas` | 回滚目标（扩容前）副本数 |
| `batchJobs` | 批任务列表 `{ id, endsAt }`，仍在运行的任务禁止缩容 |

## 判定规则

1. **事故峰值剔除**：落入异常窗口的样本不参与基线统计；同时保留含事故
   样本的 naive 预测作为对照，用于暴露事故流量对扩容判断的虚高影响。
2. **预测区间**：以清洗后基线均值为预测点，按 `errorMargin` 给出
   `lower`/`upper` 区间。
3. **扩容可信度**：预测窗口与事故窗口相交（`contaminated`）或误差超过
   `errorThreshold` 时，建议标记为不可信并返回 `hold`，保持当前副本。
4. **扩容建议**：可信时按预测上限和目标利用率计算所需副本
   （`ceil(upper / (replicaCapacity × targetUtilization))`），超过当前
   副本才建议 `scale_up`，并输出当前/建议/naive 三档每小时成本。
5. **回滚窗口**：最早可回滚时间取 `scaledUpAt + cooldownMs` 与最后一个
   未结束批任务 `endsAt` 的较大值；回滚完成时刻（再叠加
   `scaleDownLatencyMs`）的预测上限必须能被基线副本容量承载，且不能落入
   事故窗口，否则不给出回滚窗口。

## 输出结构

- `forecast`：清洗后的预测点、预测区间、基线统计、污染标记、剔除数
- `naiveForecast`：未剔除事故样本的对照预测
- `scaling`：`trusted`、`action`（`scale_up`/`hold`/`none`）、副本建议、
  判定原因与成本对比
- `rollback`：`canRollbackNow`、`eligible`、`earliestEligibleAt`、
  `expectedCompletedAt`、阻塞原因、批任务阻塞列表与每小时节省估算

## 测试

```bash
node --test
```

覆盖范围：

- 事故峰值剔除与半开窗口边界；
- 预测区间计算与预测窗口污染检测；
- 预测偏差超阈值导致扩容不可信；
- 冷却期、缩容延迟、运行中批任务对回滚窗口的约束；
- 回滚后容量不足或回滚时刻落入事故窗口的安全拦截；
- 输入校验与端到端事故场景。
