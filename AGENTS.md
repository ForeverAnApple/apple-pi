# AGENTS.md

This is the apple-pi extension for pi — a lightweight, in-process subagent system.

## Project Structure

```
apple-pi/
├── README.md         # User-facing docs, design philosophy, usage
├── PLAN.md           # Internal architecture plan and implementation notes
├── AGENTS.md         # This file — project context for AI agents
├── package.json      # Extension metadata, peer dependencies
├── index.ts          # Extension entry: registers `delegate` tool, parallel dispatch
├── executor.ts       # In-process agent runner: Agent creation, execution, output extraction
├── agents.ts         # Agent discovery: finds + parses markdown agent definitions
├── tools.ts          # Tool factory map: agent tool name → pi AgentTool instance
├── types.ts          # Shared TypeScript types
└── agents/           # Bundled agent definitions (markdown + YAML frontmatter)
    ├── scout.md
    └── worker.md
```

## Key Design Constraints

1. **Public API only** — apple-pi must work on stock pi without forking. Only use exports from `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, and `@mariozechner/pi-coding-agent`. No private APIs, no monkey-patching.

2. **Minimal per-agent overhead** — each subagent creates one `Agent` object with only declared tools and a plain markdown system prompt. No extension loading, no resource discovery, no session files, no compaction.

3. **No shared mutable state between agents** — each `Agent` instance owns its own message array, tool instances, and streaming connection. Parallel execution via `Promise.allSettled`.

4. **Context cleanliness** — an agent's system prompt is just its markdown body. No pi documentation, no project context files, no skills injection. Tool schemas are limited to what the agent declares.

## Architecture Notes

- `Agent` from `@mariozechner/pi-agent-core` is the low-level agent loop. It takes a model, tools, system prompt, and a `streamFn`. It handles the LLM call → tool execution → LLM call loop.
- Auth is resolved via `ctx.modelRegistry.getApiKeyAndHeaders(model)` from the parent session's `ModelRegistry`. No re-discovery.
- Tools are created per-cwd via pi's exported factories: `createReadTool(cwd)`, `createBashTool(cwd)`, etc.
- `convertToLlm` from pi-coding-agent converts `AgentMessage[]` to LLM-compatible `Message[]`.
- `streamSimple` from pi-ai handles the actual HTTP streaming to LLM providers.

## References

- `pi-mono/packages/agent/src/` — Agent class, agent-loop, types
- `pi-mono/packages/coding-agent/src/core/sdk.ts` — createAgentSession, tool exports
- `pi-mono/packages/coding-agent/src/core/tools/` — tool factories and definitions
- `pi-mono/packages/coding-agent/src/core/extensions/types.ts` — ExtensionAPI, ExtensionContext
- `pi-subagents/` — reference for agent markdown format, discovery paths
- `oh-my-pi/packages/coding-agent/src/task/` — reference for in-process execution pattern
- `claude-code-src/src/utils/forkedAgent.ts` — reference for in-process fork pattern
- `codex/codex-rs/core/src/agent/` — reference for agent registry, spawn depth limits

## Conventions

- Commits use conventional format: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `ci:`, `test:`
- Keep files small and focused — the entire extension should be ~300 lines
- Prefer explicit over clever — no magic, no hidden state, no implicit behavior
- Agent definitions are the user's primary customization surface — keep the format simple

## Personal Preferences

- Agents should always check this section for user-specific instructions before starting a task.

## Commit Preferences

- Use conventional commits (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `ci:`, `test:`).

