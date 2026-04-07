import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { discoverAgents } from "../agents.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apple-pi-test-"));
	tempDirs.push(dir);
	return dir;
}

function writeAgent(dir: string, filename: string, content: string): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, filename), content, "utf-8");
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()!;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("agent discovery", () => {
	it("loads bundled agents", () => {
		const agents = discoverAgents("/nonexistent");
		assert.ok(agents.has("scout"), "should have bundled scout");
		assert.ok(agents.has("worker"), "should have bundled worker");
	});

	it("parses frontmatter fields correctly", () => {
		const agents = discoverAgents("/nonexistent");
		const scout = agents.get("scout")!;

		assert.equal(scout.name, "scout");
		assert.ok(scout.description.length > 0);
		assert.equal(scout.model, "anthropic/claude-haiku-4-5");
		assert.equal(scout.thinking, "off");
		assert.deepEqual(scout.tools, ["read", "grep", "find", "ls"]);
		assert.ok(scout.systemPrompt.length > 0);
		assert.equal(scout.source, "bundled");
	});

	it("project agents override bundled", () => {
		const dir = makeTempDir();
		const agentsDir = path.join(dir, ".pi", "agents");
		writeAgent(agentsDir, "scout.md", `---
name: scout
description: Custom project scout
model: anthropic/claude-sonnet-4
thinking: high
tools: read, bash
---
Custom scout prompt.
`);

		const agents = discoverAgents(dir);
		const scout = agents.get("scout")!;

		assert.equal(scout.source, "project");
		assert.equal(scout.description, "Custom project scout");
		assert.equal(scout.model, "anthropic/claude-sonnet-4");
		assert.equal(scout.thinking, "high");
		assert.deepEqual(scout.tools, ["read", "bash"]);
		assert.equal(scout.systemPrompt, "Custom scout prompt.");
	});

	it("skips files without required frontmatter", () => {
		const dir = makeTempDir();
		const agentsDir = path.join(dir, ".pi", "agents");
		writeAgent(agentsDir, "bad.md", `---
name: incomplete
---
No description field.
`);

		const agents = discoverAgents(dir);
		assert.ok(!agents.has("incomplete"));
	});

	it("defaults tools to all when not specified", () => {
		const dir = makeTempDir();
		const agentsDir = path.join(dir, ".pi", "agents");
		writeAgent(agentsDir, "minimal.md", `---
name: minimal
description: Minimal agent
---
Just a prompt.
`);

		const agents = discoverAgents(dir);
		const minimal = agents.get("minimal")!;
		assert.ok(minimal.tools.length === 7, "should default to all 7 tools");
	});

	it("defaults thinking to off when not specified", () => {
		const dir = makeTempDir();
		const agentsDir = path.join(dir, ".pi", "agents");
		writeAgent(agentsDir, "basic.md", `---
name: basic
description: Basic agent
---
Prompt.
`);

		const agents = discoverAgents(dir);
		assert.equal(agents.get("basic")!.thinking, "off");
	});
});
