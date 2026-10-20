/**
 * Print URLs to open Rush Pilot from Windows when WSL localhost fails.
 *   npm run show-urls
 */
import { execSync } from "node:child_process";
import "../src/bootstrap-env.js";
import { loadConfig } from "../src/config.js";

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok || res.status === 307 || res.status === 308;
  } catch {
    return false;
  }
}

async function main() {
  const cfg = loadConfig();
  const dashPort = 43123;
  const apiPort = cfg.AUTOMATION_API_PORT;

  let wslIp = "";
  try {
    wslIp = execSync("hostname -I", { encoding: "utf8" }).trim().split(/\s+/)[0] ?? "";
  } catch {
    /* ignore */
  }

  console.log("=== Rush Pilot URLs ===\n");
  console.log("Try these in Chrome (with npm run dev running):\n");
  console.log(`  1. http://127.0.0.1:${dashPort}`);
  console.log(`  2. http://localhost:${dashPort}`);
  if (wslIp) {
    console.log(`  3. http://${wslIp}:${dashPort}   ← often works from Windows when 1–2 fail`);
  }

  console.log("\nProbes from inside Ubuntu:");
  for (const url of [
    `http://127.0.0.1:${dashPort}`,
    `http://localhost:${dashPort}`,
    ...(wslIp ? [`http://${wslIp}:${dashPort}`] : []),
  ]) {
    const ok = await probe(url);
    console.log(`  ${ok ? "OK" : "FAIL"}  ${url}`);
  }

  const apiOk = await probe(`http://127.0.0.1:${apiPort}/health`);
  console.log(`\nAPI health (43124): ${apiOk ? "OK" : "FAIL — is npm run dev running?"}`);
}

main();
