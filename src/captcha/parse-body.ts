/** Some proxies prepend junk before JSON — res.json() then fails. */
export function parseCaptchaApiBody(text: string, context: string): unknown {
  let s = text.trim();
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1).trim();
  if (!s) {
    throw new Error(`Empty captcha API response (${context})`);
  }

  const tryParse = (raw: string): unknown | null => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  };

  let parsed = tryParse(s);
  if (parsed !== null) return parsed;

  const jsonStart = s.search(/[{\[]/);
  if (jsonStart > 0) {
    parsed = tryParse(s.slice(jsonStart));
    if (parsed !== null) return parsed;
  }

  const preview = s.slice(0, 160).replace(/\s+/g, " ");
  throw new Error(
    `Captcha API returned non-JSON (${context}): ${preview}${s.length > 160 ? "…" : ""}`,
  );
}
