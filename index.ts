import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { discoverAgents } from "./agents.ts";
import { runAgent } from "./executor.ts";
import type { RunResult } from "./types.ts";

// ── Types ──────────────────────────────────────────────────────────────────

interface TaskEntry { agent: string; task: string }

interface AgentProgress {
	agent: string;
	task: string;
	status: "pending" | "running" | "done" | "failed";
	durationMs: number;
	tokens: number;
	toolUses: number;
	error?: string;
}

interface DelegateDetails {
	tasks: TaskEntry[];
	results: (RunResult | { error: string })[];
	progress: AgentProgress[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function fmtTokens(n: number): string {
	return n < 1000 ? `${n}` : n < 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`;
}

function trunc(s: string, n: number): string {
	return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

const tree = (i: number, n: number) => i === n - 1 ? "└─" : "├─";
const indent = (i: number, n: number) => i === n - 1 ? "   " : "│  ";

// ── TUI Rendering ──────────────────────────────────────────────────────────

function renderCall(args: { tasks?: TaskEntry[] } | undefined, theme: Theme): string {
	const tasks = args?.tasks;
	if (!tasks?.length) return theme.fg("toolTitle", theme.bold("delegate"));

	return [
		theme.fg("toolTitle", theme.bold(`delegate ${tasks.length} task${tasks.length > 1 ? "s" : ""}`)),
		...tasks.map((t, i) => `${tree(i, tasks.length)} ${theme.bold(t.agent)} ${theme.fg("muted", trunc(t.task, 60))}`),
	].join("\n");
}

function renderProgressLine(p: AgentProgress, i: number, total: number, theme: Theme): string {
	const t = tree(i, total);
	const name = theme.bold(p.agent);
	const stats = (parts: string[]) => parts.length ? theme.fg("muted", ` · ${parts.join(" · ")}`) : "";

	switch (p.status) {
		case "done":
			return `${t} ${theme.fg("success", "✓")} ${name}${stats([fmtDuration(p.durationMs), `${fmtTokens(p.tokens)} tokens`])}`;
		case "failed":
			return `${t} ${theme.fg("error", "✗")} ${name}${p.error ? theme.fg("error", ` ${p.error}`) : ""}`;
		case "running":
			return `${t} ${theme.fg("warning", "●")} ${name}${stats(p.toolUses > 0 ? [`${p.toolUses} tool use${p.toolUses > 1 ? "s" : ""}`, `${fmtTokens(p.tokens)} tokens`] : [])}`;
		default:
			return `${t} ${theme.fg("muted", "○")} ${name} ${theme.fg("muted", "waiting…")}`;
	}
}

function renderResult(result: AgentToolResult<DelegateDetails>, isPartial: boolean, expanded: boolean, theme: Theme, startedAt: number | undefined): string {
	const details = result.details;
	if (!details?.progress?.length) {
		const text = result.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
		return text ? `\n${text}` : "";
	}

	const { progress, results } = details;
	const total = progress.length;
	const lines: string[] = [""];

	if (isPartial) {
		const done = progress.filter((p) => p.status === "done" || p.status === "failed").length;
		const elapsed = startedAt ? ` · ${fmtDuration(Date.now() - startedAt)}` : "";
		lines.push(theme.fg("muted", `Running ${total} agent${total > 1 ? "s" : ""}…${elapsed}`), "");
		for (let i = 0; i < total; i++) lines.push(renderProgressLine(progress[i]!, i, total, theme));
		if (done > 0 && done < total) lines.push("", theme.fg("muted", `${done}/${total} complete`));
	} else {
		const succeeded = progress.filter((p) => p.status === "done").length;
		const totalTokens = progress.reduce((sum, p) => sum + p.tokens, 0);
		const elapsed = startedAt ? fmtDuration(Date.now() - startedAt) : "";
		lines.push(theme.fg("muted", [
			`${succeeded}/${total} tasks completed`,
			...(elapsed ? [elapsed] : []),
			`${fmtTokens(totalTokens)} tokens`,
		].join(" · ")), "");

		for (let i = 0; i < total; i++) {
			const p = progress[i]!;
			const r = results[i];
			const icon = p.status === "done" ? theme.fg("success", "✓") : theme.fg("error", "✗");
			const stats = theme.fg("muted", ` · ${fmtDuration(p.durationMs)} · ${fmtTokens(p.tokens)} tokens`);
			lines.push(`${tree(i, total)} ${icon} ${theme.bold(p.agent)} ${theme.fg("muted", `(${trunc(p.task, 50)})`)}${stats}`);

			// Output preview
			const ind = indent(i, total);
			if (r && "output" in r && r.output?.trim() && r.output !== "(no output)") {
				const outputLines = r.output.trim().split("\n");
				const maxLines = expanded ? outputLines.length : 3;
				for (const line of outputLines.slice(0, maxLines)) lines.push(`${ind}${theme.fg("toolOutput", line)}`);
				const remaining = outputLines.length - maxLines;
				if (remaining > 0) lines.push(`${ind}${theme.fg("muted", `… ${remaining} more lines`)}`);
			} else if (r && "error" in r) {
				lines.push(`${ind}${theme.fg("error", typeof r.error === "string" ? r.error : "unknown error")}`);
			}
		}
	}

	return lines.join("\n");
}

// ── LLM text format ────────────────────────────────────────────────────────

function formatForLLM(results: PromiseSettledResult<RunResult>[], tasks: TaskEntry[]): string {
	const succeeded = results.filter((r) => r.status === "fulfilled" && !r.value.error).length;
	const parts = [`${succeeded}/${results.length} tasks completed successfully\n`];

	for (let i = 0; i < results.length; i++) {
		const r = results[i]!;
		const t = tasks[i]!;
		const header = `=== ${t.agent}: ${trunc(t.task, 80)} ===`;
		if (r.status === "fulfilled") {
			const v = r.value;
			parts.push(`${header}\n[${v.error ? `FAILED: ${v.error}` : "OK"} | ${fmtDuration(v.durationMs)} | ${fmtTokens(v.usage.total)} tokens]\n\n${v.output}`);
		} else {
			parts.push(`${header}\n[REJECTED: ${r.reason}]`);
		}
	}
	return parts.join("\n\n");
}

// ── Extension ──────────────────────────────────────────────────────────────

export default function applePi(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "delegate",
		label: "Delegate",
		description:
			"Delegate tasks to specialized agents that run in parallel with their own models and tools. " +
			"Each agent has a focused system prompt and only the tool schemas it needs, keeping context clean. " +
			"Use this when work can be split into independent pieces or when a task needs a different model/tool set.",
		parameters: Type.Object({
			tasks: Type.Array(
				Type.Object({
					agent: Type.String({ description: "Agent name (from agent definitions)" }),
					task: Type.String({ description: "Complete task instructions for this agent" }),
				}),
				{ description: "Tasks to run in parallel. Each gets its own agent instance." },
			),
		}),

		async execute(_toolCallId, params: { tasks: TaskEntry[] }, signal, onUpdate: AgentToolUpdateCallback<DelegateDetails> | undefined, ctx: ExtensionContext): Promise<AgentToolResult<DelegateDetails>> {
			const agents = discoverAgents(ctx.cwd);

			// Validate
			const unknown = [...new Set(params.tasks.map((t) => t.agent).filter((n) => !agents.has(n)))];
			if (unknown.length) {
				return { content: [{ type: "text", text: `Unknown agent(s): ${unknown.join(", ")}. Available: ${Array.from(agents.keys()).join(", ") || "none"}` }], details: { tasks: params.tasks, results: [], progress: [] } };
			}
			if (!params.tasks.length) {
				return { content: [{ type: "text", text: "No tasks provided." }], details: { tasks: params.tasks, results: [], progress: [] } };
			}

			// Progress tracking
			const progress: AgentProgress[] = params.tasks.map((t) => ({
				agent: t.agent, task: t.task, status: "pending" as const, durationMs: 0, tokens: 0, toolUses: 0,
			}));
			const fire = () => onUpdate?.({ content: [{ type: "text", text: "Running agents…" }], details: { tasks: params.tasks, results: [], progress: [...progress] } });
			fire();

			// Run parallel
			const results = await Promise.allSettled(params.tasks.map(async (t, i) => {
				const p = progress[i]!;
				p.status = "running";
				fire();
				try {
					const result = await runAgent(agents.get(t.agent)!, t.task, ctx.cwd, ctx.model, ctx.modelRegistry, signal, (u) => {
						p.tokens = u.tokens; p.toolUses = u.toolUses; p.durationMs = u.durationMs; fire();
					});
					p.status = result.error ? "failed" : "done";
					p.durationMs = result.durationMs; p.tokens = result.usage.total; p.error = result.error;
					fire();
					return result;
				} catch (err) {
					p.status = "failed"; p.error = err instanceof Error ? err.message : String(err); fire(); throw err;
				}
			}));

			return {
				content: [{ type: "text", text: formatForLLM(results, params.tasks) }],
				details: { tasks: params.tasks, results: results.map((r) => r.status === "fulfilled" ? r.value : { error: String(r.reason) }), progress },
			};
		},

		renderCall(args, theme, ctx) {
			const state = ctx.state as { startedAt?: number; interval?: ReturnType<typeof setInterval> };
			if (ctx.executionStarted && state.startedAt === undefined) state.startedAt = Date.now();
			const text = (ctx.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(renderCall(args, theme));
			return text;
		},

		renderResult(result, options, theme, ctx) {
			const state = ctx.state as { startedAt?: number; interval?: ReturnType<typeof setInterval> };
			if (options.isPartial && !state.interval) state.interval = setInterval(() => ctx.invalidate(), 1000);
			if (!options.isPartial && state.interval) { clearInterval(state.interval); state.interval = undefined; }
			const text = (ctx.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(renderResult(result as AgentToolResult<DelegateDetails>, options.isPartial, options.expanded, theme, state.startedAt));
			return text;
		},
	});
}
