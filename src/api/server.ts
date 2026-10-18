import express from "express";
import { loadConfig } from "../config.js";
import {
  deleteAccount,
  getSettings,
  insertAccount,
  listAccounts,
  listLogs,
  listRecentCaseOpens,
  listRecentCodeRedeems,
  listRecentRainJoins,
  updateAccount,
  updateSettings,
} from "../db/repositories.js";
import { encryptField, setSessionToken } from "../accounts/session-manager.js";
import { engine } from "../worker/engine.js";

export function createApiServer() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/settings", (_req, res) => {
    const s = getSettings();
    res.json({
      globalPause: !!s.global_pause,
      discordEnabled: !!s.discord_enabled,
      discordChannelId: s.discord_channel_id,
      hasDiscordToken: !!s.discord_token_enc,
    });
  });

  app.patch("/api/settings", (req, res) => {
    const body = req.body as {
      globalPause?: boolean;
      discordEnabled?: boolean;
      discordChannelId?: string | null;
      discordToken?: string | null;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.globalPause === "boolean") patch.global_pause = body.globalPause ? 1 : 0;
    if (typeof body.discordEnabled === "boolean") patch.discord_enabled = body.discordEnabled ? 1 : 0;
    if (body.discordChannelId !== undefined) patch.discord_channel_id = body.discordChannelId;
    if (body.discordToken !== undefined) {
      patch.discord_token_enc = body.discordToken ? encryptField(body.discordToken) : null;
    }
    const next = updateSettings(patch as Parameters<typeof updateSettings>[0]);
    res.json({
      globalPause: !!next.global_pause,
      discordEnabled: !!next.discord_enabled,
      discordChannelId: next.discord_channel_id,
      hasDiscordToken: !!next.discord_token_enc,
    });
  });

  app.get("/api/accounts", (_req, res) => {
    res.json(
      listAccounts().map(publicAccount),
    );
  });

  app.post("/api/accounts", async (req, res) => {
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
      res.status(201).json(publicAccount(account));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch("/api/accounts/:id", async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as Partial<{
      nickname: string;
      joinRain: boolean;
      minRainAmount: number;
      autoOpenCases: boolean;
      autoRedeemCodes: boolean;
      minCodeLevel: number;
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
    await engine.reloadAccounts();
    res.json(publicAccount(updated));
  });

  app.delete("/api/accounts/:id", async (req, res) => {
    deleteAccount(Number(req.params.id));
    await engine.reloadAccounts();
    res.status(204).end();
  });

  app.get("/api/accounts/:id/history", (req, res) => {
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
