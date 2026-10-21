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

const RORUSH_ASSET_ORIGIN = "https://rorush.com";

function centsToCoins(cents: unknown): number | null {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
  return cents / 100;
}

/** @internal exported for tests */
export function normalizeCaseItemImageUrl(raw: unknown): string | null {
  if (raw == null) return null;
  let t = String(raw).trim();
  if (!t) return null;
  if (t.startsWith("//")) t = `https:${t}`;
  else if (t.startsWith("/")) t = `${RORUSH_ASSET_ORIGIN}${t}`;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

function coinsFromRawAmount(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw >= 100 ? raw / 100 : raw;
}

function readItem(raw: unknown, roundWinCents?: number): CaseWonItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const nested = (o.item ??
    o.reward ??
    o.prize ??
    o.caseItem ??
    o.wonItem ??
    o.skin) as Record<string, unknown> | undefined;
  const src = nested && typeof nested === "object" ? nested : o;
  const name = String(
    src.itemName ?? src.name ?? src.title ?? src.displayName ?? src.skinName ?? "",
  ).trim();
  const imageRaw =
    src.imageUrl ??
    src.imageURL ??
    src.image ??
    src.iconUrl ??
    src.img ??
    src.thumbnailUrl ??
    src.thumbUrl ??
    src.itemImageUrl ??
    src.pictureUrl;
  const imageUrl = normalizeCaseItemImageUrl(imageRaw);
  const priceRaw =
    src.price ??
    src.itemPrice ??
    src.priceCoins ??
    src.value ??
    src.winAmount ??
    o.winAmount ??
    o.amount ??
    roundWinCents;
  let priceCoins = coinsFromRawAmount(priceRaw);
  if (priceCoins == null && typeof roundWinCents === "number") {
    priceCoins = centsToCoins(roundWinCents);
  }
  if (!name && priceCoins == null && !imageUrl) return null;
  return {
    name: name || "Unknown item",
    imageUrl,
    priceCoins,
  };
}

function collectItemsFromList(list: unknown, out: CaseWonItem[]): void {
  if (!Array.isArray(list)) return;
  for (const entry of list) {
    const item = readItem(entry);
    if (item) out.push(item);
  }
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
    const winCents = typeof win === "number" && Number.isFinite(win) ? win : undefined;
    if (winCents != null) totalCents += winCents;
    const item = readItem(r, winCents);
    if (item) items.push(item);
    collectItemsFromList(r.items, items);
    collectItemsFromList(r.wonItems, items);
  }

  if (items.length === 0) {
    collectItemsFromList(result.wonItems, items);
    collectItemsFromList(result.items, items);
    collectItemsFromList(result.rewards, items);
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
