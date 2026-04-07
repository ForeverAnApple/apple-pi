# apple-pi

Opinionated [pi](https://github.com/badlogic/pi-mono) setup focused on simplicity, performance, and customization.

apple-pi is a pi extension that adds a lightweight, in-process subagent system. Each agent runs with its own model, thinking level, and tool set — in parallel, with zero process overhead and minimal context usage.

If you want something simpler, fork this repo or use pi-agent as-is.

## Install

```bash
pi install npm:apple-pi
```

## Why

Every coding agent has the same problem: one context window doing everything. The LLM that plans your architecture is the same one grepping files, and it's loaded with tool schemas it doesn't need for the current task.

apple-pi fixes this by splitting work into focused agents that each get:

- **Only the tools they need** — a scout with `tools: read, grep` gets 2 tool schemas, not 7. That's half the context overhead before the agent even starts.
- **The right model for the job** — Haiku for fast recon, Sonnet for implementation, Opus for deep reasoning. Running in parallel.
- **A clean system prompt** — just the agent's instructions. No pi docs, no project context preamble, no skills section. ~300 tokens vs 2000-4000+ for a full pi session.

## How It Works

apple-pi registers a `delegate` tool that the parent LLM calls to farm out work. Under the hood, each task creates a lightweight `Agent` instance from `@mariozechner/pi-agent-core` — the same core that pi itself runs on. No subprocess spawning, no CLI arg construction, no JSONL parsing. Just object allocation and an HTTP call to the LLM provider.

```
Parent LLM calls delegate tool
  ├── scout (haiku, read-only tools) ──→ runs in parallel
  ├── scout (haiku, read-only tools) ──→ runs in parallel  
  └── worker (sonnet, full tools)    ──→ runs in parallel
All results returned to parent
```

Auth is shared from the parent session's `ModelRegistry` — same API keys, same OAuth tokens, zero re-discovery.

## Agents

Agents are markdown files with YAML frontmatter. The body is the system prompt — nothing more.

```yaml
---
name: scout
description: Fast codebase reconnaissance
model: anthropic/claude-haiku-4-5
thinking: off
tools: read, grep, find, ls
---
You are a codebase scout. Find and summarize relevant files, patterns, and structure.

Rules:
- Never edit files
- Be concise
- Return findings as structured markdown
```

### Agent Locations

| Scope | Path | Priority |
|-------|------|----------|
| Bundled | Ships with apple-pi | Lowest |
| User | `~/.pi/agent/agents/*.md` | Medium |
| Project | `.pi/agents/*.md` | Highest |

Project overrides user overrides bundled. Name-based dedup.

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent identifier |
| `description` | Yes | One-line summary (shown to parent LLM) |
| `model` | No | `provider/model-id` — falls back to parent's active model |
| `thinking` | No | `off`, `minimal`, `low`, `medium`, `high` — default `off` |
| `tools` | No | Comma-separated: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` — default all |

### Available Tools

These map directly to pi's built-in tool factories. Each agent only gets the schemas for tools it declares.

| Tool | What It Does |
|------|-------------|
| `read` | Read file contents |
| `bash` | Execute shell commands |
| `edit` | Edit files with search/replace |
| `write` | Create or overwrite files |
| `grep` | Search file contents (respects .gitignore) |
| `find` | Find files by glob |
| `ls` | List directories |

## Usage

The parent LLM decides when to delegate. The tool schema:

```json
{
  "name": "delegate",
  "parameters": {
    "tasks": [
      { "agent": "scout", "task": "find all authentication-related files" },
      { "agent": "scout", "task": "find all API endpoint handlers" },
      { "agent": "worker", "task": "refactor the auth middleware based on..." }
    ]
  }
}
```

All tasks run in parallel. Results are returned as a combined summary.

## Design Decisions

**In-process, not subprocess.** pi-subagents spawns a full `pi` CLI process per agent — CLI parsing, extension loading, resource discovery, session files, system prompt with pi docs. apple-pi creates an `Agent` object. The tradeoff: no MCP tools in v1, no session persistence for subagents. Worth it for speed and context cleanliness.

**No fork required.** oh-my-pi gets in-process subagents but maintains a fork of pi-mono. apple-pi uses only public exports from stock pi (`Agent`, `createReadTool`, `convertToLlm`, `ModelRegistry`, `streamSimple`). Installable on any pi installation.

**Agents start from zero.** Claude Code and Codex both use lazy/deferred tool loading to manage context bloat — they start with everything and hide schemas until needed. apple-pi does the opposite: each agent starts bare and only gets what it declares. No lazy loading needed because nothing was loaded in the first place.

**Parallel by default.** Each agent is an independent `Agent` instance with its own model, tools, and message array. `Promise.allSettled` runs them concurrently. No shared mutable state.

## What's Not Included (Yet)

- **MCP tool proxying** — built-in tools only in v1
- **Chains / sequential steps** — parallel-only in v1
- **Progress streaming** — blocks until complete in v1
- **TUI overlays** — agents are configured in markdown, not UI
- **Async background execution** — foreground-only in v1
- **Session persistence for subagents** — subagents are ephemeral

## License

MIT
