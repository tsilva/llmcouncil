import { NextResponse } from "next/server";
import { normalizeRunInput } from "@/lib/council";
import { runCouncilWorkflow } from "@/lib/council-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = normalizeRunInput(body);
    const result = await runCouncilWorkflow(input);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
