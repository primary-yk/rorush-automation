export type CaseWonItem = {
  name: string;
  imageUrl: string | null;
  priceCoins: number | null;
};

export type ParsedCaseUnbox = {
  matched: boolean;
  totalWinCoins: number;
  items: CaseWonItem[];
  rawMessage?: string;
};

function centsToCoins(cents: unknown): number | null {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
  return cents / 100;
}

function readItem(raw: unknown): CaseWonItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const nested = (o.item ?? o.reward ?? o.prize ?? o.caseItem) as Record<string, unknown> | undefined;
  const src = nested && typeof nested === "object" ? nested : o;
  const name = String(src.itemName ?? src.name ?? src.title ?? "").trim();
  const imageUrl = String(src.imageUrl ?? src.image ?? src.iconUrl ?? src.img ?? "").trim() || null;
  const priceRaw = src.price ?? src.itemPrice ?? src.value ?? o.winAmount ?? o.amount;
  let priceCoins: number | null = null;
  if (typeof priceRaw === "number") {
    priceCoins = priceRaw >= 100 ? priceRaw / 100 : priceRaw;
  }
  if (!name && priceCoins == null) return null;
  return {
    name: name || "Unknown item",
    imageUrl: imageUrl?.startsWith("http") ? imageUrl : null,
    priceCoins,
  };
}

/** Parse RoRush `ReceivePrivateCaseUnboxingResult` (and variants). */
export function parseCaseUnboxingPayload(payload: unknown, expectedReqId?: string): ParsedCaseUnbox {
  if (!payload || typeof payload !== "object") {
    return { matched: false, totalWinCoins: 0, items: [] };
  }
  const root = payload as Record<string, unknown>;
  const payloadReqId = String(root.reqId ?? root.ReqId ?? "").trim();
  if (expectedReqId && payloadReqId && payloadReqId !== expectedReqId) {
    return { matched: false, totalWinCoins: 0, items: [] };
  }

  const result = (root.result ?? root.data ?? root) as Record<string, unknown>;
  const rounds = (result.roundResults ??
    result.rounds ??
    result.results ??
    []) as unknown[];

  const items: CaseWonItem[] = [];
  let totalCents = 0;
  for (const round of rounds) {
    if (!round || typeof round !== "object") continue;
    const r = round as Record<string, unknown>;
    const win = r.winAmount ?? r.win ?? r.amount;
    if (typeof win === "number" && Number.isFinite(win)) totalCents += win;
    const item = readItem(r);
    if (item) items.push(item);
  }

  if (items.length === 0) {
    const single = readItem(result);
    if (single) items.push(single);
  }

  if (typeof result.winAmount === "number") totalCents = result.winAmount;
  if (typeof result.totalWin === "number") totalCents = result.totalWin;

  const totalWinCoins =
    items.reduce((s, i) => s + (i.priceCoins ?? 0), 0) ||
    centsToCoins(totalCents) ||
    0;

  for (const it of items) {
    if (it.priceCoins == null && totalWinCoins > 0 && items.length === 1) {
      it.priceCoins = totalWinCoins;
    }
  }

  return {
    matched: true,
    totalWinCoins,
    items,
    rawMessage: typeof root.message === "string" ? root.message : undefined,
  };
}
