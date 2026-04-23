# Watch-System 项目规划文档

## 一、项目背景

随着开源大语言模型（LLM）的爆发式增长，企业和开发者在生产环境中部署了越来越多的 AI 模型服务。如何实时掌握这些模型的运行状态、性能指标以及异常情况，成为 MLOps 工程师面临的核心挑战之一。

Watch-System 旨在提供一套轻量、可扩展的监控解决方案，针对开源模型（LLaMA2、Mistral、CodeLlama 等）的 API 调用进行全方位监控，帮助团队：

- 快速发现性能瓶颈（响应时间过长、错误率上升）
- 掌握各模型的资源消耗（Token 使用量）
- 在异常发生时及时告警，缩短 MTTR（平均故障恢复时间）

---

## 二、系统架构

### 2.1 整体架构

系统采用前后端分离架构，后端为 Node.js 服务，前端为单页应用（SPA）。

```
前端 (SPA)          后端 (Node.js)         数据层
   │                     │                   │
   │── HTTP GET ──────►  REST API             │
   │                     │── 查询 ──────────► SQLite DB
   │◄─ WebSocket ──────  Socket.IO            │
   │   (实时推送)         │── 写入 ──────────► SQLite DB
                          │
                    模拟器 / 告警管理器
```

### 2.2 技术选型理由

| 技术 | 版本 | 选型理由 |
|------|------|----------|
| Node.js + Express | 18.x / 4.x | 轻量、生态丰富、异步友好 |
| Socket.IO | 4.x | 自动降级、断线重连、房间广播 |
| better-sqlite3 | 9.x | 同步 API、高性能、零配置 |
| Chart.js | 4.x | 轻量图表库，支持实时更新 |
| Docker Compose | 3.8 | 一键编排，环境一致性 |

---

## 三、模块拆解

### 3.1 后端模块

#### server.js（主入口）
- 初始化 Express 应用
- 挂载 CORS、JSON 中间件
- 注册 `/api` 路由
- 启动 Socket.IO 服务
- 启动模拟器和告警管理器
- 监听指定端口

#### database.js（数据层）
- 初始化 SQLite 数据库
- 创建 `requests` 表和 `models` 表
- 提供以下 Helper 函数：
  - `insertRequest()` - 写入请求记录
  - `getModelStats()` - 查询模型统计数据
  - `getRecentRequests()` - 查询近期请求列表
  - `getAggregatedMetrics()` - 聚合全局指标

#### routes/api.js（REST API）
- `GET /api/models` - 返回所有模型列表及实时状态
- `GET /api/metrics` - 全局聚合指标
- `GET /api/metrics/:modelName` - 单模型指标（含 P95 延迟）
- `GET /api/history/:modelName` - 最近 100 条请求历史
- `GET /api/alerts` - 活跃告警列表
- `POST /api/simulate` - 手动触发单次模拟

#### services/simulator.js（模拟器）
- 定义 8 个模型的特征参数（响应时间范围、Token 范围、错误率）
- 随机化请求间隔（200-800ms）
- 每次模拟完成后：
  1. 写入数据库
  2. 触发 `request_completed` 事件
- 支持启动/停止控制

#### services/alertManager.js（告警管理）
- 定期检查指标阈值：
  - 错误率 > 10%：ERROR 级别告警
  - 平均响应时间 > 3000ms：WARNING 级别告警
  - 请求量突增 > 200%：WARNING 级别告警
- 告警去重（同一模型同一类型不重复创建）
- 指标恢复后自动解除告警
- 触发 `alert_created` / `alert_resolved` 事件

### 3.2 前端模块

#### 布局结构
```
┌──────────────── Header ───────────────────┐
│  AI 模型监控系统          [实时时钟] [状态] │
├──────── Stats Cards (4列) ────────────────┤
│  总请求数  │ 活跃模型  │ 均响应时间 │ 错误率 │
├────── Charts (左2/3 + 右1/3) ─────────────┤
│  请求量趋势折线图  │  请求分布饼图          │
├────── 响应时间柱状图 ──────────────────────┤
│  各模型平均响应时间横向柱状图               │
├──── Model Cards Grid (4x2) ───────────────┤
│  [模型卡片×8]                              │
├──── Live Log + Alerts ────────────────────┤
│  实时请求日志表格  │  告警面板              │
└───────────────────────────────────────────┘
```

---

## 四、数据流设计

### 4.1 实时数据流

```
Simulator.js
    │
    │ 每 200-800ms 生成一条模拟请求
    ▼
database.insertRequest()
    │
    │ 写入 SQLite
    ▼
EventEmitter.emit('request_completed', payload)
    │
    ▼
server.js 监听事件
    │
    │ io.emit('request_completed', payload)
    ▼
所有连接的前端客户端
    │
    ▼
更新实时日志 + 更新模型卡片计数器
```

### 4.2 定时指标推送流

```
server.js setInterval(5000)
    │
    │ 调用 database.getAggregatedMetrics()
    ▼
io.emit('metrics_update', allMetrics)
    │
    ▼
前端更新：
  - Stats Cards 数字动画
  - 折线图新增数据点
  - 饼图重绘
  - 柱状图重绘
  - 模型卡片状态更新
```

### 4.3 告警流

```
alertManager.js setInterval(10000)
    │
    │ 查询最近 1 分钟各模型指标
    ▼
检查阈值条件
    │
    ├── 新告警 → emit('alert_created')
    │              → 前端显示告警横幅
    │
    └── 告警恢复 → emit('alert_resolved')
                   → 前端标记告警已解除
```

---

## 五、数据库设计

### requests 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PRIMARY KEY | 自增主键 |
| model_name | TEXT NOT NULL | 模型标识符 |
| timestamp | INTEGER NOT NULL | Unix 时间戳（毫秒） |
| response_time_ms | INTEGER | 响应时间（毫秒） |
| tokens_input | INTEGER | 输入 Token 数 |
| tokens_output | INTEGER | 输出 Token 数 |
| status | TEXT | success / error |
| error_message | TEXT | 错误信息（可空） |

### models 表

| 字段 | 类型 | 说明 |
|------|------|------|
| name | TEXT PRIMARY KEY | 模型唯一标识 |
| display_name | TEXT | 展示名称 |
| description | TEXT | 模型描述 |
| category | TEXT | 分类（chat/code/multilingual） |

---

## 六、开发里程碑

| 阶段 | 任务 | 状态 |
|------|------|------|
| M1 | 项目初始化、目录结构、package.json | ✅ 完成 |
| M2 | 数据库设计与实现（database.js） | ✅ 完成 |
| M3 | 模型模拟器实现（simulator.js） | ✅ 完成 |
| M4 | REST API 路由实现（api.js） | ✅ 完成 |
| M5 | 告警管理器（alertManager.js） | ✅ 完成 |
| M6 | 主服务入口（server.js） | ✅ 完成 |
| M7 | 前端仪表板（index.html） | ✅ 完成 |
| M8 | Docker 化部署配置 | ✅ 完成 |
| M9 | 端到端联调测试 | ✅ 完成 |

---

## 七、扩展规划

- **多实例支持**：引入 Redis Pub/Sub 替换内存事件总线，支持水平扩展
- **真实接入**：对接 Ollama / vLLM 等本地推理框架的真实 API
- **用户认证**：添加 JWT 鉴权，支持多租户监控
- **数据导出**：支持 Prometheus 指标格式导出，对接 Grafana
- **移动端适配**：PWA 支持，手机端查看告警推送
