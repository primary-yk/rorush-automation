import { NextResponse } from "next/server";
import { licenseDevSkipEnabled } from "@/lib/env-path";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.RUSH_PILOT_DEV_SKIP === "true" || licenseDevSkipEnabled()) {
    return NextResponse.json({
      active: true,
      devSkip: true,
      plan: "developer",
      licenseId: null,
      expiresAt: null,
      message: null,
    });
  }

  const port = process.env.AUTOMATION_API_PORT ?? "43124";
  const res = await fetch(`http://127.0.0.1:${port}/api/license/status`, { cache: "no-store" });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
