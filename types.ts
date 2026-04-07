import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

/** Parsed agent definition from markdown frontmatter + body. */
export interface AgentConfig {
	name: string;
	description: string;
	model?: string;
	thinking: ThinkingLevel;
	tools: string[];
	systemPrompt: string;
	source: "bundled" | "user" | "project";
	filePath: string;
}

/** Result from a single agent execution. */
export interface RunResult {
	agent: string;
	task: string;
	output: string;
	error?: string;
	durationMs: number;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		total: number;
	};
}
