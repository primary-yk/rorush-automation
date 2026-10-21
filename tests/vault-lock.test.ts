import { describe, expect, it } from "vitest";
import { parseVaultLockPreset, VAULT_LOCK_PRESETS } from "../src/rorush/vault-lock.js";
import { isVaultLockActive, vaultLockExpiresAtIso } from "../src/rorush/vault.js";

describe("vault-lock presets", () => {
  it("parses UI durations", () => {
    expect(parseVaultLockPreset("10m")).toBe(VAULT_LOCK_PRESETS["10m"]);
    expect(parseVaultLockPreset("1 hour")).toBe(60);
    expect(parseVaultLockPreset("1d")).toBe(1440);
    expect(parseVaultLockPreset("off")).toBe(0);
  });

  it("detects active lock window", () => {
    const future = vaultLockExpiresAtIso(10, Date.now());
    expect(isVaultLockActive(future)).toBe(true);
    expect(isVaultLockActive("2000-01-01T00:00:00.000Z")).toBe(false);
  });
});
