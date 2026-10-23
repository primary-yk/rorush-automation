/**
 * Probe vault info + optional lock test (does not lock unless --lock is set).
 *
 *   npm run test-vault-lock -- --id 1
 *   npm run test-vault-lock -- --nick fiery --lock 10m
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { getAccount, listAccounts } from "../src/db/repositories.js";
import { ensureAuthenticated } from "../src/accounts/session-manager.js";
import {
  fetchVaultBalanceCoins,
  fetchVaultUnlockAt,
  isVaultLockActive,
  lockVaultForMinutes,
} from "../src/rorush/vault.js";
import { parseVaultLockPreset } from "../src/rorush/vault-lock.js";
import { RORUSH_PATHS } from "../src/rorush/endpoints.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  getDb();
  const nick = arg("--nick")?.trim().toLowerCase();
  const idRaw = arg("--id");
  let account =
    nick != null
      ? listAccounts().find((a) => a.nickname.toLowerCase() === nick)
      : idRaw != null
        ? getAccount(Number(idRaw))
        : listAccounts()[0];
  if (!account) {
    console.error("Account not found.");
    process.exit(1);
  }

  const { client } = await ensureAuthenticated(account.id);
  const balance = await fetchVaultBalanceCoins(client);
  const unlock = await fetchVaultUnlockAt(client);
  console.log(`Account: ${account.nickname} (#${account.id})`);
  console.log(`Vault balance: ${balance != null ? balance.toFixed(2) : "?"} coins`);
  console.log(
    `Unlock timer: ${unlock ?? "(none)"} · active lock: ${isVaultLockActive(unlock) ? "yes" : "no"}`,
  );

  const lockRaw = arg("--lock");
  if (!lockRaw) {
    console.log("\nDry run only. To test lock: npm run test-vault-lock -- --nick NAME --lock 10m");
    return;
  }

  const minutes = parseVaultLockPreset(lockRaw);
  if (!minutes || minutes <= 0) {
    console.error("Invalid --lock duration (use 10m, 30m, 1h, 6h, 12h, 1d).");
    process.exit(1);
  }

  console.log(`\nCalling POST ${RORUSH_PATHS.vault.lock} (${minutes} min)…`);
  const result = await lockVaultForMinutes(client, minutes);
  console.log("Confirmed unlockAt:", result.unlockAt);
  const after = await fetchVaultUnlockAt(client);
  console.log("Vault info after:", after ?? "(none)");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
