import { NextRequest, NextResponse } from "next/server";

const CLOUD_UPSTREAM = "https://wtqrcakakfmpjrlgpvsp.supabase.co/functions/v1/ig-cloud";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-workspace-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse("ok", { headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const workspaceKey = request.headers.get("x-workspace-key");
    if (workspaceKey) headers["X-Workspace-Key"] = workspaceKey;

    const upstream = await fetch(CLOUD_UPSTREAM, {
      method: "POST",
      headers,
      body,
      cache: "no-store"
    });

    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, code: "CLOUD_PROXY_UNREACHABLE", error: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: CORS_HEADERS }
    );
  }
}
