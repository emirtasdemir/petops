import nextEnv from "@next/env";
import { formatUnits, formatEther } from "viem";
import { getBaseSepoliaTransferContext } from "../agent/wallet.ts";
import { PREMIUM_PRICE, X402_AMOUNT, X402_ASSET, X402_DECIMALS, X402_FACILITATOR, X402_NETWORK, premiumPayTo } from "../agent/x402-config.ts";

nextEnv.loadEnvConfig(process.cwd(), true);
const payTo = premiumPayTo();
console.log("Network:", X402_NETWORK, "(Base Sepolia Testnet)");
console.log("Asset: USDC", X402_ASSET);
console.log("Price:", PREMIUM_PRICE, "(" + formatUnits(BigInt(X402_AMOUNT), X402_DECIMALS) + " USDC)");
console.log("Facilitator:", X402_FACILITATOR);
console.log("Recipient:", payTo ?? "not configured");
try {
  const { account, publicClient } = getBaseSepoliaTransferContext();
  console.log("Paying wallet:", account.address);
  const [chainId, eth, usdc] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: X402_ASSET,
      abi: [{ name: "balanceOf", type: "function", stateMutability: "view",
        inputs: [{ name: "account", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] }],
      functionName: "balanceOf", args: [account.address],
    }),
  ]);
  console.log("Connected chain ID:", chainId);
  console.log("USDC balance:", formatUnits(usdc, X402_DECIMALS));
  console.log("Test ETH balance for gas:", formatEther(eth));
  console.log("Ready for live payment:", chainId === 84532 && Boolean(payTo) && usdc >= BigInt(X402_AMOUNT) && eth > 0n);
} catch {
  console.log("Wallet or read-only balance check unavailable. No payment was sent.");
}
