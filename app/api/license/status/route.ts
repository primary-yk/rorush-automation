import { NextResponse } from "next/server";
import { envTruthy } from "@/lib/env-path";

export const dynamic = "force-dynamic";

export async function GET() {
  if (envTruthy("LICENSE_DEV_SKIP") || envTruthy("_LICENSE_DEV_SKIP") || envTruthy("RUSH_PILOT_DEV")) {
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
