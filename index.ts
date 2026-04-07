import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { discoverAgents } from "./agents.ts";
import { runAgent } from "./executor.ts";
import type { RunResult } from "./types.ts";

// ── Types ──────────────────────────────────────────────────────────────────

interface TaskEntry {
	agent: string;
	task: string;
}

interface DelegateDetails {
	tasks: TaskEntry[];
	results: (RunResult | { error: string })[];
	progress: AgentProgress[];
}

interface AgentProgress {
	agent: string;
	task: string;
	status: "pending" | "running" | "done" | "failed";
	durationMs: number;
	tokens: number;
	toolUses: number;
	error?: string;
}

type DelegateRenderState = {
	startedAt: number | undefined;
	interval: ReturnType<typeof setInterval> | undefined;
};

// ── Formatting helpers ─────────────────────────────────────────────────────

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	const rem = Math.round(s % 60);
	return `${m}m${rem}s`;
}

function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	return `${Math.round(n / 1000)}k`;
}

function truncTask(task: string, maxLen: number): string {
	if (task.length <= maxLen) return task;
	return task.slice(0, maxLen - 1) + "…";
}

function treeChar(index: number, total: number): string {
	return index === total - 1 ? "└─" : "├─";
}

function treeIndent(index: number, total: number): string {
	return index === total - 1 ? "   " : "│  ";
}

// ── Renderers ──────────────────────────────────────────────────────────────

function renderDelegateCall(
	args: { tasks?: TaskEntry[] } | undefined,
	theme: Theme,
): string {
	const tasks = args?.tasks;
	if (!tasks || tasks.length === 0) return theme.fg("toolTitle", theme.bold("delegate"));

	const lines: string[] = [];
	lines.push(theme.fg("toolTitle", theme.bold(`delegate ${tasks.length} task${tasks.length > 1 ? "s" : ""}`)));

	for (let i = 0; i < tasks.length; i++) {
		const t = tasks[i]!;
		const tree = treeChar(i, tasks.length);
		const name = theme.bold(t.agent);
		const desc = theme.fg("muted", truncTask(t.task, 60));
		lines.push(`${tree} ${name} ${desc}`);
	}

	return lines.join("\n");
}

function renderDelegateResult(
	result: AgentToolResult<DelegateDetails>,
	isPartial: boolean,
	expanded: boolean,
	theme: Theme,
	startedAt: number | undefined,
): string {
	const details = result.details;
	if (!details) {
		// Fallback to text content
		const text = result.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n");
		return text ? `\n${text}` : "";
	}

	const progress = details.progress;
	if (!progress || progress.length === 0) return "";

	const lines: string[] = [""];
	const total = progress.length;

	if (isPartial) {
		// ── In-progress view ──
		const done = progress.filter((p) => p.status === "done" || p.status === "failed").length;
		const elapsed = startedAt ? formatDuration(Date.now() - startedAt) : "";
		lines.push(
			theme.fg("muted", `Running ${total} agent${total > 1 ? "s" : ""}…`) +
			(elapsed ? theme.fg("muted", ` · ${elapsed}`) : ""),
		);
		lines.push("");

		for (let i = 0; i < total; i++) {
			const p = progress[i]!;
			const tree = treeChar(i, total);

			if (p.status === "done") {
				const stats = theme.fg("muted", ` · ${formatDuration(p.durationMs)} · ${formatTokens(p.tokens)} tokens`);
				lines.push(`${tree} ${theme.fg("success", "✓")} ${theme.bold(p.agent)}${stats}`);
			} else if (p.status === "failed") {
				const err = p.error ? theme.fg("error", ` ${p.error}`) : "";
				lines.push(`${tree} ${theme.fg("error", "✗")} ${theme.bold(p.agent)}${err}`);
			} else if (p.status === "running") {
				const stats = p.toolUses > 0
					? theme.fg("muted", ` · ${p.toolUses} tool use${p.toolUses > 1 ? "s" : ""} · ${formatTokens(p.tokens)} tokens`)
					: "";
				lines.push(`${tree} ${theme.fg("warning", "●")} ${theme.bold(p.agent)}${stats}`);
			} else {
				lines.push(`${tree} ${theme.fg("muted", "○")} ${theme.bold(p.agent)} ${theme.fg("muted", "waiting…")}`);
			}
		}

		if (done > 0 && done < total) {
			lines.push("");
			lines.push(theme.fg("muted", `${done}/${total} complete`));
		}
	} else {
		// ── Final view ──
		const succeeded = progress.filter((p) => p.status === "done").length;
		const totalTokens = progress.reduce((sum, p) => sum + p.tokens, 0);
		const totalDuration = startedAt ? formatDuration(Date.now() - startedAt) : "";

		const headerParts = [`${succeeded}/${total} tasks completed`];
		if (totalDuration) headerParts.push(totalDuration);
		headerParts.push(`${formatTokens(totalTokens)} tokens`);

		lines.push(theme.fg("muted", headerParts.join(" · ")));
		lines.push("");

		const results = details.results;

		for (let i = 0; i < total; i++) {
			const p = progress[i]!;
			const r = results[i];
			const tree = treeChar(i, total);
			const indent = treeIndent(i, total);

			// Status + agent + stats
			const icon = p.status === "done"
				? theme.fg("success", "✓")
				: theme.fg("error", "✗");
			const stats = theme.fg("muted", ` · ${formatDuration(p.durationMs)} · ${formatTokens(p.tokens)} tokens`);
			const taskPreview = theme.fg("muted", `(${truncTask(p.task, 50)})`);
			lines.push(`${tree} ${icon} ${theme.bold(p.agent)} ${taskPreview}${stats}`);

			// Output preview
			if (r && "output" in r && r.output) {
				const output = r.output.trim();
				if (output && output !== "(no output)") {
					const outputLines = output.split("\n");
					const maxLines = expanded ? outputLines.length : 3;
					const preview = outputLines.slice(0, maxLines);
					for (const line of preview) {
						lines.push(`${indent}${theme.fg("toolOutput", line)}`);
					}
					const remaining = outputLines.length - maxLines;
					if (remaining > 0) {
						lines.push(`${indent}${theme.fg("muted", `… ${remaining} more lines`)}`);
					}
				}
			} else if (r && "error" in r) {
				const errMsg = typeof r.error === "string" ? r.error : "unknown error";
				lines.push(`${indent}${theme.fg("error", errMsg)}`);
			}
		}
	}

	return lines.join("\n");
}

// ── Format results for parent LLM (text content) ──────────────────────────

function formatResultsForLLM(
	results: PromiseSettledResult<RunResult>[],
	tasks: TaskEntry[],
): string {
	const parts: string[] = [];
	const succeeded = results.filter((r) => r.status === "fulfilled" && !r.value.error).length;

	parts.push(`${succeeded}/${results.length} tasks completed successfully\n`);

	for (let i = 0; i < results.length; i++) {
		const r = results[i]!;
		const t = tasks[i]!;
		const header = `=== ${t.agent}: ${truncTask(t.task, 80)} ===`;

		if (r.status === "fulfilled") {
			const v = r.value;
			const status = v.error ? `FAILED: ${v.error}` : "OK";
			const meta = `[${status} | ${formatDuration(v.durationMs)} | ${formatTokens(v.usage.total)} tokens]`;
			parts.push(`${header}\n${meta}\n\n${v.output}`);
		} else {
			parts.push(`${header}\n[REJECTED: ${r.reason}]`);
		}
	}

	return parts.join("\n\n");
}

// ── Extension entry ────────────────────────────────────────────────────────

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

		async execute(
			_toolCallId: string,
			params: { tasks: TaskEntry[] },
			signal: AbortSignal | undefined,
			onUpdate: AgentToolUpdateCallback<DelegateDetails> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<DelegateDetails>> {
			const agents = discoverAgents(ctx.cwd);

			// Validate agent names
			const unknownAgents = params.tasks
				.map((t) => t.agent)
				.filter((name) => !agents.has(name));

			if (unknownAgents.length > 0) {
				const available = Array.from(agents.keys()).join(", ") || "none";
				return {
					content: [{ type: "text", text: `Unknown agent(s): ${[...new Set(unknownAgents)].join(", ")}. Available: ${available}` }],
					details: { tasks: params.tasks, results: [], progress: [] },
				};
			}

			if (params.tasks.length === 0) {
				return {
					content: [{ type: "text", text: "No tasks provided." }],
					details: { tasks: params.tasks, results: [], progress: [] },
				};
			}

			// Initialize progress tracking
			const progress: AgentProgress[] = params.tasks.map((t) => ({
				agent: t.agent,
				task: t.task,
				status: "pending" as const,
				durationMs: 0,
				tokens: 0,
				toolUses: 0,
			}));

			const fireUpdate = () => {
				if (!onUpdate) return;
				onUpdate({
					content: [{ type: "text", text: "Running agents…" }],
					details: { tasks: params.tasks, results: [], progress: [...progress] },
				});
			};

			// Send initial progress
			fireUpdate();

			// Run all tasks in parallel with progress tracking
			const results = await Promise.allSettled(
				params.tasks.map(async (t, i) => {
					progress[i]!.status = "running";
					fireUpdate();

					try {
						const result = await runAgent(
							agents.get(t.agent)!,
							t.task,
							ctx.cwd,
							ctx.model,
							ctx.modelRegistry,
							signal,
							(update) => {
								// Agent reports intermediate progress
								progress[i]!.tokens = update.tokens;
								progress[i]!.toolUses = update.toolUses;
								progress[i]!.durationMs = update.durationMs;
								fireUpdate();
							},
						);

						progress[i]!.status = result.error ? "failed" : "done";
						progress[i]!.durationMs = result.durationMs;
						progress[i]!.tokens = result.usage.total;
						progress[i]!.error = result.error;
						fireUpdate();

						return result;
					} catch (err) {
						progress[i]!.status = "failed";
						progress[i]!.error = err instanceof Error ? err.message : String(err);
						fireUpdate();
						throw err;
					}
				}),
			);

			const summary = formatResultsForLLM(results, params.tasks);
			const finalResults = results.map((r) =>
				r.status === "fulfilled" ? r.value : { error: String(r.reason) },
			);

			return {
				content: [{ type: "text", text: summary }],
				details: { tasks: params.tasks, results: finalResults, progress },
			};
		},

		renderCall(args, theme, context) {
			const state = context.state as DelegateRenderState;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
			}
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(renderDelegateCall(args, theme));
			return text;
		},

		renderResult(result, options, theme, context) {
			const state = context.state as DelegateRenderState;

			// Tick elapsed timer during execution
			if (options.isPartial && !state.interval) {
				state.interval = setInterval(() => context.invalidate(), 1000);
			}
			if (!options.isPartial) {
				if (state.interval) {
					clearInterval(state.interval);
					state.interval = undefined;
				}
			}

			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(renderDelegateResult(
				result as AgentToolResult<DelegateDetails>,
				options.isPartial,
				options.expanded,
				theme,
				state.startedAt,
			));
			return text;
		},
	});
}
