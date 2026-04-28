import { discoverAgents } from "./agents.ts";
import path from "node:path";

const agents = discoverAgents(process.cwd());
console.log("Discovered agents configuration:");
for (const [name, config] of agents) {
  console.log(`- ${name}: model=${config.model === undefined ? "undefined (will inherit)" : config.model}`);
}

if (agents.has("my_worker") && agents.get("my_worker")?.model === undefined &&
    agents.has("scout") && agents.get("scout")?.model === undefined &&
    agents.has("worker") && agents.get("worker")?.model === undefined) {
  console.log("\nSUCCESS: All agents are set to inherit the main agent model.");
} else {
  console.log("\nFAILURE: Some agents are not set to inherit the main agent model.");
  process.exit(1);
}
