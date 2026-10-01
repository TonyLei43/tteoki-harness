# Agent Note: 原生 DSH 编排看板

Status: proposed

[English](2026-09-25-native-orchestration-board.md) | 中文

## 问题

DSH 已具备会话、智能体、预设和按会话的状态，但没有任何单一界面把它们汇总在一起，也无法把一条自由请求路由到正确的目标。想“直接处理这件事”的用户必须先打开工作区列表、挑选会话，或新建会话并手动选择预设。

原生事实其实已经存在。客户端会话模型拥有目录、运行状态和按会话的 projection；统一的会话状态快照携带审批等待中的交互；`session` 与 `agentPresets` Remote 命名空间可创建、提示和组合会话；`resolveAgentSelection` 已在创建智能体时通过 `agent-models` 服务解析预设绑定的模型。缺的是一个读取这些事实的组合层，以及一个选择目标的分类器。

## 提案

新增 `@deepseek-ai/dsh-client-ui-orchestrator` 浏览器插件，贡献一个 `main` 键控面板（key 为 `orchestrator`）和一个 `sidebar.panellist` 入口。该面板是按项目目录分组的原生 DSH 会话看板，外加一个醒目的自动路由输入框。

看板通过框架的 `useSessions` 钩子读取客户端会话模型，通过 `useSessionStatus` 读取统一状态事实；它不发起临时的列表 Remote 调用，也不保存 store。行按 `SessionSummary.cwd` 分组，无目录组排在最后。组内按状态优先级排序（`needs-feedback`，然后 `error`、`retrying`、`running`、`done`、`idle`），再按最近活动、最后按 id 破平。

每行状态仅从客户端事实推导：有待处理交互是 `needs-feedback`，运行中是 `running`，有未确认的完成是 `done`，其余为 `idle`。列表与状态快照不携带按会话的智能体失败或重试周期，因此看板不推导 `error` 或 `retrying`；共享 pill 仍为拥有这些事实的调用方渲染完整词汇。选择某行会通过 `ctx.uiWorkspace.openSession` 打开该会话。

## 路由分类

`src/client/router.ts` 拥有一个纯函数 `routeIntent(input, { sessions, presets })`，它是默认的、无 token 的分类器：

1. 将输入与每个候选自身的词按大小写不敏感分词，以非字母数字字符切分。
2. 会话得分 = 输入 token 出现在其标题、项目目录 basename 和预设名中的数量。
3. 预设得分 = 输入 token 出现在其名称、描述和 id 中的数量。
4. 会话按得分、最近 `updatedAt`、id 排序；预设按得分、id 排序。
5. 得分高者胜；得分相同时会话优先，偏向已有上下文而非组合新会话。与所有候选零重叠视为无匹配，会给出提示而不是随意派发。

评分器是一个有文档的纯接缝，而非硬编码策略：面板注入的 face 接受可选的 `classify(input, options)` 回调，它替换 `routeIntent` 并返回相同的 `RouteTarget`。未来的本地模型（例如 LM Studio 服务的模型）可实现该回调。v1 不要求任何模型调用。

## 派发与模型绑定

注入 face 把每种决策映射到现有 API：

- **已有会话** —— 通过 `ctx.remote.session.prompt` 发送新生成的请求 id，然后打开它。
- **无匹配会话的智能体预设** —— 通过客户端会话模型创建空会话，通过 `ctx.remote.agentPresets.select` 选择预设，然后提示新会话。在第一轮之前选择预设是既有的绑定路径；Host 在组合智能体时通过 `agent-models` 服务解析预设绑定的模型。不引入新的模型存储，fork 也无需在客户端读取绑定。
- **无目标或发送失败** —— 显示清晰的提示，不导航。

## 考虑过的替代方案

**用临时 `session.list` Remote 调用替代 `useSessions`。** 否决，因为框架钩子已拥有实时目录、状态和变更传播；并行读取会重复对象层并错过转发事件。

**在客户端读取预设绑定模型并调用 `session.selectModel`。** 否决，因为 Host 在组合时已通过 `agent-models` 解析绑定；客户端读取会为同一决策增加第二个事实来源。

**在无匹配时派发到最近会话。** 否决，因为静默的错误路由比无目标提示更糟；输入会留在输入框中。

## 验收标准

- 面板以 key `orchestrator` 注册进 `main`，并由一个 `sidebar.panellist` 入口打开；销毁插件会移除两者。
- 看板按项目目录渲染每个非子智能体会话，并附上由 `SessionListState` 与 `SessionStatusSnapshot` 推导的状态 pill；选择某行会调用 `ctx.uiWorkspace.openSession`。
- `routeIntent` 为纯函数，并针对目标选择、破平与无匹配进行了单元测试；注入的 `classify` 回调可替换它而不改变派发约定。
- 提交会把输入路由到最佳会话并通过 session Remote 提示它，或通过创建并提示预设会话（`agentPresets.select`）；两条路径都会报告“已路由到”，失败或无匹配会显示提示。
- 无目标或发送失败除提示外不改变当前视图。

## 风险

当两个会话共享词汇时，token 重叠可能误路由；最近活动的破平偏向最近使用的会话，通常正确，但对陈旧主题可能出错。模型分类器只能通过可选接缝改善这一点。

看板行状态缺少智能体失败与重试周期，因此 `error` 会话会显示为 `idle`。弥补该缺口需要在列表或状态快照上增加按会话的错误事实，或注入按会话读取。

打开所选会话会选中会话面板，使看板卸载，之后其“已路由到”提示不可见。可见结果是已打开并发送了提示的会话；持久的路由提示需要 frame 级 overlay。

行在每次渲染时从实时目录构建。目录极大时看板可能偏重；目前分组与排序是线性的，虚拟化待有实测后再做。