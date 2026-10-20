import crypto from "node:crypto";

export function issueLicenseKey(input: {
  privateKeyPem: string;
  id?: string;
  plan?: string;
  days?: number;
  discordUserId?: string;
}): { key: string; exp: number; id: string; plan: string } {
  const days = input.days ?? 365;
  const id = input.id ?? `cust-${Date.now()}`;
  const plan = input.plan ?? "standard";
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const payload = {
    v: 1 as const,
    id,
    plan,
    exp,
    ...(input.discordUserId ? { discordUserId: input.discordUserId } : {}),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = Buffer.from(`RP1.${payloadB64}`);
  const sig = crypto.sign(null, data, crypto.createPrivateKey(input.privateKeyPem)).toString("base64url");
  const key = `RP1.${payloadB64}.${sig}`;
  return { key, exp, id, plan };
}
