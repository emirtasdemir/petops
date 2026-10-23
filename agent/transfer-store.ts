import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import type { TransferToken } from "./token-registry";

export type TransferStatus = "pending_confirmation" | "submitting" | "submitted" | "failed" | "cancelled";
export type TransferProposal = {
  id: string;
  token: TransferToken;
  amount: string;
  recipient: Address;
  from: Address;
  chainId: number;
  network: "Base Sepolia";
  status: TransferStatus;
  createdAt: string;
  transactionHash?: Hex;
};

function dataPath(): string {
  return path.resolve(process.env.PETOPS_TRANSFER_FILE || path.join(process.cwd(), ".petops-transfers.json"));
}

function readAll(): TransferProposal[] {
  const file = dataPath();
  if (!fs.existsSync(file)) return [];
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(value)) throw new Error("Transfer proposal storage is invalid.");
  return value as TransferProposal[];
}

function writeAll(proposals: TransferProposal[]): void {
  const file = dataPath();
  const temp = `${file}.tmp-${randomUUID()}`;
  fs.writeFileSync(temp, JSON.stringify(proposals, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function saveTransferProposal(fields: Omit<TransferProposal, "id" | "status" | "createdAt">): TransferProposal {
  const proposals = readAll();
  const proposal: TransferProposal = {
    ...fields, id: randomUUID(), status: "pending_confirmation", createdAt: new Date().toISOString(),
  };
  proposals.push(proposal);
  writeAll(proposals);
  return proposal;
}

export function getTransferProposal(id: string): TransferProposal | null {
  return readAll().find((item) => item.id === id) ?? null;
}

export function claimTransferProposal(id: string): TransferProposal {
  const file = dataPath();
  const lockPath = `${file}.lock-${id}`;
  try {
    fs.closeSync(fs.openSync(lockPath, "wx", 0o600));
  } catch {
    throw new Error("This transfer proposal is already being processed or was used.");
  }
  const proposals = readAll();
  const proposal = proposals.find((item) => item.id === id);
  if (!proposal || proposal.status !== "pending_confirmation") {
    throw new Error("This transfer proposal is no longer pending confirmation.");
  }
  proposal.status = "submitting";
  writeAll(proposals);
  return proposal;
}

export function finishTransferProposal(id: string, status: "submitted" | "failed", transactionHash?: Hex): TransferProposal {
  const proposals = readAll();
  const proposal = proposals.find((item) => item.id === id);
  if (!proposal || proposal.status !== "submitting") throw new Error("Transfer proposal is not submitting.");
  proposal.status = status;
  if (transactionHash) proposal.transactionHash = transactionHash;
  writeAll(proposals);
  return proposal;
}

export function cancelTransferProposal(id: string): TransferProposal | null {
  const proposals = readAll();
  const proposal = proposals.find((item) => item.id === id);
  if (!proposal || proposal.status !== "pending_confirmation") return null;
  proposal.status = "cancelled";
  writeAll(proposals);
  return proposal;
}
