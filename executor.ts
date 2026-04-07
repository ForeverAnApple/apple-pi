import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { convertToLlm, type ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { AgentConfig, RunResult } from "./types.ts";
import { buildTools } from "./tools.ts";

/** Resolve a "provider/model-id" string to a Model object, or fall back to parentModel. */
function resolveModel(
	modelStr: string | undefined,
	parentModel: any,
	registry: ModelRegistry,
) {
	if (!modelStr) return parentModel;
	const slashIdx = modelStr.indexOf("/");
	if (slashIdx === -1) {
		// Try matching just by id across all providers
		const available = registry.getAvailable();
		const match = available.find((m) => m.id === modelStr);
		return match ?? parentModel;
	}
	const provider = modelStr.slice(0, slashIdx);
	const id = modelStr.slice(slashIdx + 1);
	return registry.find(provider, id) ?? parentModel;
}

/** Extract text content from assistant messages. */
function extractOutput(messages: AgentMessage[]): string {
	const parts: string[] = [];
	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		if (!Array.isArray(msg.content)) continue;
		for (const block of msg.content) {
			if (block.type === "text" && block.text) {
				parts.push(block.text);
			}
		}
	}
	return parts.join("\n\n");
}

/** Extract usage totals from assistant messages. */
function extractUsage(messages: AgentMessage[]) {
	const usage = { input: 0, output: 0, cacheRead: 0, total: 0 };
	for (const msg of messages) {
		if (msg.role !== "assistant" || !msg.usage) continue;
		const u = msg.usage as any;
		usage.input += u.input ?? 0;
		usage.output += u.output ?? 0;
		usage.cacheRead += u.cacheRead ?? 0;
		usage.total += u.totalTokens ?? (u.input ?? 0) + (u.output ?? 0);
	}
	return usage;
}

/**
 * Run a single agent in-process.
 *
 * Creates a lightweight Agent with only the declared tools and system prompt,
 * executes the task, and returns the output.
 */
export async function runAgent(
	config: AgentConfig,
	task: string,
	cwd: string,
	parentModel: any,
	modelRegistry: ModelRegistry,
	signal?: AbortSignal,
): Promise<RunResult> {
	const start = Date.now();
	const model = resolveModel(config.model, parentModel, modelRegistry);

	if (!model) {
		return {
			agent: config.name,
			task,
			output: "",
			error: `No model available${config.model ? ` (tried: ${config.model})` : ""}`,
			durationMs: Date.now() - start,
			usage: { input: 0, output: 0, cacheRead: 0, total: 0 },
		};
	}

	const tools = buildTools(config.tools, cwd);

	const agent = new Agent({
		initialState: {
			systemPrompt: config.systemPrompt,
			model,
			thinkingLevel: config.thinking,
			tools,
		},
		convertToLlm,
		streamFn: async (m, context, options) => {
			const auth = await modelRegistry.getApiKeyAndHeaders(m);
			if (!auth.ok) {
				throw new Error(`Auth failed for ${m.provider}/${m.id}: ${auth.error}`);
			}
			return streamSimple(m, context, {
				...options,
				apiKey: auth.apiKey,
				headers: auth.headers ?? undefined,
			});
		},
	});

	// Wire abort signal
	if (signal) {
		const onAbort = () => agent.abort();
		signal.addEventListener("abort", onAbort, { once: true });
	}

	try {
		await agent.prompt(task);
		await agent.waitForIdle();

		const output = extractOutput(agent.state.messages);
		const usage = extractUsage(agent.state.messages);
		const errorMessage = agent.state.errorMessage;

		return {
			agent: config.name,
			task,
			output: output || "(no output)",
			error: errorMessage,
			durationMs: Date.now() - start,
			usage,
		};
	} catch (err) {
		return {
			agent: config.name,
			task,
			output: "",
			error: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - start,
			usage: { input: 0, output: 0, cacheRead: 0, total: 0 },
		};
	}
}
