/**
 * Manual vault deposit test (uses real balance).
 *   npm run test-vault -- --id 1 --amount 0.01
 */
import "../src/bootstrap-env.js";
import { getDb } from "../src/db/database.js";
import { getAccount } from "../src/db/repositories.js";
import { ensureAuthenticated } from "../src/accounts/session-manager.js";
import { depositCoinsToVault, fetchVaultBalanceCoins } from "../src/rorush/vault.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  getDb();
  const id = Number(arg("--id") ?? "1");
  const amount = Number(arg("--amount") ?? "0.01");
  const account = getAccount(id);
  if (!account) {
    console.error(`Account #${id} not found`);
    process.exit(1);
  }
  const { client } = await ensureAuthenticated(id);
  const before = await fetchVaultBalanceCoins(client);
  console.log("Vault before:", before != null ? `${before.toFixed(2)} coins` : "(unknown)");
  await depositCoinsToVault(client, amount, "CRYPTO");
  const after = await fetchVaultBalanceCoins(client);
  console.log(`Deposited ${amount.toFixed(2)} coins`);
  console.log("Vault after:", after != null ? `${after.toFixed(2)} coins` : "(unknown)");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
