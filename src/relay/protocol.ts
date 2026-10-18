export type PilotAuthMessage = {
  type: "auth";
  licenseKey: string;
};

export type PilotEventMessage = {
  type: "event";
  kind: "limbo" | "rain" | "accounts" | "system";
  embed: {
    title: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
  };
};

export type BotCommandMessage = {
  type: "cmd";
  requestId: string;
  name: "status" | "accounts" | "pause" | "resume" | "logs";
};

export type PilotCommandResult = {
  type: "cmd_result";
  requestId: string;
  ok: boolean;
  text: string;
};

export type BotAuthOk = { type: "auth_ok"; licenseId: string };
export type BotAuthFail = { type: "auth_fail"; message: string };

export type RelayMessage =
  | PilotAuthMessage
  | PilotEventMessage
  | BotCommandMessage
  | PilotCommandResult
  | BotAuthOk
  | BotAuthFail;
