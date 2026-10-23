import { isAddress, type Address } from "viem";
import { baseSepolia } from "viem/chains";

export type TransferToken = "ETH" | "USDC";
export type TokenConfig = {
  symbol: "USDC";
  contractAddress: Address;
  decimals: number;
  chainId: number;
};

/** No Base Sepolia USDC address is bundled with the project. Configure a trusted one explicitly. */
export function configuredUsdc(): TokenConfig | null {
  const address = process.env.BASE_SEPOLIA_USDC_ADDRESS?.trim();
  const decimalsText = process.env.BASE_SEPOLIA_USDC_DECIMALS?.trim();
  if (!address || !decimalsText || !isAddress(address)) return null;
  const decimals = Number(decimalsText);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  return { symbol: "USDC", contractAddress: address as Address, decimals, chainId: baseSepolia.id };
}
