# Agent Note: 价格目录与 DeepSeek 错峰时钟

Status: proposed

[English](2026-09-25-prices-off-peak-clock.md) | 中文

## 问题

用户在 harness 内看不到当前词元价格。DeepSeek 对错峰时段打折，因此实际价格取决于以 UTC 计量的厂商时间表；OpenRouter 发布的大型目录会无预警地变动。在每个浏览器标签页中重算两者会重复抓取、校验与时间表规则，并把时间表隐藏在标签页本地状态中。

## 提案

新增 host 包 `@deepseek-ai/dsh-prices`，它提供生成的 `prices` Remote 命名空间且不持有文件系统状态。它携带以美元 / 每百万词元表示的 DeepSeek 静态价目表，通过一个纯函数计算错峰时钟，并抓取公开的 OpenRouter `/models` 端点，使用 zod 校验归一化并带 `refreshMs` 缓存。传输、HTTP、JSON 与 schema 失败抛出具名 RemoteError。

新增客户端包 `@deepseek-ai/dsh-client-ui-prices`，它注册一个设置分区与一个侧边栏面板。面板显示错峰时钟（倒计时由返回的切换时刻在本地实时重算）、DeepSeek 价格表，以及可搜索的 OpenRouter 列表。

错峰规则固定：高峰时段为 UTC 周一至周五 01:00-04:00 与 06:00-10:00（按 UTC 日历），周末全天错峰，错峰价格为高峰的一半。`deepseekOffPeak(now)` 是唯一的纯切换函数，返回当前标志与下一个切换时刻。

## 备选方案

- **在浏览器中抓取 OpenRouter** — 否决：会遇到 CORS，没有共享缓存，并会在每个标签页重复校验。
- **把 OpenRouter 列表烘焙进构建产物** — 否决：目录变动远比发布频繁。
- **在客户端按本地时间计算错峰** — 否决：厂商时段是 UTC，批处理边界由厂商定义，客户端不得重新解释。

## 验收标准

- 纯函数测试覆盖时段边界、精确的收尾边界、UTC 工作日边界以及周末规则。
- 价目表逐项断言，OpenRouter 归一化断言换算、可选缓存价格以及被拒载荷。
- 服务对传输、HTTP、JSON 与 schema 失败返回具名 RemoteError，并在 TTL 内提供缓存列表。
- UI 测试覆盖时钟状态、DeepSeek 价格表、目录搜索、刷新失败以及设置分区跳转。

## 风险

DeepSeek 价目表编译在内，厂商价格变动需要改代码并重新构建。一个 TTL 覆盖整个 OpenRouter 目录，客户端在每次按键时过滤并重排。倒计时每秒跳动一次，因此显示秒数可能落后边界最多一次跳动。
