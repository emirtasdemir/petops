import { isAddress, type Address } from "viem";

export const PREMIUM_PATH = "/api/premium/pet-report";
export const PREMIUM_PRICE = "$0.001";
export const X402_NETWORK = "eip155:84532";
export const X402_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const X402_DECIMALS = 6;
export const X402_AMOUNT = "1000";
export const X402_FACILITATOR = "https://x402.org/facilitator";

export function premiumPayTo(): Address | null {
  const value = process.env.X402_PAY_TO_ADDRESS?.trim();
  return value && isAddress(value) ? value : null;
}
