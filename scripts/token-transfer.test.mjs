import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import test from "node:test";
import { handleTransferTurn } from "../agent/transfer-flow.ts";
import { executeTokenTransfer, prepareTokenTransfer } from "../agent/token-transfer.ts";
import { getTransferProposal } from "../agent/transfer-store.ts";

const from = "0x1111111111111111111111111111111111111111";
const to = "0x2222222222222222222222222222222222222222";
const hash = `0x${"a".repeat(64)}`;
const request = `Send 0.001 ETH to ${to}`;

function fixture(t, balance = 10n ** 18n) {
  const file = `${process.cwd()}/.petops-transfers.json.test-${randomUUID()}`;
  process.env.PETOPS_TRANSFER_FILE = file;
  t.after(() => {
    delete process.env.PETOPS_TRANSFER_FILE;
    for (const name of readdirSync(process.cwd()).filter((item) => item.startsWith(file.split("/").at(-1)))) {
      rmSync(`${process.cwd()}/${name}`, { force: true });
    }
  });
  let sends = 0;
  const gateway = {
    address: from,
    chainId: async () => 84532,
    nativeBalance: async () => balance,
    gasPrice: async () => 1n,
    estimateEthGas: async () => 21000n,
    sendEth: async () => { sends++; return hash; },
    tokenMetadata: async () => { throw new Error("Unexpected token read"); },
    tokenBalance: async () => { throw new Error("Unexpected token balance read"); },
    estimateTokenGas: async () => { throw new Error("Unexpected token gas estimate"); },
    sendToken: async () => { throw new Error("Unexpected token send"); },
  };
  const handlers = {
    prepare: async (args) => ({ proposal: await prepareTokenTransfer(args, gateway) }),
    execute: async (id) => executeTokenTransfer(id, gateway),
  };
  return { gateway, handlers, sends: () => sends };
}

async function offer(handlers, text = request) {
  const response = await handleTransferTurn([{ role: "user", text }], "en", handlers);
  assert.equal(response.steps[0]?.tool, "prepare_token_transfer");
  return response;
}

function replyTo(offerResponse, text) {
  return [
    { role: "user", text: request },
    { role: "agent", text: offerResponse.answer, transferProposal: offerResponse.transferProposal },
    { role: "user", text },
  ];
}

test("valid ETH request prepares a review without sending", async (t) => {
  const { handlers, sends } = fixture(t);
  const response = await offer(handlers);
  assert.ok(response.transferProposal, JSON.stringify(response));
  assert.equal(response.transferProposal?.amount, "0.001");
  assert.equal(response.transferProposal?.token, "ETH");
  assert.equal(response.transferProposal?.recipient, to);
  assert.equal(response.transferProposal?.network, "Base Sepolia");
  assert.equal(sends(), 0);
});

test("explicit confirmation executes once and returns a transaction hash", async (t) => {
  const { handlers, sends } = fixture(t);
  const prepared = await offer(handlers);
  const response = await handleTransferTurn(replyTo(prepared, "Yes, send it."), "en", handlers);
  assert.equal(response.steps[0]?.tool, "execute_token_transfer");
  assert.equal(response.steps[0]?.result.transactionHash, hash);
  assert.equal(sends(), 1);
  assert.equal(getTransferProposal(prepared.transferProposal.id)?.status, "submitted");
});

test("invalid recipient stops before any wallet send", async (t) => {
  const { handlers, sends } = fixture(t);
  const response = await offer(handlers, "Send 0.001 ETH to hello");
  assert.equal(response.steps[0]?.error, true);
  assert.match(response.answer, /valid EVM address/i);
  assert.equal(sends(), 0);
});

test("negative amount is rejected", async (t) => {
  const { handlers, sends } = fixture(t);
  const response = await offer(handlers, `Send -1 ETH to ${to}`);
  assert.equal(response.steps[0]?.error, true);
  assert.match(response.answer, /positive token amount/i);
  assert.equal(sends(), 0);
});

test("unrelated reply does not confirm or send", async (t) => {
  const { handlers, sends } = fixture(t);
  const prepared = await offer(handlers);
  const response = await handleTransferTurn(replyTo(prepared, "What is Luna's profile?"), "en", handlers);
  assert.equal(response, null);
  assert.equal(sends(), 0);
});

test("a used proposal cannot send again", async (t) => {
  const { handlers, sends } = fixture(t);
  const prepared = await offer(handlers);
  await handleTransferTurn(replyTo(prepared, "Confirm."), "en", handlers);
  const repeated = await handleTransferTurn(replyTo(prepared, "Yes, send it."), "en", handlers);
  assert.match(repeated.answer, /no longer valid/i);
  assert.equal(sends(), 1);
});

test("insufficient test ETH fails once without submitting", async (t) => {
  const { handlers, sends } = fixture(t, 1n);
  const prepared = await offer(handlers);
  const response = await handleTransferTurn(replyTo(prepared, "Proceed with the transfer."), "en", handlers);
  assert.equal(response.steps[0]?.error, true);
  assert.match(response.answer, /does not have enough/i);
  assert.equal(sends(), 0);
  assert.equal(getTransferProposal(prepared.transferProposal.id)?.status, "failed");
});

test("unconfigured USDC is rejected without inventing contract metadata", async (t) => {
  const { handlers, sends } = fixture(t);
  const previousAddress = process.env.BASE_SEPOLIA_USDC_ADDRESS;
  const previousDecimals = process.env.BASE_SEPOLIA_USDC_DECIMALS;
  delete process.env.BASE_SEPOLIA_USDC_ADDRESS;
  delete process.env.BASE_SEPOLIA_USDC_DECIMALS;
  t.after(() => {
    if (previousAddress === undefined) delete process.env.BASE_SEPOLIA_USDC_ADDRESS;
    else process.env.BASE_SEPOLIA_USDC_ADDRESS = previousAddress;
    if (previousDecimals === undefined) delete process.env.BASE_SEPOLIA_USDC_DECIMALS;
    else process.env.BASE_SEPOLIA_USDC_DECIMALS = previousDecimals;
  });
  const response = await offer(handlers, `Send 1 USDC to ${to}`);
  assert.equal(response.steps[0]?.error, true);
  assert.match(response.answer, /not configured/i);
  assert.equal(sends(), 0);
});

test("wrong chain is rejected before proposal creation", async (t) => {
  const { gateway, sends } = fixture(t);
  gateway.chainId = async () => 1;
  await assert.rejects(prepareTokenTransfer({ token: "ETH", amount: "0.001", recipient: to }, gateway), /Base Sepolia/);
  assert.equal(sends(), 0);
});

test("Turkish request prepares a Turkish review", async (t) => {
  const { handlers, sends } = fixture(t);
  const response = await handleTransferTurn([{ role: "user", text: `0.001 ETH ${to} adresine gönder` }], "tr", handlers);
  assert.equal(response.steps[0]?.tool, "prepare_token_transfer");
  assert.equal(response.transferProposal?.responseLanguage, "tr");
  assert.match(response.answer, /göndermeyi hazırladım/);
  assert.equal(sends(), 0);
});
