# apple-pi: Lightweight In-Process Subagent Extension for Pi

## What This Is

A pi extension (`pi install npm:apple-pi`) that registers a `delegate` tool. The LLM calls it to run tasks on lightweight in-process agents with different models, thinking levels, and tool sets — in parallel.

## Core Principles

1. **Each agent starts from zero** — no pi docs, no project context, no skills in the system prompt. Just the agent's instruction body + only the tool schemas it declares. A scout with `tools: read, grep` gets ~300 tokens of system prompt vs 2000-4000+ for a full pi session.

2. **In-process, not subprocess** — uses `Agent` from `@mariozechner/pi-agent-core` directly. No process spawn, no CLI arg construction, no JSONL parsing. Just object allocation + HTTP to LLM.

3. **Parallel by default** — `Promise.allSettled` over independent `Agent` instances. Each has its own model, its own tools, its own message array. No shared mutable state.

## Architecture

```
apple-pi/
├── index.ts          # Extension entry: registers `delegate` tool
├── executor.ts       # Creates Agent, runs task, returns output
├── agents.ts         # Discovers + parses agent markdown files  
├── tools.ts          # Maps tool names → AgentTool factories
├── types.ts          # Shared types
├── package.json
└── agents/           # Bundled agent definitions
    ├── scout.md
    └── worker.md
```

### How It Works

**1. Agent definitions** are markdown files with YAML frontmatter:

```yaml
---
name: scout
description: Fast codebase reconnaissance
model: anthropic/claude-haiku-4-5
thinking: off
tools: read, grep, find, ls
---
You are a codebase scout. Your job is to quickly find and summarize relevant files, patterns, and structure.

Rules:
- Never edit files
- Be concise — return findings as structured markdown
- Focus on what was asked, skip irrelevant detail
```

That's the entire system prompt. No boilerplate.

**2. Tool filtering** — the `tools` field maps to pi's exported tool factories:

```typescript
// tools.ts
import { createReadTool, createBashTool, createEditTool, createWriteTool,
         createGrepTool, createFindTool, createLsTool } from "@mariozechner/pi-coding-agent";

const FACTORIES: Record<string, (cwd: string) => AgentTool> = {
  read:  createReadTool,
  bash:  createBashTool,
  edit:  createEditTool,
  write: createWriteTool,
  grep:  createGrepTool,
  find:  createFindTool,
  ls:    createLsTool,
};

export function buildTools(names: string[], cwd: string): AgentTool[] {
  return names.map(n => FACTORIES[n]?.(cwd)).filter(Boolean);
}
```

Agent says `tools: read, grep` → 2 AgentTool objects → 2 tool schemas in LLM context. Done.

**3. Executor** — one function, creates `Agent`, runs it, extracts output:

```typescript
// executor.ts
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { convertToLlm } from "@mariozechner/pi-coding-agent";

export async function runAgent(config, task, cwd, modelRegistry, signal?): Promise<RunResult> {
  // 1. Resolve model
  const model = resolveModel(config.model, modelRegistry);
  
  // 2. Build tools (only what's declared)
  const tools = buildTools(config.tools, cwd);
  
  // 3. Create agent — this is instant, no I/O
  const agent = new Agent({
    initialState: {
      systemPrompt: config.systemPrompt,  // just the markdown body
      model,
      thinkingLevel: config.thinking ?? "off",
      tools,
    },
    convertToLlm,
    streamFn: async (model, context, options) => {
      const auth = await modelRegistry.getApiKeyAndHeaders(model);
      return streamSimple(model, context, { ...options, apiKey: auth.apiKey, headers: auth.headers });
    },
  });
  
  // 4. Run
  await agent.prompt(task);
  await agent.waitForIdle();
  
  // 5. Extract text from assistant messages
  return { output: extractOutput(agent.state.messages), usage: extractUsage(agent.state.messages) };
}
```

No session files. No extension runner. No resource loader. No compaction. No skills discovery.

**4. The tool** — registered on the extension API:

```typescript
// index.ts
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "delegate",
    label: "Delegate",
    description: "Run tasks on specialized agents in parallel. Each agent has its own model, tools, and context.",
    parameters: Type.Object({
      tasks: Type.Array(Type.Object({
        agent: Type.String({ description: "Agent name" }),
        task: Type.String({ description: "Task instructions" }),
      })),
    }),
    async execute(id, params, signal, onUpdate, ctx) {
      const agents = discoverAgents(ctx.cwd);
      
      const results = await Promise.allSettled(
        params.tasks.map(t => runAgent(
          agents.get(t.agent),
          t.task,
          ctx.cwd,
          ctx.modelRegistry,
          signal,
        ))
      );
      
      return formatResults(results, params.tasks);
    },
  });
}
```

## Agent Discovery

Same locations as pi-subagents (proven pattern):

| Scope | Path | Priority |
|-------|------|----------|
| Bundled | `<extension>/agents/` | Lowest |
| User | `~/.pi/agent/agents/*.md` | Medium |
| Project | `.pi/agents/*.md` (walks up) | Highest |

Project overrides user overrides bundled. Simple name-based dedup.

## Model Resolution

Agent config says `model: anthropic/claude-haiku-4-5`. We resolve it:

```typescript
function resolveModel(modelStr: string | undefined, registry: ModelRegistry): Model {
  if (!modelStr) return /* fall back to parent model via ctx.model */;
  const [provider, id] = modelStr.split("/", 2);
  const model = registry.find(provider, id);
  if (!model) throw new Error(`Model not found: ${modelStr}`);
  return model;
}
```

Uses the parent's `ModelRegistry` — same auth, same API keys, zero re-discovery.

## What's NOT in MVP

- **Chains / sequential steps** — v2. MVP is parallel-only.
- **MCP tool proxying** — v2. MVP has the 7 built-in tools only.  
- **Progress streaming** — v2. MVP blocks until all agents finish, then returns combined output.
- **TUI overlays / agent manager** — not planned. Config is in markdown files.
- **Async background execution** — v2.
- **Worktree isolation** — not planned.
- **Session persistence for subagents** — not planned. Subagents are ephemeral.
- **Skill injection** — not planned. Agent prompt IS the skill.

## Why This Design

**vs pi-subagents:** pi-subagents spawns a full `pi` process per agent. That means CLI parsing, extension loading, resource discovery, session file creation, system prompt with pi docs — all per agent. We skip all of that. The tradeoff: no MCP in v1, no session files for subagents. Worth it for speed and context cleanliness.

**vs oh-my-pi:** omp builds subagents into the coding-agent itself and maintains a fork. We're a standalone extension installable on stock pi. The tradeoff: we don't get access to private APIs (like `_toolRegistry` or `MCPManager`). Worth it for not maintaining a fork.

**vs claude-code:** Claude Code's Agent tool is deeply integrated — it creates subagent contexts with cloned file state, shared cache-safe params, forked abort controllers, etc. That's all claude-code-specific infrastructure. We use pi's public API surface only. The design insight we borrow: claude-code also runs subagents in-process via `runForkedAgent` with isolated context and `AsyncLocalStorage` for tracking. The principle is the same — in-process, isolated state, parent's auth.

## File Sizes (Estimated)

| File | Lines | What |
|------|-------|------|
| `index.ts` | ~60 | Tool registration, parallel dispatch, result formatting |
| `executor.ts` | ~80 | Agent creation, run, output extraction |
| `agents.ts` | ~70 | Markdown discovery + frontmatter parsing |
| `tools.ts` | ~20 | Name → factory map |
| `types.ts` | ~30 | AgentConfig, RunResult |
| `agents/scout.md` | ~15 | Bundled scout agent |
| `agents/worker.md` | ~15 | Bundled worker agent |
| **Total** | **~290** | |

## Dependencies (Peer)

```json
{
  "peerDependencies": {
    "@mariozechner/pi-agent-core": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-coding-agent": "*",
    "@sinclair/typebox": "*"
  }
}
```

All already present in any pi installation. Zero additional deps.
