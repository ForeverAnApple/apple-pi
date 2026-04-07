import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentConfig } from "./types.ts";
import { ALL_TOOL_NAMES } from "./tools.ts";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

/** Parse YAML-ish frontmatter from markdown content. */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { frontmatter: {}, body: content.trim() };

	const raw = match[1]!;
	const body = match[2]!.trim();
	const frontmatter: Record<string, string> = {};

	for (const line of raw.split("\n")) {
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (key) frontmatter[key] = value;
	}

	return { frontmatter, body };
}

/** Parse a single markdown file into an AgentConfig. Returns null if invalid. */
function parseAgentFile(filePath: string, source: AgentConfig["source"]): AgentConfig | null {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}

	const { frontmatter, body } = parseFrontmatter(content);
	if (!frontmatter.name || !frontmatter.description) return null;

	const tools = frontmatter.tools
		? frontmatter.tools.split(",").map((t) => t.trim()).filter(Boolean)
		: ALL_TOOL_NAMES;

	const thinking = THINKING_LEVELS.has(frontmatter.thinking ?? "")
		? (frontmatter.thinking as ThinkingLevel)
		: "off";

	return {
		name: frontmatter.name,
		description: frontmatter.description,
		model: frontmatter.model || undefined,
		thinking,
		tools,
		systemPrompt: body,
		source,
		filePath,
	};
}

/** Load all agent .md files from a directory. */
function loadFromDir(dir: string, source: AgentConfig["source"]): AgentConfig[] {
	if (!fs.existsSync(dir)) return [];

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const agents: AgentConfig[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md") || entry.name.endsWith(".chain.md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		const config = parseAgentFile(path.join(dir, entry.name), source);
		if (config) agents.push(config);
	}
	return agents;
}

/** Walk up from cwd looking for .pi/agents/ directory. */
function findProjectAgentsDir(cwd: string): string | null {
	let dir = cwd;
	while (true) {
		const candidate = path.join(dir, ".pi", "agents");
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

const BUNDLED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "agents");

/**
 * Discover agents from bundled, user, and project directories.
 * Project > User > Bundled priority. Name-based dedup.
 */
export function discoverAgents(cwd: string): Map<string, AgentConfig> {
	const userDir = path.join(os.homedir(), ".pi", "agent", "agents");
	const projectDir = findProjectAgentsDir(cwd);

	// Load in priority order: project first, then user, then bundled
	const project = projectDir ? loadFromDir(projectDir, "project") : [];
	const user = loadFromDir(userDir, "user");
	const bundled = loadFromDir(BUNDLED_DIR, "bundled");

	const agents = new Map<string, AgentConfig>();
	for (const list of [project, user, bundled]) {
		for (const agent of list) {
			if (!agents.has(agent.name)) {
				agents.set(agent.name, agent);
			}
		}
	}
	return agents;
}
