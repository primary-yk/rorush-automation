import { encryptField, decryptField } from "../accounts/session-manager.js";
import { getDb } from "../db/database.js";
import { licenseDevSkip, parseLicenseKey, type LicensePayload } from "./verify.js";
import { reloadEnv } from "../config.js";

export type DiscordSeatRow = {
  discord_user_id: string;
  license_id: string;
  plan: string;
  exp: number;
  license_key_enc: string;
  license_payload_json: string;
  activated_at: string;
};

function hostedSaasEnforced(): boolean {
  reloadEnv();
  if (licenseDevSkip()) return false;
  const v = process.env.HOSTED_SAAS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function isHostedSaasMode(): boolean {
  return hostedSaasEnforced();
}

export function activateDiscordSeat(discordUserId: string, key: string): {
  ok: boolean;
  message: string;
  plan?: string;
  expiresAt?: string;
} {
  const { payload, raw } = parseLicenseKey(key);
  if (payload.discordUserId && payload.discordUserId !== discordUserId) {
    return { ok: false, message: "This key is locked to a different Discord account." };
  }
  if (payload.exp * 1000 < Date.now()) {
    return { ok: false, message: "License expired." };
  }

  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO discord_user_licenses (discord_user_id, license_id, plan, exp, license_key_enc, license_payload_json, activated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(discord_user_id) DO UPDATE SET
         license_id = excluded.license_id,
         plan = excluded.plan,
         exp = excluded.exp,
         license_key_enc = excluded.license_key_enc,
         license_payload_json = excluded.license_payload_json,
         activated_at = excluded.activated_at`,
    )
    .run(
      discordUserId,
      payload.id,
      payload.plan,
      payload.exp,
      encryptField(raw)!,
      JSON.stringify(payload),
      now,
    );

  return {
    ok: true,
    message: "License active.",
    plan: payload.plan,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

function readSeat(discordUserId: string): DiscordSeatRow | undefined {
  return getDb()
    .prepare("SELECT * FROM discord_user_licenses WHERE discord_user_id = ?")
    .get(discordUserId) as DiscordSeatRow | undefined;
}

export function isDiscordSeatActive(discordUserId: string, hostUserId?: string | null): boolean {
  if (!hostedSaasEnforced()) return true;
  if (hostUserId && discordUserId === hostUserId) return true;
  const row = readSeat(discordUserId);
  if (!row) return false;
  if (row.exp * 1000 < Date.now()) {
    getDb().prepare("DELETE FROM discord_user_licenses WHERE discord_user_id = ?").run(discordUserId);
    return false;
  }
  try {
    const key = decryptField(row.license_key_enc);
    if (!key) return false;
    parseLicenseKey(key);
    return true;
  } catch {
    return false;
  }
}

export function discordSeatStatus(discordUserId: string): string {
  if (!hostedSaasEnforced()) return "Hosted SaaS licensing is off (friends/dev mode).";
  const row = readSeat(discordUserId);
  if (!row) return "No license — use `/license redeem` with your purchase key.";
  if (row.exp * 1000 < Date.now()) return "License expired — contact the seller for a new key.";
  return `Active · **${row.plan}** · expires ${new Date(row.exp * 1000).toISOString()}`;
}

export function revalidateDiscordSeats(): void {
  if (!hostedSaasEnforced()) return;
  const now = Date.now();
  const rows = getDb().prepare("SELECT discord_user_id, exp FROM discord_user_licenses").all() as Array<{
    discord_user_id: string;
    exp: number;
  }>;
  for (const r of rows) {
    if (r.exp * 1000 < now) {
      getDb().prepare("DELETE FROM discord_user_licenses WHERE discord_user_id = ?").run(r.discord_user_id);
    }
  }
}
