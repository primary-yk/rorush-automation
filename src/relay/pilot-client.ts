import WebSocket from "ws";
import { loadConfig, reloadEnv } from "../config.js";
import { getStoredLicenseKey } from "../license/service.js";
import type { BotCommandMessage, PilotCommandResult, PilotEventMessage } from "./protocol.js";
import { getSettings, listAccounts, updateSettings } from "../db/repositories.js";
import { listLogs } from "../db/repositories.js";

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
      let msg: { type: string; message?: string; requestId?: string; name?: BotCommandMessage["name"] };
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
        void handleCommand(msg.requestId, msg.name)
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

async function handleCommand(requestId: string, name: BotCommandMessage["name"]): Promise<string> {
  void requestId;
  if (name === "status") {
    const s = getSettings();
    const accounts = listAccounts();
    const relay = isRelayConnected() ? "connected" : "disconnected";
    return [
      `**Engine:** ${s.global_pause ? "paused" : "running"}`,
      `**Accounts:** ${accounts.length}`,
      `**Discord relay:** ${relay}`,
      `**Dashboard:** http://127.0.0.1:43123`,
    ].join("\n");
  }
  if (name === "accounts") {
    const accounts = listAccounts();
    if (accounts.length === 0) return "No accounts — add one on the dashboard or we can add Discord flows later.";
    return accounts
      .map((a) => {
        const t = [
          a.join_rain ? "rain" : null,
          a.auto_open_cases ? "cases" : null,
          a.auto_redeem_codes ? "codes" : null,
        ]
          .filter(Boolean)
          .join(", ");
        return `• **${a.nickname}** · ${t || "no toggles"} · ${a.status}${a.last_error ? ` · ⚠ ${a.last_error.slice(0, 80)}` : ""}`;
      })
      .join("\n");
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
    const logs = listLogs().slice(0, 8);
    return logs.map((l) => `\`${l.created_at.slice(11, 19)}\` **${l.category}** ${l.message}`).join("\n") || "No logs.";
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
