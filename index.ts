import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { discoverAgents } from "./agents.ts";
import { runAgent } from "./executor.ts";
import type { RunResult } from "./types.ts";

/** Format parallel results into a readable summary for the parent LLM. */
function formatResults(
	results: PromiseSettledResult<RunResult>[],
	tasks: Array<{ agent: string; task: string }>,
): string {
	const parts: string[] = [];
	const succeeded = results.filter((r) => r.status === "fulfilled" && !r.value.error).length;

	parts.push(`${succeeded}/${results.length} tasks completed successfully\n`);

	for (let i = 0; i < results.length; i++) {
		const r = results[i]!;
		const t = tasks[i]!;
		const header = `=== ${t.agent}: ${t.task.slice(0, 80)}${t.task.length > 80 ? "…" : ""} ===`;

		if (r.status === "fulfilled") {
			const v = r.value;
			const status = v.error ? `FAILED: ${v.error}` : "OK";
			const meta = `[${status} | ${v.durationMs}ms | ${v.usage.total} tokens]`;
			parts.push(`${header}\n${meta}\n\n${v.output}`);
		} else {
			parts.push(`${header}\n[REJECTED: ${r.reason}]`);
		}
	}

	return parts.join("\n\n");
}

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
			params: { tasks: Array<{ agent: string; task: string }> },
			signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<any>> {
			const agents = discoverAgents(ctx.cwd);

			// Validate all agent names upfront
			const unknownAgents = params.tasks
				.map((t) => t.agent)
				.filter((name) => !agents.has(name));

			if (unknownAgents.length > 0) {
				const available = Array.from(agents.keys()).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Unknown agent(s): ${[...new Set(unknownAgents)].join(", ")}. Available: ${available}`,
						},
					],
					details: {},
				};
			}

			if (params.tasks.length === 0) {
				return {
					content: [{ type: "text", text: "No tasks provided." }],
					details: {},
				};
			}

			// Run all tasks in parallel
			const results = await Promise.allSettled(
				params.tasks.map((t) =>
					runAgent(
						agents.get(t.agent)!,
						t.task,
						ctx.cwd,
						ctx.model,
						ctx.modelRegistry,
						signal,
					),
				),
			);

			const summary = formatResults(results, params.tasks);

			return {
				content: [{ type: "text", text: summary }],
				details: {
					results: results.map((r) =>
						r.status === "fulfilled" ? r.value : { error: String(r.reason) },
					),
				},
			};
		},
	});
}
