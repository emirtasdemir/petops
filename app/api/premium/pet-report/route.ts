import { NextRequest, NextResponse } from "next/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createPremiumHandler } from "@/agent/premium-route-handler";
import { X402_FACILITATOR, premiumPayTo } from "@/agent/x402-config";
import { canonicalPremiumRequest } from "@/agent/x402-origin";

export const runtime = "nodejs";

let cached: { payTo: string; handle: ReturnType<typeof createPremiumHandler> } | null = null;
export async function GET(request: NextRequest) {
  const payTo = premiumPayTo();
  if (!payTo) return NextResponse.json({ error: "Premium payment recipient is not configured." }, { status: 503 });
  if (!cached || cached.payTo !== payTo) {
    cached = { payTo, handle: createPremiumHandler(payTo, new HTTPFacilitatorClient({ url: X402_FACILITATOR })) };
  }
  return cached.handle(canonicalPremiumRequest(request));
}
