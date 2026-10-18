import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const port = process.env.AUTOMATION_API_PORT ?? "43124";
  const body = await req.text();
  const res = await fetch(`http://127.0.0.1:${port}/api/license/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    cache: "no-store",
  });
  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
