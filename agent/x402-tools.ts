import type { Tool } from "./tools";
import { executeX402Payment, prepareX402Payment } from "./x402-payment.ts";

export const x402Tools: Tool[] = [
  {
    name: "prepare_x402_payment",
    description: "Request the Premium Pet Care Report, parse its real HTTP 402 x402 requirement, and create a user-reviewable payment proposal. Does not pay.",
    parameters: {
      type: "object", properties: { petName: { type: "string" } },
      required: ["petName"], additionalProperties: false,
    },
    run: async (args: unknown, ctx) => {
      const name = args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>).petName : undefined;
      if (typeof name !== "string" || !name.trim()) throw new Error("Pet name is required.");
      return prepareX402Payment(name.trim(), ctx.baseUrl, fetch, ctx.responseLanguage);
    },
  },
  {
    name: "execute_x402_payment",
    description: "Pay one reviewed x402 proposal and fetch the Premium Pet Care Report only after explicit user confirmation. Never select from ordinary model tool calls.",
    parameters: {
      type: "object", properties: { proposalId: { type: "string" } },
      required: ["proposalId"], additionalProperties: false,
    },
    run: async (args: unknown, ctx) => {
      const id = args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>).proposalId : undefined;
      if (typeof id !== "string" || ctx.authorizedX402ProposalId !== id) {
        throw new Error("Explicit confirmation of this x402 payment proposal is required.");
      }
      return executeX402Payment(id, ctx.baseUrl);
    },
  },
];
