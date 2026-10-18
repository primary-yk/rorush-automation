export function automationApiOrigin(): string {
  const port = process.env.AUTOMATION_API_PORT ?? "43124";
  const host = process.env.AUTOMATION_API_HOST ?? "127.0.0.1";
  return (process.env.NEXT_PUBLIC_AUTOMATION_API_URL ?? `http://${host}:${port}`).replace(/\/$/, "");
}
