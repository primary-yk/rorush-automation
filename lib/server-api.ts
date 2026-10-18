import { automationApiOrigin } from "./automation-url";

export async function fetchAutomation<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${automationApiOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, { ...init, cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
