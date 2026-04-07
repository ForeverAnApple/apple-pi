import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
	createReadTool,
	createBashTool,
	createEditTool,
	createWriteTool,
	createGrepTool,
	createFindTool,
	createLsTool,
} from "@mariozechner/pi-coding-agent";

const FACTORIES: Record<string, (cwd: string) => AgentTool<any>> = {
	read: createReadTool,
	bash: createBashTool,
	edit: createEditTool,
	write: createWriteTool,
	grep: createGrepTool,
	find: createFindTool,
	ls: createLsTool,
};

export const ALL_TOOL_NAMES = Object.keys(FACTORIES);

/**
 * Build AgentTool instances for the given tool names.
 * Unknown names are silently skipped.
 */
export function buildTools(names: string[], cwd: string): AgentTool<any>[] {
	const tools: AgentTool<any>[] = [];
	for (const name of names) {
		const factory = FACTORIES[name];
		if (factory) {
			tools.push(factory(cwd));
		}
	}
	return tools;
}
