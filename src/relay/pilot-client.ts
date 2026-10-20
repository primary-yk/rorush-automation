import WebSocket from "ws";
import { loadConfig, reloadEnv } from "../config.js";
import { getStoredLicenseKey } from "../license/service.js";
import type { BotCommandMessage, PilotCommandResult, PilotEventMessage } from "./protocol.js";
import {
  getSettings,
  insertAccount,
  listAccounts,
  listLogs,
  updateAccount,
  updateSettings,
} from "../db/repositories.js";
import { encryptField } from "../accounts/session-manager.js";
import { activateLicense } from "../license/service.js";
import { engine } from "../worker/engine.js";

let ws: WebSocket | null = null;
let connected = false;
let reconnectTimer: NodeJS.Timeout | null = null;

export function isRelayConnected(): boolean {
  return connected && ws != null && ws.readyState === WebSocket.OPEN;
}

export function startPilotRelayClient(): void {
  reloadEnv();
  const relayUrl = process.env.DISCORD_BOT_RELAY_URL?.trim();
  if (!relayUrl) return;

  const connect = () => {
    const key = getStoredLicenseKey() ?? process.env.PILOT_RELAY_LICENSE_KEY?.trim() ?? null;
    if (!key) {
      scheduleReconnect();
      return;
    }

    ws = new WebSocket(relayUrl);
    ws.on("open", () => {
      ws!.send(JSON.stringify({ type: "auth", licenseKey: key }));
    });

    ws.on("message", (data) => {
      let msg: {
        type: string;
        message?: string;
        requestId?: string;
        name?: BotCommandMessage["name"];
        args?: Record<string, unknown>;
      };
      try {
        msg = JSON.parse(data.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "auth_ok") {
        connected = true;
        console.log("[relay] connected to Discord bot");
        return;
      }
      if (msg.type === "auth_fail") {
        console.warn("[relay] auth failed:", msg.message);
        ws?.close();
        return;
      }
      if (msg.type === "cmd" && msg.requestId && msg.name) {
        void handleCommand(msg.requestId, msg.name, msg.args)
          .then((text) => {
            sendCommandResult({ type: "cmd_result", requestId: msg.requestId!, ok: true, text });
          })
          .catch((err) => {
            sendCommandResult({
              type: "cmd_result",
              requestId: msg.requestId!,
              ok: false,
              text: err instanceof Error ? err.message : String(err),
            });
          });
      }
    });

    ws.on("close", () => {
      connected = false;
      scheduleReconnect();
    });

    ws.on("error", () => {
      connected = false;
    });
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 8_000);
  };

  connect();
}

export function sendPilotEvent(event: PilotEventMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(event));
}

function sendCommandResult(payload: PilotCommandResult): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function findAccountByNickname(nick: string) {
  const q = nick.trim().toLowerCase();
  return listAccounts().find((a) => a.nickname.toLowerCase() === q);
}

async function handleCommand(
  requestId: string,
  name: BotCommandMessage["name"],
  args?: Record<string, unknown>,
): Promise<string> {
  void requestId;
  if (name === "status") {
    const s = getSettings();
    const accounts = listAccounts();
    const relay = isRelayConnected() ? "connected" : "disconnected";
    return [
      `**Engine:** ${s.global_pause ? "paused" : "running"}`,
      `**Accounts:** ${accounts.length}`,
      `**Discord relay:** ${relay}`,
      `**Control:** Discord commands (dashboard optional)`,
    ].join("\n");
  }
  if (name === "accounts") {
    const accounts = listAccounts();
    if (accounts.length === 0) {
      return "No accounts yet — use `/account add` (only you see the reply) while Pilot is online.";
    }
    return accounts
      .map((a) => {
        const bal = a.balance != null ? a.balance.toFixed(2) : "—";
        const lvl = a.level != null ? String(a.level) : "—";
        const t = [
          a.join_rain ? "rain" : null,
          a.auto_open_cases ? "cases" : null,
          a.auto_redeem_codes ? "codes" : null,
        ]
          .filter(Boolean)
          .join(", ");
        return `• **${a.nickname}** · ${bal} coins · lvl ${lvl} · ${t || "no toggles"} · ${a.status}${a.last_error ? `\n  ⚠ ${a.last_error.slice(0, 120)}` : ""}`;
      })
      .join("\n\n");
  }
  if (name === "stats") {
    const nick = typeof args?.nickname === "string" ? args.nickname : undefined;
    const account = nick ? findAccountByNickname(nick) : listAccounts()[0];
    if (!account) return "No matching account.";
    const bal = account.balance != null ? account.balance.toFixed(2) : "—";
    const lvl = account.level != null ? String(account.level) : "—";
    return `**${account.nickname}** · balance **${bal}** · level **${lvl}** · ${account.status}`;
  }
  if (name === "pause") {
    updateSettings({ global_pause: 1 });
    return "Global **pause** enabled.";
  }
  if (name === "resume") {
    updateSettings({ global_pause: 0 });
    return "Automation **resumed**.";
  }
  if (name === "logs") {
    const limit = typeof args?.limit === "number" ? Math.min(25, Math.max(3, args.limit)) : 12;
    const logs = listLogs(limit);
    return (
      logs.map((l) => `\`${l.created_at.slice(11, 19)}\` **${l.category}** ${l.message}`).join("\n") || "No logs."
    );
  }
  if (name === "rain_toggle" || name === "cases_toggle") {
    const nick = typeof args?.nickname === "string" ? args.nickname : "";
    const enabled = args?.enabled === true;
    const account = findAccountByNickname(nick);
    if (!account) return `No account named **${nick}**. Use \`/accounts\` for nicknames.`;
    if (name === "rain_toggle") {
      updateAccount(account.id, { join_rain: enabled ? 1 : 0 }, { allowJoinRainChange: true });
    } else {
      updateAccount(account.id, { auto_open_cases: enabled ? 1 : 0 });
    }
    void engine.reloadAccounts();
    return `**${account.nickname}** · ${name === "rain_toggle" ? "Join rain" : "Auto cases"} **${enabled ? "ON" : "OFF"}**`;
  }
  if (name === "account_add") {
    const nickname = typeof args?.nickname === "string" ? args.nickname.trim() : "";
    const email = typeof args?.email === "string" ? args.email.trim() : "";
    const password = typeof args?.password === "string" ? args.password : "";
    const sessionToken = typeof args?.sessionToken === "string" ? args.sessionToken.trim() : "";
    if (!nickname) return "Nickname is required.";
    if (!sessionToken && (!email || !password)) {
      return "Provide email + password, or a session JWT.";
    }
    insertAccount({
      nickname,
      username: email || null,
      password_enc: password ? encryptField(password) : null,
      session_jwt_enc: sessionToken ? encryptField(sessionToken) : null,
      api_key_enc: null,
      proxy_url: null,
    });
    await engine.reloadAccounts();
    return `Saved account **${nickname}**. Rain/cases toggles default off — use \`/rain\` and \`/cases\`.`;
  }
  if (name === "license_store") {
    const key = typeof args?.key === "string" ? args.key.trim() : "";
    if (!key) return "Missing license key.";
    const status = activateLicense(key);
    if (!status.active) return status.message ?? "Invalid license.";
    return `License saved on this PC (**${status.plan}**). Relay stays connected.`;
  }
  return "Unknown command.";
}

export function stopPilotRelayClient(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
  connected = false;
}

void loadConfig;
