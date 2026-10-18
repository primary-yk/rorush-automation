import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

const args = process.argv.slice(2);
const daysIdx = args.indexOf("--days");
const idIdx = args.indexOf("--id");
const planIdx = args.indexOf("--plan");
const discordIdx = args.indexOf("--discord-user");

const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 365;
const id = idIdx >= 0 ? String(args[idIdx + 1]) : `cust-${Date.now()}`;
const plan = planIdx >= 0 ? String(args[planIdx + 1]) : "standard";
const discordUserId = discordIdx >= 0 ? String(args[discordIdx + 1]) : undefined;

const privPem = process.env.LICENSE_PRIVATE_KEY?.trim();
if (!privPem) {
  console.error("Set LICENSE_PRIVATE_KEY in .env (run: npx tsx scripts/license-keygen.ts first).");
  process.exit(1);
}

const exp = Math.floor(Date.now() / 1000) + days * 86400;
const payload = {
  v: 1 as const,
  id,
  plan,
  exp,
  ...(discordUserId ? { discordUserId } : {}),
};
const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
const data = Buffer.from(`RP1.${payloadB64}`);
const sig = crypto.sign(null, data, crypto.createPrivateKey(privPem)).toString("base64url");
const key = `RP1.${payloadB64}.${sig}`;

console.log("License key (give to customer):\n");
console.log(key);
console.log(`\nExpires: ${new Date(exp * 1000).toISOString()} · Plan: ${plan} · Id: ${id}`);
