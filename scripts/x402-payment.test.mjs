import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { createPremiumHandler } from "../agent/premium-route-handler.ts";
import { canonicalPremiumRequest, petOpsOrigin } from "../agent/x402-origin.ts";
import { savePetProfile } from "../agent/pet-store.ts";
import { getWalletAddress } from "../agent/wallet.ts";
import { handleX402Turn } from "../agent/x402-flow.ts";
import { getX402Proposal } from "../agent/x402-store.ts";
import { executeX402Payment, parsePremiumRequirement, performPaidReport, prepareX402Payment, reportUrl, samePremiumResource } from "../agent/x402-payment.ts";
import { X402_ASSET, X402_AMOUNT, X402_NETWORK } from "../agent/x402-config.ts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const payTo = "0x2222222222222222222222222222222222222222";
const key = "0x" + "1".repeat(64); // Fixture only; never use a funded key.
const hash = "0x" + "a".repeat(64);
const baseUrl = "http://localhost:3000";
const requestText = "Generate a premium care report for Luna.";

function fixture(t) {
  const id = randomUUID();
  const dataFile = process.cwd() + "/.petops-data.json.test-" + id;
  const paymentFile = process.cwd() + "/.petops-x402.json.test-" + id;
  process.env.PETOPS_DATA_FILE = dataFile;
  process.env.PETOPS_X402_FILE = paymentFile;
  process.env.X402_PAY_TO_ADDRESS = payTo;
  process.env.WALLET_PRIVATE_KEY = key;
  t.after(() => {
    delete process.env.PETOPS_DATA_FILE;
    delete process.env.PETOPS_X402_FILE;
    delete process.env.X402_PAY_TO_ADDRESS;
    delete process.env.WALLET_PRIVATE_KEY;
    rmSync(dataFile, { force: true });
    rmSync(paymentFile, { force: true });
  });
  const pet = savePetProfile({ name: "Luna", species: "cat", age: 3, weightKg: 4.8 }).profile;
  let settlements = 0;
  let requests = 0;
  const facilitator = {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: X402_NETWORK }],
      extensions: [], signers: {},
    }),
    verify: async () => ({ isValid: true, payer: getWalletAddress() }),
    settle: async () => {
      settlements++;
      return { success: true, transaction: hash, network: X402_NETWORK, payer: getWalletAddress() };
    },
  };
  const handler = createPremiumHandler(payTo, facilitator);
  const fetchImpl = async (url, init) => {
    requests++;
    return handler(new NextRequest(url, init));
  };
  const account = privateKeyToAccount(key);
  const protocol = new x402HTTPClient(new x402Client().register(X402_NETWORK, new ExactEvmScheme(account)));
  const actions = {
    prepare: (name, origin, language) => prepareX402Payment(name, origin, fetchImpl, language),
    execute: async (proposalId, origin) => {
      const { executeX402Payment } = await import("../agent/x402-payment.ts");
      return executeX402Payment(proposalId, origin, { protocol, fetchImpl });
    },
  };
  return { pet, facilitator, fetchImpl, protocol, actions, settlements: () => settlements, requests: () => requests };
}

function confirmation(review, text = "Yes, pay and continue.") {
  return [{ role: "user", text: requestText },
    { role: "agent", text: review.answer, x402Proposal: review.x402Proposal },
    { role: "user", text }];
}

test("unpaid premium request receives HTTP 402", async (t) => {
  const f = fixture(t);
  const response = await f.fetchImpl(reportUrl(baseUrl, f.pet.id));
  assert.equal(response.status, 402);
  assert.ok(response.headers.get("PAYMENT-REQUIRED"));
  assert.equal(f.settlements(), 0);
});

test("x402 requirement parses official Base Sepolia USDC terms", async (t) => {
  const f = fixture(t);
  const url = reportUrl(baseUrl, f.pet.id);
  const response = await f.fetchImpl(url);
  const { option } = parsePremiumRequirement(response, url);
  assert.equal(option.network, X402_NETWORK);
  assert.equal(option.asset.toLowerCase(), X402_ASSET.toLowerCase());
  assert.equal(option.amount, X402_AMOUNT);
  assert.equal(option.payTo.toLowerCase(), payTo.toLowerCase());
});

test("local 127.0.0.1 and localhost describe the same protected resource", () => {
  const requested = "http://127.0.0.1:3100/api/premium/pet-report?petId=luna&lang=en";
  const declared = "http://localhost:3100/api/premium/pet-report?petId=luna&lang=en";
  assert.equal(samePremiumResource(declared, requested), true);
  assert.equal(samePremiumResource("http://example.com:3100/api/premium/pet-report?petId=luna&lang=en", requested), false);
  assert.equal(samePremiumResource("http://localhost:3101/api/premium/pet-report?petId=luna&lang=en", requested), false);
});

test("Render bind URL becomes the allowlisted public x402 resource", async (t) => {
  const f = fixture(t);
  const path = `/api/premium/pet-report?petId=${f.pet.id}&lang=en`;
  const publicUrl = `https://petops-u7si.onrender.com${path}`;
  const internalUrl = `https://0.0.0.0:10000${path}`;
  assert.equal(petOpsOrigin(internalUrl, true), "https://petops-u7si.onrender.com");
  const request = canonicalPremiumRequest(new NextRequest(internalUrl,
    { headers: { host: "0.0.0.0:10000" } }), true);
  assert.equal(request.url, publicUrl);
  const response = await createPremiumHandler(payTo, f.facilitator)(request);
  assert.equal(response.status, 402);
  const { required } = parsePremiumRequirement(response, publicUrl);
  assert.equal(required.resource.url, publicUrl);
  const fetchImpl = async (url, init) => createPremiumHandler(payTo, f.facilitator)(
    canonicalPremiumRequest(new NextRequest(url, init), true));
  const { proposal } = await prepareX402Payment("Luna", petOpsOrigin(internalUrl, true), fetchImpl);
  assert.equal(proposal.resource, publicUrl);
  assert.equal(proposal.payer, getWalletAddress());
  assert.equal(f.settlements(), 0);
});

test("production origin rejects external hosts and preserves local development", () => {
  const path = "/api/premium/pet-report?petId=luna&lang=en";
  assert.equal(petOpsOrigin(`https://petops-u7si.onrender.com${path}`, true), "https://petops-u7si.onrender.com");
  assert.equal(petOpsOrigin(`http://localhost:3000${path}`, true), "http://localhost:3000");
  assert.equal(petOpsOrigin(`http://localhost:3000${path}`, false), "http://localhost:3000");
  assert.throws(() => petOpsOrigin(`https://evil.example${path}`, true), /Unrecognized PetOps request origin/);
  assert.throws(() => petOpsOrigin(`https://0.0.0.0:9999${path}`, true), /Unrecognized PetOps request origin/);
  assert.equal(samePremiumResource(`https://evil.example${path}`, `https://petops-u7si.onrender.com${path}`), false);
});

test("review does not execute payment before approval", async (t) => {
  const f = fixture(t);
  const offer = await handleX402Turn([{ role: "user", text: requestText }], "en", baseUrl, f.actions);
  assert.equal(offer.steps[0].tool, "prepare_x402_payment");
  assert.equal(offer.x402Proposal.price, "$0.001");
  assert.equal(f.settlements(), 0);
  assert.equal(f.requests(), 1);
});

test("explicit confirmation executes a single x402 settlement", async (t) => {
  const f = fixture(t);
  const offer = await handleX402Turn([{ role: "user", text: requestText }], "en", baseUrl, f.actions);
  const result = await handleX402Turn(confirmation(offer), "en", baseUrl, f.actions);
  assert.equal(result.steps[0].tool, "execute_x402_payment");
  assert.equal(f.settlements(), 1);
});

test("duplicate confirmation cannot make a second payment", async (t) => {
  const f = fixture(t);
  const offer = await handleX402Turn([{ role: "user", text: requestText }], "en", baseUrl, f.actions);
  await handleX402Turn(confirmation(offer), "en", baseUrl, f.actions);
  const second = await handleX402Turn(confirmation(offer), "en", baseUrl, f.actions);
  assert.equal(f.settlements(), 1);
  assert.match(second.answer, /no longer valid/i);
});

test("failed payment is not retried in the same turn", async (t) => {
  const f = fixture(t);
  const offer = await handleX402Turn([{ role: "user", text: requestText }], "en", baseUrl, f.actions);
  let attempts = 0;
  const failingFetch = async (url, init) => {
    if (init?.headers?.["PAYMENT-SIGNATURE"]) {
      attempts++;
      return new Response(JSON.stringify({ error: "settlement unavailable" }), { status: 502 });
    }
    return f.fetchImpl(url, init);
  };
  const actions = { ...f.actions, execute: (id, origin) => executeX402Payment(id, origin, { protocol: f.protocol, fetchImpl: failingFetch }) };
  const result = await handleX402Turn(confirmation(offer), "en", baseUrl, actions);
  assert.equal(attempts, 1);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].error, true);
  assert.equal(getX402Proposal(offer.x402Proposal.id).status, "failed");
  await handleX402Turn(confirmation(offer), "en", baseUrl, actions);
  assert.equal(attempts, 1);
});

test("mock payment retries protected resource exactly once", async (t) => {
  const f = fixture(t);
  const { proposal } = await f.actions.prepare("Luna", baseUrl);
  const result = await performPaidReport(proposal, f.protocol, f.fetchImpl);
  assert.equal(f.requests(), 3);
  assert.equal(result.status, "completed");
});

test("paid response contains the premium report", async (t) => {
  const f = fixture(t);
  const offer = await handleX402Turn([{ role: "user", text: requestText }], "en", baseUrl, f.actions);
  const result = await handleX402Turn(confirmation(offer), "en", baseUrl, f.actions);
  assert.equal(result.premiumReport.pet.name, "Luna");
  assert.match(result.premiumReport.veterinaryNote, /not a veterinary diagnosis/i);
});

test("transaction hash and explorer URL reach the response", async (t) => {
  const f = fixture(t);
  const offer = await handleX402Turn([{ role: "user", text: requestText }], "en", baseUrl, f.actions);
  const result = await handleX402Turn(confirmation(offer), "en", baseUrl, f.actions);
  assert.equal(result.payment.transactionHash, hash);
  assert.equal(result.payment.explorerUrl, "https://sepolia.basescan.org/tx/" + hash);
  assert.equal(getX402Proposal(offer.x402Proposal.id).status, "completed");
});

test("private key is absent from review, report, and payment response", async (t) => {
  const f = fixture(t);
  const offer = await handleX402Turn([{ role: "user", text: requestText }], "en", baseUrl, f.actions);
  const result = await handleX402Turn(confirmation(offer), "en", baseUrl, f.actions);
  assert.equal(JSON.stringify({ offer, result }).includes(key), false);
});

test("Turkish request keeps review and paid report in Turkish", async (t) => {
  const f = fixture(t);
  const offer = await handleX402Turn([{ role: "user", text: "Luna için premium bakım raporu hazırla." }], "tr", baseUrl, f.actions);
  assert.equal(offer.x402Proposal.responseLanguage, "tr");
  const result = await handleX402Turn(confirmation(offer, "Ödemeyi onayla"), "tr", baseUrl, f.actions);
  assert.match(result.answer, /ödemesi tamamlandı/i);
  assert.match(result.premiumReport.veterinaryNote, /veteriner teşhisi/i);
});
