# apple-pi

A [pi](https://github.com/badlogic/pi-mono) extension that lets your main agent delegate tasks to smaller, focused subagents running in parallel.

## Install

```bash
pi install npm:apple-pi
```

## Why

One LLM doing everything means one bloated context window — planning, grepping, editing, all with every tool schema loaded. apple-pi splits work into agents that each get only the tools and context they need, running the right model for the job.

## How It Works

apple-pi registers a `delegate` tool. When the parent LLM calls it, each task spins up a lightweight in-process `Agent` — no subprocesses, no CLI overhead, just an object and an HTTP call to the provider. Tasks run in parallel via `Promise.allSettled` and results come back to the parent.

```
Parent LLM calls delegate
  ├── scout (haiku, read-only)  ──→ parallel
  ├── scout (haiku, read-only)  ──→ parallel
  └── worker (sonnet, all tools) ──→ parallel
Results returned to parent
```

## Agents

Agents are markdown files with YAML frontmatter. The body is the system prompt.

```yaml
---
name: scout
description: Fast codebase reconnaissance
model: anthropic/claude-haiku-4-5
thinking: off
tools: read, grep, find, ls
---
You are a codebase scout. Find and summarize relevant files.
Be concise. Never edit files.
```

Agents are discovered from three locations (highest priority wins by name):

1. `.pi/agents/*.md` (project)
2. `~/.pi/agent/agents/*.md` (user)
3. Bundled with apple-pi (default)

### Frontmatter

| Field | Required | Default |
|-------|----------|---------|
| `name` | yes | — |
| `description` | yes | — |
| `model` | no | parent's model |
| `thinking` | no | `off` (`minimal`, `low`, `medium`, `high`) |
| `tools` | no | all (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) |

## License

Apache-2.0
