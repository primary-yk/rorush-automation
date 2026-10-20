/**
 * Fetch RoRush's current hCaptcha sitekey from the public _app bundle (no API key needed).
 *
 *   npm run discover-captcha
 */
import "../src/bootstrap-env.js";

const DEFAULT = "d5eed048-d092-4296-8496-a040aaccc710";
const SITE_URL = process.env.RORUSH_SITE_URL ?? "https://rorush.com/";

async function main() {
  const html = await fetch(SITE_URL).then((r) => r.text());
  const appMatch = html.match(/\/_next\/static\/chunks\/pages\/_app-[a-f0-9]+\.js/);
  if (!appMatch) {
    console.error("Could not find _app chunk in homepage HTML — RoRush layout may have changed.");
    process.exit(1);
  }
  const appUrl = new URL(appMatch[0], SITE_URL).href;
  const js = await fetch(appUrl).then((r) => r.text());
  const keys = [...js.matchAll(/sitekey\s*:\s*"([a-f0-9-]{36})"/gi)].map((m) => m[1]);
  if (keys.length === 0) {
    const fallback = js.match(/\bv="([a-f0-9-]{36})"/);
    if (fallback) keys.push(fallback[1]);
  }
  const unique = [...new Set(keys.filter(Boolean))];
  console.log("RoRush page:", SITE_URL);
  console.log("_app bundle:", appUrl);
  console.log("Site keys found:", unique.length ? unique.join(", ") : "(none — check manually in DevTools)");
  const envKey = process.env.RORUSH_HCAPTCHA_SITEKEY?.trim();
  if (envKey) console.log("Your RORUSH_HCAPTCHA_SITEKEY:", envKey);
  const primary = unique[0] ?? DEFAULT;
  console.log("Built-in default in Rush Pilot:", DEFAULT);
  if (primary === DEFAULT) {
    console.log("\nOK — live sitekey matches Rush Pilot default (no .env override needed).");
  } else if (unique.includes(DEFAULT)) {
    console.log("\nNote — bundle lists multiple keys; default still present.");
  } else {
    console.log("\nACTION — set in .env:");
    console.log(`RORUSH_HCAPTCHA_SITEKEY=${primary}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
