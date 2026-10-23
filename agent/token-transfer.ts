import { createWalletClient, getAddress, http, isAddress, parseAbi, parseEther, parseUnits, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { configuredUsdc, type TransferToken } from "./token-registry.ts";
import { getBaseSepoliaTransferContext } from "./wallet.ts";
import { claimTransferProposal, finishTransferProposal, getTransferProposal, saveTransferProposal, type TransferProposal } from "./transfer-store.ts";

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 value) returns (bool)",
]);

export type TransferGateway = {
  address: Address;
  chainId: () => Promise<number>;
  nativeBalance: () => Promise<bigint>;
  gasPrice: () => Promise<bigint>;
  estimateEthGas: (to: Address, value: bigint) => Promise<bigint>;
  sendEth: (to: Address, value: bigint) => Promise<Hex>;
  tokenMetadata: (contract: Address) => Promise<{ symbol: string; decimals: number }>;
  tokenBalance: (contract: Address) => Promise<bigint>;
  estimateTokenGas: (contract: Address, to: Address, value: bigint) => Promise<bigint>;
  sendToken: (contract: Address, to: Address, value: bigint) => Promise<Hex>;
};

export function liveTransferGateway(): TransferGateway {
  const { account, publicClient } = getBaseSepoliaTransferContext();
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });
  return {
    address: account.address,
    chainId: () => publicClient.getChainId(),
    nativeBalance: () => publicClient.getBalance({ address: account.address }),
    gasPrice: () => publicClient.getGasPrice(),
    estimateEthGas: (to, value) => publicClient.estimateGas({ account: account.address, to, value }),
    sendEth: (to, value) => walletClient.sendTransaction({ account, chain: baseSepolia, to, value }),
    tokenMetadata: async (contract) => ({
      symbol: await publicClient.readContract({ address: contract, abi: erc20Abi, functionName: "symbol" }),
      decimals: await publicClient.readContract({ address: contract, abi: erc20Abi, functionName: "decimals" }),
    }),
    tokenBalance: (contract) => publicClient.readContract({ address: contract, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    estimateTokenGas: (contract, to, value) => publicClient.estimateContractGas({ account: account.address, address: contract, abi: erc20Abi, functionName: "transfer", args: [to, value] }),
    sendToken: (contract, to, value) => walletClient.writeContract({ account, chain: baseSepolia, address: contract, abi: erc20Abi, functionName: "transfer", args: [to, value] }),
  };
}

function units(amount: string, token: TransferToken): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) throw new Error("Amount must be a positive decimal number.");
  const decimals = token === "ETH" ? 18 : configuredUsdc()?.decimals;
  if (decimals === undefined) throw new Error("USDC is not configured for Base Sepolia.");
  let value: bigint;
  try {
    value = token === "ETH" ? parseEther(amount) : parseUnits(amount, decimals);
  } catch {
    throw new Error("Amount has too many decimal places for the selected token.");
  }
  if (value <= 0n) throw new Error("Amount must be greater than zero.");
  return value;
}

async function requireNetwork(gateway: TransferGateway): Promise<void> {
  if (await gateway.chainId() !== baseSepolia.id) throw new Error("Transfers are limited to Base Sepolia testnet.");
}

async function requireTokenMetadata(gateway: TransferGateway): Promise<Address> {
  const token = configuredUsdc();
  if (!token || token.chainId !== baseSepolia.id) throw new Error("USDC is not configured for Base Sepolia.");
  const onChain = await gateway.tokenMetadata(token.contractAddress);
  if (onChain.symbol !== token.symbol || onChain.decimals !== token.decimals) {
    throw new Error("Configured USDC contract metadata does not match Base Sepolia on-chain data.");
  }
  return token.contractAddress;
}

export async function prepareTokenTransfer(input: { token: string; amount: string; recipient: string }, gateway?: TransferGateway): Promise<TransferProposal> {
  const token = input.token.toUpperCase();
  if (token !== "ETH" && token !== "USDC") throw new Error("Only ETH and configured USDC are supported on Base Sepolia.");
  if (!isAddress(input.recipient)) throw new Error("Recipient must be a valid EVM address.");
  const amount = input.amount.trim();
  units(amount, token);
  const activeGateway = gateway ?? liveTransferGateway();
  await requireNetwork(activeGateway);
  if (token === "USDC") await requireTokenMetadata(activeGateway);
  return saveTransferProposal({
    token, amount, recipient: getAddress(input.recipient), from: activeGateway.address,
    chainId: baseSepolia.id, network: "Base Sepolia",
  });
}

export async function executeTokenTransfer(id: string, gateway: TransferGateway = liveTransferGateway()) {
  const stored = getTransferProposal(id);
  if (!stored || stored.status !== "pending_confirmation") throw new Error("This transfer proposal is no longer pending confirmation.");
  if (Date.now() - Date.parse(stored.createdAt) > 10 * 60_000) throw new Error("This transfer proposal expired. Prepare a new review.");
  if (stored.chainId !== baseSepolia.id || stored.network !== "Base Sepolia") throw new Error("Transfers are limited to Base Sepolia testnet.");
  if (!isAddress(stored.recipient) || !isAddress(stored.from)) throw new Error("Transfer proposal contains an invalid address.");
  if (getAddress(stored.from) !== getAddress(gateway.address)) throw new Error("The agent wallet changed since this proposal was prepared.");
  await requireNetwork(gateway);
  const proposal = claimTransferProposal(id);
  let transactionHash: Hex;
  try {
    const value = units(proposal.amount, proposal.token);
    const nativeBalance = await gateway.nativeBalance();
    const gasPrice = await gateway.gasPrice();
    if (proposal.token === "ETH") {
      if (nativeBalance <= value) throw new Error("Insufficient Base Sepolia test ETH balance.");
      const gas = await gateway.estimateEthGas(proposal.recipient, value);
      if (nativeBalance < value + gas * gasPrice) throw new Error("Insufficient Base Sepolia test ETH for amount and gas.");
      transactionHash = await gateway.sendEth(proposal.recipient, value);
    } else {
      const contract = await requireTokenMetadata(gateway);
      if (await gateway.tokenBalance(contract) < value) throw new Error("Insufficient configured USDC balance.");
      const gas = await gateway.estimateTokenGas(contract, proposal.recipient, value);
      if (nativeBalance < gas * gasPrice) throw new Error("Insufficient Base Sepolia test ETH for gas.");
      transactionHash = await gateway.sendToken(contract, proposal.recipient, value);
    }
  } catch (error) {
    finishTransferProposal(id, "failed");
    throw error;
  }
  // A returned hash means the RPC accepted the transaction. A later disk error must not
  // mislabel it as a failed submission or trigger another send; the claim lock remains.
  let statusPersisted = true;
  try {
    finishTransferProposal(id, "submitted", transactionHash);
  } catch {
    statusPersisted = false;
  }
  return {
    transactionHash, from: proposal.from, to: proposal.recipient, token: proposal.token,
    amount: proposal.amount, network: proposal.network, chainId: proposal.chainId,
    explorerUrl: `https://sepolia.basescan.org/tx/${transactionHash}`,
    status: "submitted" as const, statusPersisted,
  };
}
