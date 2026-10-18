/** Paths discovered from RoRush's public web client (api.rorush.com). */
export const RORUSH_PATHS = {
  auth: {
    loginEmail: "/api/v1/auth/login-email",
    loginCookie: "/api/v1/auth/login-cookie",
    status: "/api/v1/auth/status",
    signOut: "/api/v1/auth/sign-out",
  },
  user: {
    balance: "/api/v1/user/balance",
    level: "/api/v1/user/level",
    stats: "/api/v1/user/stats",
  },
  rewards: {
    dailyCasesInfo: "/api/v1/rewards/daily-cases/info",
    energyCasesInfo: "/api/v1/rewards/energy-cases/info",
    seasonsCasesCurrent: "/api/v1/rewards/seasons/cases/current",
    seasonsRankClaim: "/api/v1/rewards/seasons/rank",
    flashcodeUse: "/api/v1/rewards/flashcode/use",
  },
  hubPath: "/hub",
} as const;

export const SIGNALR = {
  hubQuerySecRush: "836457212",
  rain: {
    subscribe: "SubscribeRain",
    unsubscribe: "UnsubscribeRain",
    join: "JoinRain",
    receiveCurrent: "ReceiveCurrentRains",
    receiveCreated: "ReceiveRainCreated",
    receiveFailure: "ReceiveRainFailure",
    receiveJoinSuccess: "ReceiveJoinRainSuccess",
    receiveFinished: "ReceiveRainFinished",
    receiveJoinStageStart: "ReceiveRainJoinStageStart",
    receiveAmountUpdated: "ReceiveRainAmountUpdated",
  },
  limbo: {
    play: "PlayLimboGame",
    receiveResult: "ReceivePrivateLimboResult",
    receiveFailure: "ReceiveLimboFailure",
  },
  caseUnboxing: {
    subscribe: "SubscribeCaseUnboxing",
    unsubscribe: "UnsubscribeCaseUnboxing",
    play: "PlayCaseUnboxing",
    receiveResult: "ReceivePrivateCaseUnboxingResult",
    receiveFailure: "ReceiveCaseUnboxingFailure",
  },
} as const;

/** Case kinds from the web client (`11488` chunk). */
export const CASE_KIND = {
  daily: "daily",
  energy: "energy",
  normal: "normal",
  season: "season",
  dseason: "dseason",
  wseason: "wseason",
  mseason: "mseason",
  giveaway: "giveaway",
} as const;

export type CaseKind = (typeof CASE_KIND)[keyof typeof CASE_KIND];
