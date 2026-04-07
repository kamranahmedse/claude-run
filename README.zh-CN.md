<div align="center">

# Agents Run

[English](./README.md) | 简体中文

在统一的 Web UI 中浏览来自多个工具的 AI 编码会话历史

[![npm version](https://img.shields.io/npm/v/agents-run.svg)](https://www.npmjs.com/package/agents-run)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

<img src=".github/agents-run.gif" alt="Agents Run Demo" width="800" />

<sub>README 中的演示内容基于合成会话生成，并非来自本地历史记录。</sub>

</div>

<br />

只需执行下面的命令即可运行项目：

```bash
npx agents-run
```

或者在全局安装后，直接使用：

```bash
agents-run
```

浏览器会自动打开 http://localhost:12001。

## 功能特性

- **多提供方支持** - 在同一个界面中浏览来自 Claude Code、Codex CLI/Desktop 和 Gemini CLI 的会话
- **Token 使用量与成本统计** - 为所有提供方展示按会话统计、感知模型定价的成本拆分
- **实时流式更新** - 在 Claude 响应时实时查看会话更新
- **搜索** - 按提示词文本或项目名称查找会话
- **按项目筛选** - 聚焦特定项目
- **恢复会话** - 复制恢复命令，在终端中继续任意对话
- **可折叠侧边栏** - 最大化可视区域
- **深色模式** - 更护眼
- **简洁 UI** - 熟悉的聊天界面，支持折叠工具调用

## 使用方式

通过 npm 全局安装：

```bash
npm install -g agents-run
```

如果你更喜欢 Homebrew：

```bash
brew tap SunZhiC/agents-run
brew install agents-run
```

然后在任意目录运行：

```bash
agents-run
```

浏览器会自动打开 http://localhost:12001，并展示你在已支持提供方中的 AI 编码会话历史。

```bash
agents-run [options]

Options:
  -V, --version        Show version number
  -p, --port <number>  Port to listen on (default: 12001)
  -d, --dir <path>     Claude directory (default: ~/.claude)
  --no-open            Do not open browser automatically
  -h, --help           Show help
```

## 工作原理

Agents Run 会读取多个 AI 编码工具的对话历史，并将它们统一展示在一个 Web 界面中：

| 提供方 | 数据目录 | 功能 |
|---|---|---|
| **Claude Code** | `~/.claude/` | 完整 token 使用量与成本拆分、会话重命名/删除、恢复会话 |
| **Codex CLI/Desktop** | `~/.codex/` | token 使用量与成本拆分、恢复会话 |
| **Gemini CLI** | `~/.gemini/` | token 使用量与成本拆分 |

界面包含：

- **会话列表** - 展示来自各提供方的所有对话，并按最近时间排序
- **项目筛选** - 聚焦某个特定项目
- **会话视图** - 展示完整消息历史与工具调用
- **Token 使用量与成本** - 基于模型定价，并按会话动态解析
- **会话头部** - 显示对话标题、项目名称和时间戳
- **恢复命令** - 复制命令以继续当前会话
- **实时更新** - 通过 SSE 流式展示进行中的会话

## 环境要求

- Node.js 20+
- 至少安装并使用过以下之一：Claude Code、Codex CLI 或 Gemini CLI

## 开发

```bash
# 克隆仓库
git clone https://github.com/SunZhiC/agents-run.git
cd agents-run

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build

# 用合成数据刷新 README 演示 GIF
pnpm demo:gif
```

## 发布

```bash
# 发布新的 npm 版本
npm publish

# 将 Homebrew tap formula 同步到最新发布的 npm 版本
pnpm sync:homebrew
```

## 许可证

MIT
