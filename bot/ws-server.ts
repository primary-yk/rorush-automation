import http from "node:http";
import { WebSocketServer } from "ws";
import { parseLicenseKey } from "../src/license/verify.js";
import type { PilotAuthMessage } from "../src/relay/protocol.js";
import { getLinkByLicenseId } from "./store.js";
import { handlePilotMessage, registerPilot, unregisterPilot } from "./pilot-hub.js";

export function startPilotRelayServer(
  port: number,
  onEvent: (licenseId: string, event: import("../src/relay/protocol.js").PilotEventMessage) => void,
): http.Server {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Rush Pilot bot relay\n");
  });

  const wss = new WebSocketServer({ server, path: "/pilot" });

  wss.on("connection", (ws) => {
    let authed = false;

    ws.on("message", (data) => {
      const raw = data.toString();
      if (!authed) {
        let msg: PilotAuthMessage;
        try {
          msg = JSON.parse(raw) as PilotAuthMessage;
        } catch {
          ws.close(4001, "invalid json");
          return;
        }
        if (msg.type !== "auth" || !msg.licenseKey?.trim()) {
          ws.close(4001, "auth required");
          return;
        }
        try {
          const { payload } = parseLicenseKey(msg.licenseKey.trim());
          const link = getLinkByLicenseId(payload.id);
          if (!link) {
            ws.send(JSON.stringify({ type: "auth_fail", message: "Link Discord first: /activate your license in the bot." }));
            ws.close(4003, "not linked");
            return;
          }
          registerPilot(payload.id, link.discord_user_id, ws);
          authed = true;
          ws.send(JSON.stringify({ type: "auth_ok", licenseId: payload.id }));
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "auth_fail",
              message: err instanceof Error ? err.message : "Invalid license",
            }),
          );
          ws.close(4003, "bad license");
        }
        return;
      }
      handlePilotMessage(ws, raw, onEvent);
    });

    ws.on("close", () => {
      if (authed) unregisterPilot(ws);
    });
  });

  server.listen(port, () => {
    console.log(`Pilot relay WebSocket on ws://0.0.0.0:${port}/pilot`);
  });

  return server;
}
