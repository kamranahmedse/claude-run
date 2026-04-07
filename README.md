<div align="center">

# Agents Run

English | [简体中文](./README.zh-CN.md)

Browse AI coding session history from multiple tools in a unified web UI

[![npm version](https://img.shields.io/npm/v/agents-run.svg)](https://www.npmjs.com/package/agents-run)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

<img src=".github/agents-run.gif" alt="Agents Run Demo" width="800" />

<sub>The README demo is generated from synthetic sessions, not from local history.</sub>

</div>

<br />

Run the project simply by executing

```bash
npx agents-run
```

Or, after installing globally, use:

```bash
agents-run
```

The browser will open automatically at http://localhost:12001.

## Features

- **Multi-provider support** - Browse conversations from Claude Code, Codex CLI/Desktop, and Gemini CLI in one place
- **Token usage & cost tracking** - Per-session cost breakdown with model-aware pricing for all providers
- **Real-time streaming** - Watch conversations update live as Claude responds
- **Search** - Find sessions by prompt text or project name
- **Filter by project** - Focus on specific projects
- **Resume sessions** - Copy the resume command to continue any conversation in your terminal
- **Collapsible sidebar** - Maximize your viewing area
- **Dark mode** - Easy on the eyes
- **Clean UI** - Familiar chat interface with collapsible tool calls

## Usage

Install globally via npm:

```bash
npm install -g agents-run
```

If you prefer Homebrew:

```bash
brew tap SunZhiC/agents-run
brew install agents-run
```

Then run it from any directory:

```bash
agents-run
```

The browser will open automatically at http://localhost:12001, showing your AI coding sessions across supported providers.

```bash
agents-run [options]

Options:
  -V, --version        Show version number
  -p, --port <number>  Port to listen on (default: 12001)
  -d, --dir <path>     Claude directory (default: ~/.claude)
  --no-open            Do not open browser automatically
  -h, --help           Show help
```

## How It Works

Agents Run reads conversation history from multiple AI coding tools and presents them in a unified web interface:

| Provider | Data Directory | Features |
|---|---|---|
| **Claude Code** | `~/.claude/` | Full token usage with cost breakdown, session rename/delete, resume |
| **Codex CLI/Desktop** | `~/.codex/` | Token usage with cost breakdown, resume |
| **Gemini CLI** | `~/.gemini/` | Token usage with cost breakdown |

The interface includes:

- **Session list** - All your conversations across providers, sorted by recency
- **Project filter** - Focus on a specific project
- **Conversation view** - Full message history with tool calls
- **Token usage & costs** - Model-aware pricing (dynamically resolved per session)
- **Session header** - Shows conversation title, project name, and timestamp
- **Resume command** - Copies the command to resume the conversation
- **Real-time updates** - SSE streaming for live conversations

## Requirements

- Node.js 20+
- At least one of: Claude Code, Codex CLI, or Gemini CLI installed and used

## Development

```bash
# Clone the repo
git clone https://github.com/SunZhiC/agents-run.git
cd agents-run

# Install dependencies
pnpm install

# Start development servers
pnpm dev

# Build for production
pnpm build

# Refresh the README demo GIF with synthetic data
pnpm demo:gif
```

## Release

```bash
# Publish a new npm release
npm publish

# Sync the Homebrew tap formula to the latest published npm version
pnpm sync:homebrew
```

## License

MIT
