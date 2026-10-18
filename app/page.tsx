import { DashboardClient, type DashboardBootstrap } from "./DashboardClient";
import { fetchAutomation } from "@/lib/server-api";
import type { Account, ActivityLog, LicenseStatus, Settings } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const initial: DashboardBootstrap = {
    license: null,
    settings: null,
    accounts: [],
    logs: [],
    error: null,
  };

  try {
    initial.license = await fetchAutomation<LicenseStatus>("/api/license/status");
    if (initial.license.active) {
      const [settings, accounts, logs] = await Promise.all([
        fetchAutomation<Settings>("/api/settings"),
        fetchAutomation<Account[]>("/api/rush-accounts"),
        fetchAutomation<ActivityLog[]>("/api/logs"),
      ]);
      initial.settings = settings;
      initial.accounts = accounts;
      initial.logs = logs;
    }
  } catch (e) {
    initial.error = e instanceof Error ? e.message : String(e);
  }

  return <DashboardClient initial={initial} />;
}
