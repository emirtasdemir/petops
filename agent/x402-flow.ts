import { executeX402Payment, prepareX402Payment } from "./x402-payment.ts";
import { getX402Proposal, finishX402Proposal, type X402Proposal } from "./x402-store.ts";
import type { ResponseLanguage } from "./response-language.ts";
import { x402Tools } from "./x402-tools.ts";

export type X402Review = Pick<X402Proposal, "id" | "petName" | "price" | "asset" | "amount" | "network" | "payTo" | "payer" | "status"> & {
  resource: string; responseLanguage: ResponseLanguage;
};
type Turn = { role: "user" | "agent"; text: string; x402Proposal?: X402Review };
type Reply = { answer: string; steps: { tool: string; args: unknown; result: unknown; error: boolean }[];
  x402Proposal?: X402Review; premiumReport?: unknown; payment?: { status: string; transactionHash: string; explorerUrl: string; responseLanguage: ResponseLanguage } };
type Handlers = {
  prepare: (petName: string, baseUrl: string, language: ResponseLanguage) => ReturnType<typeof prepareX402Payment>;
  execute: (id: string, baseUrl: string) => ReturnType<typeof executeX402Payment>;
};
const handlers: Handlers = {
  prepare: (petName, baseUrl, language) => x402Tools[0].run({ petName }, { baseUrl, responseLanguage: language }) as ReturnType<typeof prepareX402Payment>,
  execute: (id, baseUrl) => x402Tools[1].run({ proposalId: id }, { baseUrl, authorizedX402ProposalId: id }) as ReturnType<typeof executeX402Payment>,
};

export function parsePremiumRequest(text: string): string | null {
  const english = /^(?:please\s+)?(?:generate|create|prepare|show|get)\s+(?:me\s+)?(?:a\s+)?premium\s+(?:pet\s+)?care\s+report\s+for\s+([\p{L}\d_-]+)[.!]?$/iu.exec(text.trim());
  if (english) return english[1];
  const turkish = /^([\p{L}\d_-]+)\s+için\s+premium\s+(?:evcil hayvan\s+)?bakım\s+raporu\s+(?:hazırla|oluştur|göster)[.!]?$/iu.exec(text.trim());
  return turkish?.[1] ?? null;
}

const confirmId = (text: string) => /^CONFIRM_X402\s+([0-9a-f-]{36})$/i.exec(text.trim())?.[1] ?? null;
const approves = (text: string) => /^(?:yes,?\s*pay and continue|confirm payment|evet,?\s*öde ve devam et|ödemeyi onayla)[.!\s]*$/iu.test(text.trim());
const cancels = (text: string) => /^(?:cancel payment|no,?\s*do not pay|ödemeyi iptal et|hayır,?\s*ödeme)[.!\s]*$/iu.test(text.trim());
function safeError(error: unknown, language: ResponseLanguage) {
  const message = error instanceof Error ? error.message : "";
  if (/Pet profile not found/i.test(message)) return language === "tr" ? "Bu evcil hayvanın profili bulunamadı. Önce profilini kaydedin; ödeme yapılmadı." : "No profile was found for this pet. Save the profile first; no payment was made.";
  if (/not configured/i.test(message)) return language === "tr" ? "Premium ödeme alıcı adresi yapılandırılmamış. Ödeme yapılmadı." : "The premium payment recipient is not configured. No payment was made.";
  if (/no wallet yet|invalid/i.test(message) && !/proof/i.test(message)) return language === "tr" ? "Test cüzdanı hazır değil veya yapılandırması geçersiz. Ödeme yapılmadı." : "The test wallet is missing or invalid. No payment was made.";
  if (/no longer valid|already processing|was used/i.test(message)) return language === "tr" ? "Bu ödeme önerisi artık geçerli değil veya kullanıldı. Yeni bir inceleme başlatın." : "This payment review is expired or already used. Start a new review.";
  if (/changed after review|terms differ/i.test(message)) return language === "tr" ? "Ödeme koşulları değişti. Güvenlik için işlem durduruldu." : "Payment terms changed. The payment was stopped for safety.";
  return language === "tr"
    ? "x402 ödeme veya rapor alınamadı. Ödemenin durumu belirsiz olabilir; otomatik tekrar denemeyin."
    : "The x402 payment or report failed. Payment status may be uncertain; do not retry automatically.";
}

export async function handleX402Turn(history: Turn[], language: ResponseLanguage, baseUrl: string,
  actions: Handlers = handlers): Promise<Reply | null> {
  const text = history.at(-1)?.text.trim() || "";
  const petName = parsePremiumRequest(text);
  if (petName) {
    const args = { petName };
    try {
      const { proposal, httpStatus } = await actions.prepare(petName, baseUrl, language);
      const review: X402Review = {
        id: proposal.id, petName: proposal.petName, resource: "Premium Pet Care Report",
        price: proposal.price, asset: "USDC", amount: proposal.amount, network: "Base Sepolia Testnet",
        payTo: proposal.payTo, payer: proposal.payer, status: proposal.status, responseLanguage: language,
      };
      return { answer: language === "tr"
        ? "Premium bakım raporu HTTP 402 ile ödeme istedi. Aşağıdaki x402 ödeme bilgilerini inceleyin; henüz ödeme yapılmadı."
        : "The premium report returned HTTP 402 Payment Required. Review the x402 payment details below; no payment has been made.",
        steps: [{ tool: "prepare_x402_payment", args, result: { httpStatus, review }, error: false }],
        x402Proposal: review };
    } catch (error) {
      const answer = safeError(error, language);
      return { answer, steps: [{ tool: "prepare_x402_payment", args, result: { error: answer }, error: true }] };
    }
  }
  const id = confirmId(text);
  if (!id && !approves(text) && !cancels(text)) return null;
  const previous = history.at(-2);
  const offered = previous?.role === "agent" ? previous.x402Proposal : undefined;
  if (!offered || (id && id !== offered.id)) return { answer: language === "tr"
    ? "Hemen önce gösterilmiş geçerli bir x402 ödeme incelemesi yok."
    : "There is no valid x402 payment review immediately before this message.", steps: [] };
  const responseLanguage = id ? offered.responseLanguage : language;
  const stored = getX402Proposal(offered.id);
  if (!stored || stored.status !== "pending_confirmation" || stored.payer !== offered.payer ||
      stored.payTo !== offered.payTo || stored.price !== offered.price || stored.petName !== offered.petName) {
    return { answer: responseLanguage === "tr" ? "Bu ödeme önerisi artık geçerli değil." : "This payment review is no longer valid.", steps: [] };
  }
  if (cancels(text)) {
    finishX402Proposal(stored.id, "cancelled");
    return { answer: responseLanguage === "tr" ? "Ödeme iptal edildi." : "Payment cancelled.", steps: [] };
  }
  const args = { proposalId: stored.id };
  try {
    const result = await actions.execute(stored.id, baseUrl);
    return { answer: responseLanguage === "tr"
      ? "x402 ödemesi tamamlandı. Premium bakım raporu aşağıda. İşlem: " + result.transactionHash
      : "x402 payment completed. Your premium care report is below. Transaction: " + result.transactionHash,
      steps: [{ tool: "execute_x402_payment", args, result, error: false }],
      premiumReport: result.report,
      payment: { status: result.status, transactionHash: result.transactionHash, explorerUrl: result.explorerUrl, responseLanguage } };
  } catch (error) {
    const answer = safeError(error, responseLanguage);
    return { answer, steps: [{ tool: "execute_x402_payment", args, result: { error: answer }, error: true }] };
  }
}
