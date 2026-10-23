import { describe, expect, it } from "vitest";
import {
  parseVaultLockPreset,
  VAULT_LOCK_PRESETS,
  vaultLockApiDurationFromMinutes,
} from "../src/rorush/vault-lock.js";
import { parseVaultUnlockAt } from "../src/rorush/vault-unlock.js";
import { isVaultLockActive, vaultLockExpiresAtIso } from "../src/rorush/vault.js";

describe("vault-lock presets", () => {
  it("parses UI durations", () => {
    expect(parseVaultLockPreset("10m")).toBe(VAULT_LOCK_PRESETS["10m"]);
    expect(parseVaultLockPreset("1 hour")).toBe(60);
    expect(parseVaultLockPreset("1d")).toBe(1440);
    expect(parseVaultLockPreset("off")).toBe(0);
  });

  it("parses vault unlock timestamps from RoRush lock/info bodies", () => {
    expect(parseVaultUnlockAt("2026-10-21T20:17:00.000Z")).toBe("2026-10-21T20:17:00.000Z");
    expect(parseVaultUnlockAt({ unlockAt: "2026-10-21T20:17:00.000Z" })).toBe(
      "2026-10-21T20:17:00.000Z",
    );
    expect(parseVaultUnlockAt({ data: "2026-10-21T20:17:00.000Z" })).toBe(
      "2026-10-21T20:17:00.000Z",
    );
    expect(
      parseVaultUnlockAt({ balance: 5000, unlockAt: "2026-10-21T20:17:00.000Z" }),
    ).toBe("2026-10-21T20:17:00.000Z");
    expect(parseVaultUnlockAt({ lockedUntil: "2026-10-21T20:17:00.000Z" })).toBe(
      "2026-10-21T20:17:00.000Z",
    );
  });

  it("maps minutes to RoRush lock API duration tokens", () => {
    expect(vaultLockApiDurationFromMinutes(10)).toBe("10min");
    expect(vaultLockApiDurationFromMinutes(60)).toBe("1h");
    expect(vaultLockApiDurationFromMinutes(99)).toBeNull();
  });

  it("detects active lock window", () => {
    const future = vaultLockExpiresAtIso(10, Date.now());
    expect(isVaultLockActive(future)).toBe(true);
    expect(isVaultLockActive("2000-01-01T00:00:00.000Z")).toBe(false);
  });
});
