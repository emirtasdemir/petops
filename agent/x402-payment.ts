import "server-only";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired, PaymentPayload, SettleResponse } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { getBaseSepoliaTransferContext } from "./wallet.ts";
import { PREMIUM_PATH, PREMIUM_PRICE, X402_AMOUNT, X402_ASSET, X402_NETWORK, premiumPayTo } from "./x402-config.ts";
import { findPetProfile } from "./pet-store.ts";
import { claimX402Proposal, finishX402Proposal, saveX402Proposal, type X402Proposal } from "./x402-store.ts";
import type { ResponseLanguage } from "./response-language.ts";

type HTTPPort = Pick<x402HTTPClient, "getPaymentRequiredResponse" | "createPaymentPayload" |
  "encodePaymentSignatureHeader" | "getPaymentSettleResponse">;
type FetchPort = typeof fetch;

export function reportUrl(baseUrl: string, petId: string, language: ResponseLanguage = "en"): string {
  const url = new URL(PREMIUM_PATH, baseUrl);
  url.searchParams.set("petId", petId);
  url.searchParams.set("lang", language);
  return url.toString();
}

/** Next.js can canonicalize a local 127.0.0.1 request to localhost in the 402 resource URL. */
export function samePremiumResource(declaredUrl: string, requestedUrl: string): boolean {
  const declared = new URL(declaredUrl, requestedUrl);
  const requested = new URL(requestedUrl);
  if (declared.toString() === requested.toString()) return true;
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  return loopback.has(declared.hostname) && loopback.has(requested.hostname) &&
    declared.protocol === requested.protocol && declared.port === requested.port &&
    declared.pathname === requested.pathname && declared.search === requested.search &&
    declared.hash === requested.hash;
}

export function parsePremiumRequirement(response: Response, expectedUrl: string) {
  if (response.status !== 402) throw new Error("Premium resource did not return an x402 payment requirement.");
  const protocol = new x402HTTPClient(new x402Client());
  const required = protocol.getPaymentRequiredResponse((name) => response.headers.get(name));
  const payTo = premiumPayTo();
  const option = required.accepts.find((item) => item.scheme === "exact" &&
    item.network === X402_NETWORK && item.asset.toLowerCase() === X402_ASSET.toLowerCase() &&
    item.amount === X402_AMOUNT && Boolean(payTo) && item.payTo.toLowerCase() === payTo!.toLowerCase());
  if (!option || required.accepts.length !== 1 || required.x402Version !== 2 ||
      !samePremiumResource(required.resource.url, expectedUrl)) {
    throw new Error("Premium x402 terms differ from the configured price, asset, recipient, network, or resource.");
  }
  return { required, option };
}

export async function prepareX402Payment(petName: string, baseUrl: string, fetchImpl: FetchPort = fetch,
  language: ResponseLanguage = "en") {
  const pet = findPetProfile(undefined, petName);
  const { account } = getBaseSepoliaTransferContext();
  if (!premiumPayTo()) throw new Error("Premium payment recipient is not configured.");
  const url = reportUrl(baseUrl, pet.id, language);
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const { option } = parsePremiumRequirement(response, url);
  const proposal = saveX402Proposal({
    petId: pet.id, petName: pet.name, resource: url, price: PREMIUM_PRICE, asset: option.asset,
    amount: option.amount, network: option.network, payTo: option.payTo, payer: account.address,
  });
  return { proposal, httpStatus: response.status };
}

function sameTerms(required: PaymentRequired, proposal: X402Proposal) {
  if (required.x402Version !== 2 || required.accepts.length !== 1 ||
      !samePremiumResource(required.resource.url, proposal.resource)) return false;
  const item = required.accepts[0];
  return item.scheme === "exact" && item.network === proposal.network &&
    item.asset.toLowerCase() === proposal.asset.toLowerCase() && item.amount === proposal.amount &&
    item.payTo.toLowerCase() === proposal.payTo.toLowerCase();
}

export async function performPaidReport(proposal: X402Proposal, protocol: HTTPPort, fetchImpl: FetchPort) {
  const unpaid = await fetchImpl(proposal.resource, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (unpaid.status !== 402) throw new Error("Premium resource no longer requires payment.");
  const required = protocol.getPaymentRequiredResponse((name) => unpaid.headers.get(name));
  if (!sameTerms(required, proposal)) throw new Error("Premium x402 terms changed after review.");
  const payload: PaymentPayload = await protocol.createPaymentPayload(required);
  const paymentHeaders = protocol.encodePaymentSignatureHeader(payload);
  const paid = await fetchImpl(proposal.resource, {
    headers: { Accept: "application/json", ...paymentHeaders }, cache: "no-store",
  });
  if (!paid.ok) throw new Error("x402 payment or premium resource failed; the payment status may be uncertain.");
  const settlement: SettleResponse = protocol.getPaymentSettleResponse((name) => paid.headers.get(name));
  if (!settlement.success || settlement.network !== X402_NETWORK ||
      !/^0x[0-9a-fA-F]{64}$/.test(settlement.transaction)) {
    throw new Error("x402 settlement proof is missing or invalid.");
  }
  const report: unknown = await paid.json();
  return { report, transactionHash: settlement.transaction,
    explorerUrl: "https://sepolia.basescan.org/tx/" + settlement.transaction,
    status: "completed" as const };
}

export async function executeX402Payment(proposalId: string, baseUrl: string,
  dependencies?: { protocol: HTTPPort; fetchImpl: FetchPort }) {
  const proposal = claimX402Proposal(proposalId);
  try {
    const { account } = getBaseSepoliaTransferContext();
    if (account.address.toLowerCase() !== proposal.payer.toLowerCase() ||
        premiumPayTo()?.toLowerCase() !== proposal.payTo.toLowerCase() ||
        new URL(proposal.resource).origin !== new URL(baseUrl).origin) {
      throw new Error("Payment wallet, recipient, or resource changed after review.");
    }
    const protocol = dependencies?.protocol ?? new x402HTTPClient(
      new x402Client().register(X402_NETWORK, new ExactEvmScheme(account)));
    const result = await performPaidReport(proposal, protocol, dependencies?.fetchImpl ?? fetch);
    finishX402Proposal(proposal.id, "completed", result.transactionHash);
    return result;
  } catch (error) {
    finishX402Proposal(proposal.id, "failed");
    throw error;
  }
}
