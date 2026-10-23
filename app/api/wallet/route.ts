import { createWallet, getWalletAddress, getWalletBalance, getWalletSource } from "@/agent/wallet";

// GET /api/wallet -> the agent's wallet address and balance (or null if none yet)
export async function GET() {
  const address = getWalletAddress();
  if (!address) return Response.json({ address: null, source: null });

  const balance = await getWalletBalance().catch(() => "unavailable");
  return Response.json({ address, balance, source: getWalletSource() });
}

// POST /api/wallet -> create the agent's wallet
export async function POST() {
  return Response.json({ address: createWallet() });
}
