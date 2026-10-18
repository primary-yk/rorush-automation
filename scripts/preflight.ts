/**
 * One command sanity check before relying on rain join.
 *   npm run preflight
 */
import { spawnSync } from "node:child_process";

const steps: Array<{ name: string; cmd: string[] }> = [
  { name: "doctor", cmd: ["npm", "run", "doctor"] },
  { name: "unit tests", cmd: ["npm", "test"] },
];

let failed = false;
for (const step of steps) {
  console.log(`\n=== ${step.name} ===\n`);
  const r = spawnSync(step.cmd[0]!, step.cmd.slice(1), { stdio: "inherit", shell: false });
  if (r.status !== 0) failed = true;
}

if (failed) {
  console.error("\nPreflight failed — fix the steps above before expecting rain join to work.");
  process.exit(1);
}
console.log("\nPreflight OK. Keep one `npm run dev` running during rain.");
