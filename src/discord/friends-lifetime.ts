import type { AccountRow } from "../db/repositories.js";

export type LifetimeBreakdown = {
  rain: number;
  cases: number;
  codes: number;
  total: number;
};

export function lifetimeBreakdown(
  a: Pick<AccountRow, "lifetime_rain" | "lifetime_cases" | "lifetime_codes">,
): LifetimeBreakdown {
  const rain = a.lifetime_rain ?? 0;
  const cases = a.lifetime_cases ?? 0;
  const codes = a.lifetime_codes ?? 0;
  return { rain, cases, codes, total: rain + cases + codes };
}

export function sumLifetimeBreakdown(accounts: AccountRow[]): LifetimeBreakdown {
  let rain = 0;
  let cases = 0;
  let codes = 0;
  for (const a of accounts) {
    const b = lifetimeBreakdown(a);
    rain += b.rain;
    cases += b.cases;
    codes += b.codes;
  }
  return { rain, cases, codes, total: rain + cases + codes };
}

export function formatLifetimeShort(b: LifetimeBreakdown): string {
  if (b.total <= 0) return "Lifetime **0.00** coins";
  return (
    `Lifetime **${b.total.toFixed(2)}** coins · rain ${b.rain.toFixed(2)} · cases ${b.cases.toFixed(2)} · codes ${b.codes.toFixed(2)}`
  );
}

export function formatLifetimeCompact(b: LifetimeBreakdown): string {
  return `${b.total.toFixed(2)} (R${b.rain.toFixed(0)}/C${b.cases.toFixed(0)}/K${b.codes.toFixed(0)})`;
}

/** Discord user id → summed lifetime for all their accounts. */
export function lifetimeByDiscordOwner(accounts: AccountRow[]): Map<string, LifetimeBreakdown> {
  const map = new Map<string, LifetimeBreakdown>();
  for (const a of accounts) {
    const owner = a.owner_discord_id?.trim();
    if (!owner) continue;
    const prev = map.get(owner) ?? { rain: 0, cases: 0, codes: 0, total: 0 };
    const b = lifetimeBreakdown(a);
    map.set(owner, {
      rain: prev.rain + b.rain,
      cases: prev.cases + b.cases,
      codes: prev.codes + b.codes,
      total: prev.total + b.total,
    });
  }
  return map;
}
