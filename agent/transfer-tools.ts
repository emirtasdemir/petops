import type { Tool } from "./tools";
import { executeTokenTransfer, prepareTokenTransfer } from "./token-transfer.ts";

function textField(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

export const transferTools: Tool[] = [
  {
    name: "prepare_token_transfer",
    description: "Validate a user-requested ETH or configured USDC transfer on Base Sepolia and create a reviewable proposal. Never sends a transaction. Never invent or change token, amount, or recipient.",
    parameters: {
      type: "object", properties: {
        token: { type: "string", description: "Exact token requested by the user: ETH or configured USDC." },
        amount: { type: "string", description: "Exact positive decimal amount requested by the user." },
        recipient: { type: "string", description: "Exact recipient EVM address requested by the user." },
      }, required: ["token", "amount", "recipient"], additionalProperties: false,
    },
    run: async (args: unknown) => {
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Transfer arguments are invalid.");
      const value = args as Record<string, unknown>;
      const proposal = await prepareTokenTransfer({
        token: textField(value.token, "token"), amount: textField(value.amount, "amount"),
        recipient: textField(value.recipient, "recipient"),
      });
      return { proposal, awaitingConfirmation: true };
    },
  },
  {
    name: "execute_token_transfer",
    description: "Submit one previously reviewed transfer on Base Sepolia only after explicit confirmation of that exact proposal. Never call from ordinary model tool selection; the server confirmation flow authorizes it.",
    parameters: {
      type: "object", properties: { proposalId: { type: "string", description: "The exact pending transfer proposal ID." } },
      required: ["proposalId"], additionalProperties: false,
    },
    run: async (args: unknown, ctx) => {
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Transfer arguments are invalid.");
      const proposalId = textField((args as Record<string, unknown>).proposalId, "proposalId");
      if (ctx.authorizedTransferProposalId !== proposalId) throw new Error("Explicit confirmation of this transfer proposal is required.");
      return executeTokenTransfer(proposalId);
    },
  },
];
