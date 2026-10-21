import type { RushEmbed } from "./embeds.js";

export type HostIssueBucket = "captcha" | "login" | "join" | "system";

const BUCKET_LABEL: Record<HostIssueBucket, string> = {
  captcha: "Captcha",
  login: "Login / session",
  join: "Rain join",
  system: "Engine",
};

const BUCKET_COLOR: Record<HostIssueBucket, number> = {
  captcha: 0xd9_77_06,
  login: 0xdc_26_26,
  join: 0x7c_3a_ed,
  system: 0x47_55_69,
};

export function classifyHostIssue(text: string): HostIssueBucket {
  const m = text.toLowerCase();
  if (
    /wager required|join blocked \(wager\)|join failed \(wager\)|wager lock|wager clear|manual wager|limbo wager|play.?through|must bet|rain · wager/.test(
      m,
    )
  ) {
    return "join";
  }
  if (/captcha|2captcha|solve|token missing|hcaptcha|recaptcha|turnstile/.test(m)) return "captcha";
  if (
    /session expired|invalid token|unauthorized|not authenticated|login failed|2fa|credentials|401|403|jwt|re-login|password/.test(
      m,
    )
  ) {
    return "login";
  }
  if (/join failed|rain join|join error|wager|limbo|join window|min pool|pre-wager|rain captcha/.test(m)) {
    return "join";
  }
  return "system";
}

export function bucketLabel(bucket: HostIssueBucket): string {
  return BUCKET_LABEL[bucket];
}

function embedText(embed: RushEmbed): string {
  return [embed.title, embed.description, ...(embed.fields?.map((f) => `${f.name} ${f.value}`) ?? [])]
    .filter(Boolean)
    .join("\n");
}

export function tagHostEmbed(embed: RushEmbed): RushEmbed {
  const bucket = classifyHostIssue(embedText(embed));
  const title = embed.title ?? "Alert";
  if (title.startsWith("[") && title.includes("]")) return embed;
  return {
    ...embed,
    title: `[${BUCKET_LABEL[bucket]}] ${title}`.slice(0, 256),
    color: embed.color ?? BUCKET_COLOR[bucket],
  };
}

/** Merge multiple host alerts into one embed with grouped fields (easier to scan). */
export function groupHostLogEmbeds(embeds: RushEmbed[]): RushEmbed[] {
  if (embeds.length <= 1) {
    return embeds.map(tagHostEmbed);
  }

  const buckets = new Map<HostIssueBucket, string[]>();
  for (const raw of embeds) {
    const embed = tagHostEmbed(raw);
    const bucket = classifyHostIssue(embedText(embed));
    const line = [embed.title, embed.description?.split("\n")[0]]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 200);
    const list = buckets.get(bucket) ?? [];
    list.push(line);
    buckets.set(bucket, list);
  }

  const order: HostIssueBucket[] = ["login", "captcha", "join", "system"];
  const fields = order
    .filter((b) => buckets.has(b))
    .map((b) => ({
      name: BUCKET_LABEL[b],
      value: (buckets.get(b) ?? []).slice(0, 8).join("\n").slice(0, 1024),
      inline: false,
    }));

  const dominant =
    order.find((b) => buckets.has(b)) ?? "system";

  return [
    {
      title: "Host log · grouped alerts",
      description: `${embeds.length} event(s) — captcha, login, and join lines separated below.`,
      color: BUCKET_COLOR[dominant],
      fields,
      footer: embeds[0]?.footer,
      timestamp: new Date().toISOString(),
    },
  ];
}
