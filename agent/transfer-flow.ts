import { transferTools } from "./transfer-tools.ts";
import { cancelTransferProposal, getTransferProposal, type TransferProposal } from "./transfer-store.ts";
import type { ResponseLanguage } from "./response-language";

export type TransferReview = Pick<TransferProposal,
  "id" | "token" | "amount" | "recipient" | "from" | "network" | "chainId" | "status"> & {
    responseLanguage: ResponseLanguage;
  };

type ChatTurn = { role: "user" | "agent"; text: string; transferProposal?: TransferReview };
type TransferStep = { tool: string; args: unknown; result: unknown; error: boolean };
type TransferReply = { answer: string; steps: TransferStep[]; transferProposal?: TransferReview };
type TransferHandlers = {
  prepare: (args: { token: string; amount: string; recipient: string }, text: string) => Promise<{ proposal: TransferProposal }>;
  execute: (proposalId: string, text: string) => Promise<{ transactionHash: string; explorerUrl: string }>;
};

const productionHandlers: TransferHandlers = {
  prepare: (args, text) => transferTools[0].run(args, { baseUrl: "", userMessage: text }) as Promise<{ proposal: TransferProposal }>,
  execute: (proposalId, text) => transferTools[1].run({ proposalId }, {
    baseUrl: "", userMessage: text, authorizedTransferProposalId: proposalId,
  }) as Promise<{ transactionHash: string; explorerUrl: string }>,
};

export function parseTransferRequest(message: string): { token: string; amount: string; recipient: string } | null {
  const text = message.trim();
  const english = /^(?:please\s+)?(?:send|transfer)\s+([+-]?\d+(?:\.\d+)?)\s+([A-Za-z0-9]+)\s+to\s+(\S+)[.!]?$/i.exec(text);
  if (english) return { amount: english[1], token: english[2], recipient: english[3].replace(/[.!]$/, "") };
  const turkish = /^([+-]?\d+(?:\.\d+)?)\s+([A-Za-z0-9]+)\s+(\S+)\s+adresine\s+gönder[.!]?$/iu.exec(text);
  if (turkish) return { amount: turkish[1], token: turkish[2], recipient: turkish[3].replace(/[.!]$/, "") };
  return null;
}

function transferIntent(message: string): boolean {
  return /^(?:please\s+)?(?:send|transfer)\b/iu.test(message.trim()) &&
    /\b(?:ETH|USDC)\b|0x[0-9a-f]/iu.test(message);
}

function confirmId(message: string): string | null {
  const button = /^CONFIRM_TRANSFER\s+([0-9a-f-]{36})$/iu.exec(message.trim());
  return button?.[1] ?? null;
}

function confirmsTransfer(message: string): boolean {
  return /^(?:yes,?\s*send it|confirm|proceed with the transfer|evet,?\s*gönder|transferi onayla)[.!\s]*$/iu.test(message.trim());
}

function cancelsTransfer(message: string): boolean {
  return /^(?:no,?\s*(?:do not|don't) send it|cancel(?: the)? transfer|hayır,?\s*gönderme|transferi iptal et)[.!\s]*$/iu.test(message.trim());
}

function safeError(error: unknown, language: ResponseLanguage): string {
  const message = error instanceof Error ? error.message : String(error);
  const rules: Array<[RegExp, string, string]> = [
    [/Recipient must be a valid EVM address/i, "Recipient must be a valid EVM address.", "Alıcı geçerli bir EVM adresi olmalı."],
    [/Amount must be|too many decimal/i, "Enter a valid positive token amount.", "Geçerli ve sıfırdan büyük bir token miktarı girin."],
    [/USDC is not configured|Only ETH and configured USDC/i, "This token is not configured for Base Sepolia.", "Bu token Base Sepolia için yapılandırılmamış."],
    [/no wallet yet/i, "Create the optional agent test wallet before preparing a transfer.", "Transfer hazırlamadan önce agent test cüzdanını oluşturun."],
    [/invalid private key/i, "The agent test wallet is not configured correctly. No transaction was submitted.", "Agent test cüzdanı doğru yapılandırılmamış. İşlem gönderilmedi."],
    [/Insufficient/i, "The test wallet does not have enough token or test ETH for gas. No transaction was submitted.", "Test cüzdanında token veya gas için yeterli test ETH yok. İşlem gönderilmedi."],
    [/expired|no longer pending|already being processed|was used/i, "This proposal is expired or already used. Prepare a new transfer review.", "Bu önerinin süresi doldu veya daha önce kullanıldı. Yeni bir transfer incelemesi hazırlayın."],
    [/Base Sepolia|wallet changed|metadata does not match/i, "Transfer safety checks failed. No transaction was submitted.", "Transfer güvenlik kontrolleri başarısız oldu. İşlem gönderilmedi."],
  ];
  const match = rules.find(([pattern]) => pattern.test(message));
  return match ? language === "tr" ? match[2] : match[1]
    : language === "tr" ? "Transfer tamamlanamadı veya gönderim durumu belirsiz. Aynı işlemi otomatik tekrar denemeyin."
      : "The transfer could not be completed or its submission status is uncertain. Do not retry it automatically.";
}

function review(proposal: TransferProposal, language: ResponseLanguage): TransferReview {
  return {
    id: proposal.id, token: proposal.token, amount: proposal.amount, recipient: proposal.recipient,
    from: proposal.from, network: proposal.network, chainId: proposal.chainId,
    status: proposal.status, responseLanguage: language,
  };
}

export async function handleTransferTurn(history: ChatTurn[], language: ResponseLanguage, handlers: TransferHandlers = productionHandlers): Promise<TransferReply | null> {
  const text = history.at(-1)?.text.trim() ?? "";
  const parsed = parseTransferRequest(text);
  if (parsed || transferIntent(text)) {
    if (!parsed) return { answer: language === "tr"
      ? "Transfer için miktarı, tokenı ve alıcı adresini birlikte yazın. Örnek: 0.001 ETH 0x... adresine gönder."
      : "Include the amount, token, and recipient address. Example: Send 0.001 ETH to 0x...", steps: [] };
    const tool = transferTools.find((item) => item.name === "prepare_token_transfer")!;
    try {
      const result = await handlers.prepare(parsed, text);
      const proposal = result.proposal;
      return {
        answer: language === "tr"
          ? `${proposal.amount} ${proposal.token} tutarını ${proposal.from} adresinden ${proposal.recipient} adresine Base Sepolia test ağında göndermeyi hazırladım. İşlem henüz gönderilmedi. İnceleyip açıkça onaylayın.`
          : `Review this Base Sepolia testnet transfer: ${proposal.amount} ${proposal.token} from ${proposal.from} to ${proposal.recipient}. Nothing has been sent yet. Confirm only if these details are correct.`,
        steps: [{ tool: tool.name, args: parsed, result, error: false }],
        transferProposal: review(proposal, language),
      };
    } catch (error) {
      const message = safeError(error, language);
      return { answer: message, steps: [{ tool: tool.name, args: parsed, result: { error: message }, error: true }] };
    }
  }

  const previous = history.at(-2);
  const offered = previous?.role === "agent" ? previous.transferProposal : undefined;
  const requestedId = confirmId(text);
  if (!requestedId && !confirmsTransfer(text) && !cancelsTransfer(text)) return null;
  if (!offered || (requestedId && requestedId !== offered.id)) {
    return { answer: language === "tr" ? "Hemen önce sunulmuş geçerli bir transfer önerisi yok." : "There is no valid transfer proposal immediately before this message.", steps: [] };
  }
  const responseLanguage = requestedId ? offered.responseLanguage : language;
  if (cancelsTransfer(text)) {
    cancelTransferProposal(offered.id);
    return { answer: responseLanguage === "tr" ? "Transfer iptal edildi; işlem gönderilmedi." : "Transfer cancelled; no transaction was sent.", steps: [] };
  }
  const stored = getTransferProposal(offered.id);
  if (!stored || stored.status !== "pending_confirmation" || stored.from !== offered.from ||
      stored.recipient !== offered.recipient || stored.amount !== offered.amount || stored.token !== offered.token) {
    return { answer: responseLanguage === "tr" ? "Transfer önerisi artık geçerli değil. Yeni bir inceleme hazırlayın." : "That transfer proposal is no longer valid. Prepare a new review.", steps: [] };
  }
  const tool = transferTools.find((item) => item.name === "execute_token_transfer")!;
  const args = { proposalId: stored.id };
  try {
    const result = await handlers.execute(stored.id, text);
    return {
      answer: responseLanguage === "tr"
        ? `Transfer Base Sepolia ağına gönderildi. İşlem kimliği: ${result.transactionHash}. Explorer: ${result.explorerUrl}`
        : `Transfer submitted to Base Sepolia. Transaction hash: ${result.transactionHash}. Explorer: ${result.explorerUrl}`,
      steps: [{ tool: tool.name, args, result, error: false }],
    };
  } catch (error) {
    const message = safeError(error, responseLanguage);
    return { answer: message, steps: [{ tool: tool.name, args, result: { error: message }, error: true }] };
  }
}
