export type LoginEmailResponse = {
  userInfo?: {
    jwtToken?: string;
    apiKey?: string;
    level?: number;
    currentBalanceToken?: string;
    cryptoBalance?: number;
    funCoinBalance?: number;
  };
  twoFactorToken?: string;
  message?: string;
};

export type ApiErrorBody = {
  message?: string;
  errorCode?: number;
};

export type RainState = {
  rainId: string;
  amount?: number;
  createdTimestamp?: number;
  tipStageDuration?: number;
  joinStageStartTimestamp?: number | null;
  joinStageDuration?: number;
};

export type JoinRainPayload = {
  reqId: string;
  rainId: string;
  captchaToken?: string | null;
};

export type PlayLimboPayload = {
  reqId: string;
  amount: number;
  currency: string;
  multiplier: number;
};

export type PlayCasePayload = {
  reqId: string;
  caseId: string;
  casesNumber: number;
  currency: string;
  kind: string;
  isFastSpin: boolean;
  rankId?: string | null;
};

export type EnergyCaseEntry = {
  case: { caseId: string; caseName?: string };
  isOpened?: boolean;
  isAvailable?: boolean;
  unlockAt?: string | null;
};

export type DailyCasesInfo = {
  dailyCase?: { caseId?: string; unlockAt?: string | null; isAvailable?: boolean };
  weeklyCase?: { caseId?: string; unlockAt?: string | null; isAvailable?: boolean };
  monthlyCase?: { caseId?: string; unlockAt?: string | null; isAvailable?: boolean };
  rankCases?: Array<{ caseId: string; unlockAt?: string | null; isAvailable?: boolean; kind?: string }>;
  [key: string]: unknown;
};
