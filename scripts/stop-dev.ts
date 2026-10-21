/**
 * List (and optionally stop) duplicate `npm run dev` processes on this machine.
 *   npm run stop-dev
 *   npm run stop-dev -- --kill
 */
import { execSync } from "node:child_process";

const kill = process.argv.includes("--kill");
const pattern = "tsx watch src/main|dist/main.js";

let lines: string[] = [];
try {
  lines = execSync(`pgrep -af "${pattern}" 2>/dev/null || true`, { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
} catch {
  lines = [];
}

if (lines.length === 0) {
  console.log("No Rush Pilot dev process found (tsx watch src/main / dist/main.js).");
  process.exit(0);
}

console.log(`Found ${lines.length} dev process(es):\n`);
for (const line of lines) console.log(" ", line);

if (lines.length === 1) {
  console.log("\nOnly one — OK to leave running.");
  process.exit(0);
}

if (!kill) {
  console.log("\nMore than one — Discord slash commands may break.");
  console.log("Stop extras manually (Ctrl+C in those terminals), or run:");
  console.log("  npm run stop-dev -- --kill");
  process.exit(1);
}

execSync(`pkill -f "${pattern}" || true`);
console.log("\nSent stop signal. Wait a few seconds, then start once: npm run dev");
