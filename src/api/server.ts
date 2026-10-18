import express from "express";
import { captchaApiKey, loadConfig, projectRoot } from "../config.js";
import {
  deleteAccount,
  getSettings,
  insertAccount,
  getAccount,
  listAccounts,
  listLogs,
  listRecentCaseOpens,
  listRecentCodeRedeems,
  listRecentRainJoins,
  updateAccount,
  updateSettings,
} from "../db/repositories.js";
import { encryptField, setSessionToken } from "../accounts/session-manager.js";
import { isIgnorableCaseError } from "../automation/case-errors.js";
import { reportAccountSnapshot, sendTestReport } from "../discord/reporter.js";
import { isRelayConnected } from "../relay/pilot-client.js";
import { engine } from "../worker/engine.js";
export function createApiServer() {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,PATCH,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  });
  app.options("*", (_req, res) => {
    res.sendStatus(204);
  });
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => {
    const cfg = loadConfig();
    res.json({
      ok: true,
      projectRoot: projectRoot(),
      databasePath: cfg.DATABASE_PATH,
      accountCount: listAccounts().length,
      encryptionConfigured: !!cfg.ENCRYPTION_KEY?.trim(),
      capmonsterConfigured: !!captchaApiKey(cfg),
    });
  });

  app.get("/api/settings", (_req, res) => {
    const s = getSettings();
    const cfg = loadConfig();
    res.json({
      globalPause: !!s.global_pause,
      discordEnabled: !!s.discord_enabled,
      discordChannelId: s.discord_channel_id,
      hasDiscordToken: !!s.discord_token_enc,
      discordReportEnabled: !!s.discord_report_enabled,
      hasDiscordReportWebhook: !!s.discord_report_webhook_enc,
      capmonsterConfigured: !!captchaApiKey(cfg),
    });
  });

  app.patch("/api/settings", (req, res) => {
    const body = req.body as {
      globalPause?: boolean;
      discordEnabled?: boolean;
      discordChannelId?: string | null;
      discordToken?: string | null;
      discordReportEnabled?: boolean;
      discordReportWebhook?: string | null;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.globalPause === "boolean") patch.global_pause = body.globalPause ? 1 : 0;
    if (typeof body.discordEnabled === "boolean") patch.discord_enabled = body.discordEnabled ? 1 : 0;
    if (body.discordChannelId !== undefined) patch.discord_channel_id = body.discordChannelId;
    if (body.discordToken !== undefined) {
      patch.discord_token_enc = body.discordToken ? encryptField(body.discordToken) : null;
    }
    if (typeof body.discordReportEnabled === "boolean") {
      patch.discord_report_enabled = body.discordReportEnabled ? 1 : 0;
    }
    if (body.discordReportWebhook !== undefined) {
      patch.discord_report_webhook_enc = body.discordReportWebhook
        ? encryptField(body.discordReportWebhook)
        : null;
    }
    const next = updateSettings(patch as Parameters<typeof updateSettings>[0]);
    res.json({
      globalPause: !!next.global_pause,
      discordEnabled: !!next.discord_enabled,
      discordChannelId: next.discord_channel_id,
      hasDiscordToken: !!next.discord_token_enc,
      discordReportEnabled: !!next.discord_report_enabled,
      hasDiscordReportWebhook: !!next.discord_report_webhook_enc,
    });
  });

  app.get("/api/discord/relay-status", (_req, res) => {
    res.json({
      relayConfigured: !!process.env.DISCORD_BOT_RELAY_URL?.trim(),
      connected: isRelayConnected(),
    });
  });

  app.post("/api/discord/test-report", async (_req, res) => {
    const result = await sendTestReport();
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/rush-accounts", (_req, res) => {
    for (const a of listAccounts()) {
      if (a.last_error && isIgnorableCaseError(a.last_error)) {
        updateAccount(a.id, { status: "idle", last_error: null });
      }
    }
    res.json(listAccounts().map(publicAccount));
  });

  app.post("/api/rush-accounts", async (req, res) => {
    try {
      const body = req.body as {
        nickname: string;
        username?: string;
        password?: string;
        sessionToken?: string;
        apiKey?: string;
        proxyUrl?: string;
      };
      if (!body.nickname?.trim()) {
        res.status(400).json({ error: "nickname is required" });
        return;
      }
      const account = insertAccount({
        nickname: body.nickname.trim(),
        username: body.username ?? null,
        password_enc: body.password ? encryptField(body.password) : null,
        session_jwt_enc: body.sessionToken ? encryptField(body.sessionToken) : null,
        api_key_enc: body.apiKey ? encryptField(body.apiKey) : null,
        proxy_url: body.proxyUrl ?? null,
      });
      await engine.reloadAccounts();
      void reportAccountSnapshot("account added");
      res.status(201).json(publicAccount(account));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch("/api/rush-accounts/:id", async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as Partial<{
      nickname: string;
      joinRain: boolean;
      minRainAmount: number;
      autoOpenCases: boolean;
      autoRedeemCodes: boolean;
      minCodeLevel: number;
      limboWagerEnabled: boolean;
      limboMultiplier: number;
      limboBetCoins: number;
      clearError?: boolean;
      password: string;
      sessionToken: string;
      apiKey: string;
      proxyUrl: string | null;
    }>;

    const patch: Record<string, unknown> = {};
    if (body.nickname !== undefined) patch.nickname = body.nickname;
    if (body.joinRain !== undefined) patch.join_rain = body.joinRain ? 1 : 0;
    if (body.minRainAmount !== undefined) patch.min_rain_amount = body.minRainAmount;
    if (body.autoOpenCases !== undefined) patch.auto_open_cases = body.autoOpenCases ? 1 : 0;
    if (body.autoRedeemCodes !== undefined) patch.auto_redeem_codes = body.autoRedeemCodes ? 1 : 0;
    if (body.minCodeLevel !== undefined) patch.min_code_level = body.minCodeLevel;
    if (body.limboWagerEnabled !== undefined) patch.limbo_wager_enabled = body.limboWagerEnabled ? 1 : 0;
    if (body.limboMultiplier !== undefined) patch.limbo_multiplier = body.limboMultiplier;
    if (body.limboBetCoins !== undefined) patch.limbo_bet_coins = body.limboBetCoins;
    if (body.clearError) {
      patch.last_error = null;
      patch.status = "idle";
    }
    if (body.password !== undefined) patch.password_enc = body.password ? encryptField(body.password) : null;
    if (body.proxyUrl !== undefined) patch.proxy_url = body.proxyUrl;
    if (body.sessionToken !== undefined) {
      await setSessionToken(id, body.sessionToken, body.apiKey);
    } else if (body.apiKey !== undefined) {
      patch.api_key_enc = body.apiKey ? encryptField(body.apiKey) : null;
    }

    const updated = updateAccount(id, patch as Parameters<typeof updateAccount>[1]);
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const authChanged =
      body.sessionToken !== undefined ||
      body.password !== undefined ||
      body.apiKey !== undefined ||
      body.proxyUrl !== undefined;
    const caseToggleChanged = body.autoOpenCases !== undefined;

    res.json(publicAccount(updated));

    // Respond first — toggles/dismiss should feel instant; heavy work runs after.
    if (authChanged) {
      void engine.reloadAccounts().catch((err) => {
        console.error("[patch account reload]", err instanceof Error ? err.message : String(err));
      });
    } else if (caseToggleChanged) {
      void engine.refreshCaseSchedulesOnly().catch((err) => {
        console.error("[patch case schedules]", err instanceof Error ? err.message : String(err));
      });
    }
  });

  app.delete("/api/rush-accounts/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      res.status(400).json({ error: "Invalid account id" });
      return;
    }
    if (!getAccount(id)) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    deleteAccount(id);
    res.json({ ok: true, id });
    void reportAccountSnapshot("account removed");
    try {
      await engine.reloadAccounts();
    } catch (err) {
      console.error("[delete account]", err instanceof Error ? err.message : String(err));
    }
  });

  app.get("/api/rush-accounts/:id/history", (req, res) => {
    const id = Number(req.params.id);
    res.json({
      rainJoins: listRecentRainJoins(id),
      caseOpens: listRecentCaseOpens(id),
      codeRedeems: listRecentCodeRedeems(id),
    });
  });

  app.get("/api/logs", (req, res) => {
    const limit = Number(req.query.limit ?? 200);
    res.json(listLogs(limit));
  });

  return app;
}

function publicAccount(a: ReturnType<typeof listAccounts>[number]) {
  return {
    id: a.id,
    nickname: a.nickname,
    username: a.username,
    hasPassword: !!a.password_enc,
    hasSession: !!a.session_jwt_enc,
    proxyUrl: a.proxy_url,
    joinRain: !!a.join_rain,
    minRainAmount: a.min_rain_amount,
    autoOpenCases: !!a.auto_open_cases,
    autoRedeemCodes: !!a.auto_redeem_codes,
    minCodeLevel: a.min_code_level,
    limboWagerEnabled: !!a.limbo_wager_enabled,
    limboMultiplier: a.limbo_multiplier,
    limboBetCoins: a.limbo_bet_coins,
    status: a.status,
    lastError: a.last_error,
    balance: a.balance,
    level: a.level,
    lifetimeEarnings: {
      rain: a.lifetime_rain,
      cases: a.lifetime_cases,
      codes: a.lifetime_codes,
      total: a.lifetime_rain + a.lifetime_cases + a.lifetime_codes,
    },
  };
}

export async function startApiServer(): Promise<void> {
  const cfg = loadConfig();
  const app = createApiServer();
  await new Promise<void>((resolve) => {
    app.listen(cfg.AUTOMATION_API_PORT, cfg.AUTOMATION_API_HOST, () => resolve());
  });
}
