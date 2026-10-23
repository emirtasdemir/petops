/**
 * THE AGENT'S WALLET
 *
 * The agent owns a wallet (a private key). It uses it to sign payments,
 * so it can pay for APIs on its own. This is the "x402" idea:
 *
 *   1. Agent calls an API         ->  API answers "402 Payment Required" + a price
 *   2. Agent signs a payment      ->  with its wallet
 *   3. Agent retries with payment ->  API checks the signature and answers 200 OK
 *
 * In deployments, WALLET_PRIVATE_KEY keeps the same wallet across restarts.
 * Locally, "Create wallet" saves a wallet in `.agent-wallet.json`.
 *
 * Payments here are signed but NOT sent on-chain (it's a demo, no real money).
 */
import fs from "fs";
import path from "path";
import { createPublicClient, formatEther, http, verifyMessage, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const WALLET_FILE = path.join(process.cwd(), ".agent-wallet.json");
const chain = createPublicClient({ chain: baseSepolia, transport: http() });

export type Payment = { from: Address; to: Address; amount: string; asset: string; resource: string; nonce: string };

/** Deployment configuration takes precedence; a blank env placeholder permits local mode. */
export function getWalletSource(): "environment" | "local" | null {
  if (process.env.WALLET_PRIVATE_KEY?.trim()) return "environment";
  return fs.existsSync(WALLET_FILE) ? "local" : null;
}

/** The wallet from deployment env or the local file, or null if neither exists. */
function loadAccount() {
  const source = getWalletSource();
  if (!source) return null;
  let localRecord: unknown = null;
  if (source === "local") {
    try {
      localRecord = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));
    } catch {
      throw new Error("The local wallet file is invalid.");
    }
  }
  const key: unknown = source === "environment"
    ? process.env.WALLET_PRIVATE_KEY?.trim()
    : localRecord && typeof localRecord === "object" ? (localRecord as Record<string, unknown>).privateKey : undefined;
  if (typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(source === "environment" ? "WALLET_PRIVATE_KEY is invalid." : "The local wallet file is invalid.");
  }
  try {
    const account = privateKeyToAccount(key as Hex);
    if (source === "local") {
      const storedAddress = (localRecord as Record<string, unknown>).address;
      if (storedAddress !== undefined &&
          (typeof storedAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(storedAddress) ||
            storedAddress.toLowerCase() !== account.address.toLowerCase())) {
        throw new Error("Local wallet address does not match its private key.");
      }
    }
    return account;
  } catch {
    throw new Error(source === "environment" ? "WALLET_PRIVATE_KEY is invalid." : "The local wallet file is invalid.");
  }
}

function requireAccount() {
  const account = loadAccount();
  if (!account) throw new Error("The agent has no wallet yet. Ask the user to click 'Create wallet' first.");
  return account;
}

/** Make a brand new wallet and save it. The factory supports isolated tests with a fake key. */
export function createWallet(keyGenerator: () => Hex = generatePrivateKey) {
  const existing = loadAccount();
  if (existing) return existing.address;
  const privateKey = keyGenerator();
  const account = privateKeyToAccount(privateKey);
  fs.writeFileSync(WALLET_FILE, JSON.stringify({ address: account.address, privateKey }, null, 2), { mode: 0o600 });
  return account.address;
}

export function getWalletAddress() {
  return loadAccount()?.address ?? null;
}

/** Server-only signing account and Base Sepolia public client for confirmed transfers. */
export function getBaseSepoliaTransferContext() {
  return { account: requireAccount(), publicClient: chain };
}

export async function getWalletBalance() {
  const wei = await chain.getBalance({ address: requireAccount().address });
  return `${formatEther(wei)} ETH`;
}

/** Fetch a URL. If it asks for payment (402), sign one with the wallet and try again. */
export async function payAndFetch(url: string) {
  const first = await fetch(url);
  if (first.status !== 402) return { data: await first.json() };

  const account = requireAccount();
  const { price, asset, payTo } = await first.json();
  const payment: Payment = {
    from: account.address,
    to: payTo,
    amount: price,
    asset,
    resource: new URL(url).pathname,
    nonce: crypto.randomUUID(),
  };
  const signature = await account.signMessage({ message: JSON.stringify(payment) });
  const header = Buffer.from(JSON.stringify({ payment, signature })).toString("base64");

  const paid = await fetch(url, { headers: { "X-PAYMENT": header } });
  return {
    data: await paid.json(),
    payment: { status: paid.status, amount: `${price} ${asset}`, to: payTo, signature: `${signature.slice(0, 18)}...` },
  };
}

/** Used by the API: is this X-PAYMENT header a real, signed payment? */
export async function verifyPayment(header: string | null) {
  if (!header) return null;
  try {
    const { payment, signature } = JSON.parse(Buffer.from(header, "base64").toString()) as {
      payment: Payment;
      signature: Hex;
    };
    const valid = await verifyMessage({ address: payment.from, message: JSON.stringify(payment), signature });
    return valid ? payment : null;
  } catch {
    return null;
  }
}
