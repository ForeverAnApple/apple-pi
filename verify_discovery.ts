import { discoverAgents } from "./agents.ts";
import path from "node:path";

const agents = discoverAgents(process.cwd());
console.log("Discovered agents:");
for (const [name, config] of agents) {
  console.log(`- ${name} (source: ${config.source}, path: ${config.filePath})`);
}

if (agents.has("my_worker")) {
  console.log("\nSUCCESS: 'my_worker' was discovered!");
} else {
  console.log("\nFAILURE: 'my_worker' was NOT discovered.");
  process.exit(1);
}
