import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTools, ALL_TOOL_NAMES } from "../tools.ts";

describe("buildTools", () => {
	it("returns empty array for empty names", () => {
		const tools = buildTools([], "/tmp");
		assert.equal(tools.length, 0);
	});

	it("skips unknown tool names", () => {
		const tools = buildTools(["read", "nonexistent", "grep"], "/tmp");
		assert.equal(tools.length, 2);
		assert.equal(tools[0]!.name, "read");
		assert.equal(tools[1]!.name, "grep");
	});

	it("creates all 7 built-in tools", () => {
		const tools = buildTools(ALL_TOOL_NAMES, "/tmp");
		assert.equal(tools.length, 7);
		const names = tools.map((t) => t.name).sort();
		assert.deepEqual(names, ["bash", "edit", "find", "grep", "ls", "read", "write"]);
	});

	it("each tool has required AgentTool fields", () => {
		const tools = buildTools(["read"], "/tmp");
		const tool = tools[0]!;
		assert.ok(tool.name, "should have name");
		assert.ok(tool.label, "should have label");
		assert.ok(tool.description, "should have description");
		assert.ok(tool.parameters, "should have parameters schema");
		assert.ok(typeof tool.execute === "function", "should have execute function");
	});
});

describe("ALL_TOOL_NAMES", () => {
	it("has 7 entries", () => {
		assert.equal(ALL_TOOL_NAMES.length, 7);
	});

	it("includes core tools", () => {
		assert.ok(ALL_TOOL_NAMES.includes("read"));
		assert.ok(ALL_TOOL_NAMES.includes("bash"));
		assert.ok(ALL_TOOL_NAMES.includes("edit"));
		assert.ok(ALL_TOOL_NAMES.includes("write"));
	});
});
