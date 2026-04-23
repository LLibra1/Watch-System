# AI 模型监控系统 (Watch-System)

> 实时监控开源 AI/ML 模型调用状态的可视化仪表板

---

## 📋 项目概述

Watch-System 是一套针对开源 AI/ML 模型（如 LLaMA2、Mistral、CodeLlama、Phi-2、Gemma、Qwen、DeepSeek 等）的**实时监控平台**。系统通过模拟真实 API 调用，持续采集请求量、响应时间、Token 用量、错误率等核心指标，并以美观的 Grafana 风格仪表板实时展示。

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────┐
│                  浏览器 (前端)                    │
│  ┌───────────────────────────────────────────┐  │
│  │  index.html  (Chart.js + Socket.IO Client) │  │
│  │  - 实时图表  - 模型卡片  - 告警面板        │  │
│  └──────────────────┬────────────────────────┘  │
└─────────────────────┼───────────────────────────┘
                       │  WebSocket / HTTP
┌─────────────────────▼───────────────────────────┐
│               Node.js 后端 (:3001)               │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Express  │  │Socket.IO │  │  REST API     │  │
│  │ Server   │  │  Server  │  │  /api/*       │  │
│  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       │              │               │           │
│  ┌────▼──────────────▼───────────────▼────────┐  │
│  │           Services Layer                   │  │
│  │  ┌─────────────┐   ┌──────────────────┐   │  │
│  │  │  Simulator  │   │  AlertManager    │   │  │
│  │  │ (模型模拟器) │   │ (告警管理器)     │   │  │
│  │  └──────┬──────┘   └────────┬─────────┘   │  │
│  └─────────┼───────────────────┼─────────────┘  │
│            │                   │                 │
│  ┌─────────▼───────────────────▼─────────────┐  │
│  │          SQLite Database (better-sqlite3)  │  │
│  │   requests 表  |  models 表                │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 🔴 实时监控 | 通过 Socket.IO WebSocket 推送，毫秒级延迟更新 |
| 📊 多维图表 | 请求量趋势折线图、请求分布饼图、响应时间柱状图 |
| 🤖 多模型支持 | 同时监控 8 个主流开源模型 |
| 🚨 智能告警 | 错误率超阈值、响应过慢、流量突刺自动告警 |
| 📝 请求日志 | 滚动显示最新 20 条请求详情 |
| 🌙 暗色主题 | Grafana/DataDog 风格深色仪表板 |
| 🐳 Docker 部署 | 一键 docker-compose up 启动 |
| 💾 持久化存储 | SQLite 本地存储历史数据 |

---

## 🚀 快速启动

### 方式一：本地运行

```bash
# 1. 安装后端依赖
cd backend
npm install

# 2. 启动后端服务
npm start
# 或开发模式（热重载）
npm run dev

# 3. 打开前端
open ../frontend/index.html
```

### 方式二：Docker Compose

```bash
docker-compose up --build
# 前端访问: http://localhost:3000
# 后端 API: http://localhost:3001
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3001 | 后端监听端口 |
| NODE_ENV | development | 运行环境 |
| DB_PATH | ./data/watch.db | SQLite 数据库路径 |

---

## 📁 项目结构

```
Watch-System/
├── README.md
├── docker-compose.yml
├── docs/
│   └── project-plan.md
├── frontend/
│   └── index.html
└── backend/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── server.js
        ├── database.js
        ├── routes/
        │   └── api.js
        └── services/
            ├── simulator.js
            └── alertManager.js
```

---

## 📡 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/models | 获取所有模型及实时状态 |
| GET | /api/metrics | 获取系统总体指标 |
| GET | /api/metrics/:model | 获取指定模型详细指标 |
| GET | /api/history/:model | 获取模型最近请求历史 |
| GET | /api/alerts | 获取当前活跃告警 |
| POST | /api/simulate | 手动触发一次模拟请求 |

---

## 🔌 Socket.IO 事件

| 事件 | 方向 | 说明 |
|------|------|------|
| request_completed | 服务端→客户端 | 单次请求完成 |
| metrics_update | 服务端→客户端 | 全量指标推送（每5秒） |
| alert_created | 服务端→客户端 | 新告警产生 |
| alert_resolved | 服务端→客户端 | 告警已解除 |

---

## 🤖 监控模型列表

| 模型 | 特征 | 响应时间 |
|------|------|----------|
| llama2-7b | 通用对话 | 800-2000ms |
| llama2-13b | 大参数通用 | 1500-4000ms |
| mistral-7b | 快速推理 | 400-1200ms |
| codellama-7b | 代码生成 | 600-1800ms |
| phi-2 | 轻量快速 | 300-900ms |
| gemma-7b | Google 开源 | 500-1500ms |
| qwen-7b | 多语言 | 400-1100ms |
| deepseek-7b | 深度推理 | 600-1600ms |

---

## 📄 许可证

MIT License
