import type WebSocket from "ws";
import type { BotCommandMessage, PilotCommandResult, PilotEventMessage, RelayMessage } from "../src/relay/protocol.js";

type PilotSocket = WebSocket & { licenseId?: string; discordUserId?: string };

const byLicense = new Map<string, PilotSocket>();
const pendingCommands = new Map<
  string,
  { resolve: (r: PilotCommandResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>();

export function registerPilot(licenseId: string, discordUserId: string, ws: PilotSocket): void {
  const prev = byLicense.get(licenseId);
  if (prev && prev !== ws) {
    try {
      prev.close(4000, "replaced");
    } catch {
      /* ignore */
    }
  }
  ws.licenseId = licenseId;
  ws.discordUserId = discordUserId;
  byLicense.set(licenseId, ws);
}

export function unregisterPilot(ws: PilotSocket): void {
  if (ws.licenseId) {
    const cur = byLicense.get(ws.licenseId);
    if (cur === ws) byLicense.delete(ws.licenseId);
  }
}

export function isPilotOnline(licenseId: string): boolean {
  const ws = byLicense.get(licenseId);
  return ws != null && ws.readyState === ws.OPEN;
}

export function sendCommand(
  licenseId: string,
  cmd: BotCommandMessage["name"],
  args?: Record<string, unknown>,
  timeoutMs = 12_000,
): Promise<string> {
  const ws = byLicense.get(licenseId);
  if (!ws || ws.readyState !== ws.OPEN) {
    return Promise.reject(new Error("Pilot is offline — run `npm run dev` on your PC with DISCORD_BOT_RELAY_URL set."));
  }
  const requestId = crypto.randomUUID();
  const msg: BotCommandMessage = { type: "cmd", requestId, name: cmd, args };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(requestId);
      reject(new Error("Pilot did not respond in time."));
    }, timeoutMs);
    pendingCommands.set(requestId, {
      timer,
      resolve: (r) => {
        if (!r.ok) reject(new Error(r.text));
        else resolve(r.text);
      },
      reject,
    });
    ws.send(JSON.stringify(msg));
  });
}

export function handlePilotMessage(
  ws: PilotSocket,
  raw: string,
  onEvent: (licenseId: string, event: PilotEventMessage) => void,
): void {
  let parsed: RelayMessage;
  try {
    parsed = JSON.parse(raw) as RelayMessage;
  } catch {
    return;
  }
  if (parsed.type === "event") {
    if (ws.licenseId) onEvent(ws.licenseId, parsed);
    return;
  }
  if (parsed.type === "cmd_result") {
    const pending = pendingCommands.get(parsed.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingCommands.delete(parsed.requestId);
    pending.resolve(parsed);
  }
}

export function pilotSocketForLicense(licenseId: string): PilotSocket | undefined {
  return byLicense.get(licenseId);
}
