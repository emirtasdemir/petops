import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type X402Status = "pending_confirmation" | "submitting" | "completed" | "failed" | "cancelled";
export type X402Proposal = {
  id: string; petId: string; petName: string; resource: string; price: string;
  asset: string; amount: string; network: string; payTo: string; payer: string;
  status: X402Status; createdAt: string; transactionHash?: string;
};

const filePath = () => path.resolve(process.env.PETOPS_X402_FILE || path.join(process.cwd(), ".petops-x402.json"));
function readAll(): X402Proposal[] {
  if (!fs.existsSync(filePath())) return [];
  const value: unknown = JSON.parse(fs.readFileSync(filePath(), "utf8"));
  if (!Array.isArray(value)) throw new Error("Payment proposal storage is invalid.");
  return value as X402Proposal[];
}
function writeAll(items: X402Proposal[]) {
  const file = filePath();
  const temp = file + ".tmp-" + randomUUID();
  fs.writeFileSync(temp, JSON.stringify(items, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function saveX402Proposal(fields: Omit<X402Proposal, "id" | "status" | "createdAt">): X402Proposal {
  const items = readAll();
  const proposal = { ...fields, id: randomUUID(), status: "pending_confirmation" as const, createdAt: new Date().toISOString() };
  items.push(proposal);
  writeAll(items);
  return proposal;
}
export function getX402Proposal(id: string): X402Proposal | null {
  return readAll().find((item) => item.id === id) ?? null;
}
export function claimX402Proposal(id: string): X402Proposal {
  const lock = filePath() + ".lock-" + id;
  try { fs.closeSync(fs.openSync(lock, "wx", 0o600)); }
  catch { throw new Error("Payment proposal is already processing or was used."); }
  const items = readAll();
  const proposal = items.find((item) => item.id === id);
  if (!proposal || proposal.status !== "pending_confirmation" || Date.now() - Date.parse(proposal.createdAt) > 10 * 60_000) {
    throw new Error("Payment proposal is no longer valid.");
  }
  proposal.status = "submitting";
  writeAll(items);
  return proposal;
}
export function finishX402Proposal(id: string, status: "completed" | "failed" | "cancelled", transactionHash?: string) {
  const items = readAll();
  const proposal = items.find((item) => item.id === id);
  if (!proposal || (proposal.status !== "submitting" && !(status === "cancelled" && proposal.status === "pending_confirmation"))) {
    throw new Error("Payment proposal cannot be updated.");
  }
  proposal.status = status;
  if (transactionHash) proposal.transactionHash = transactionHash;
  writeAll(items);
  return proposal;
}
