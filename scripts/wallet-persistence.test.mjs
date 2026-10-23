import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const walletModule = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../agent/wallet.ts")).href;
// Deterministic test keys only. Neither is a user wallet or a funded account.
const envTestKey = `0x${"1".repeat(64)}`;
const localTestKey = `0x${"2".repeat(64)}`;

function fixture(t) {
  const directory = mkdtempSync(path.join(process.cwd(), ".wallet-test-"));
  const walletFile = path.join(directory, ".agent-wallet.json");
  t.after(() => {
    if (path.dirname(directory) !== process.cwd() || !path.basename(directory).startsWith(".wallet-test-")) {
      throw new Error("Wallet test cleanup escaped the project directory.");
    }
    rmSync(walletFile, { force: true });
    rmdirSync(directory);
  });
  return { directory, walletFile };
}

function restart(directory, envKey, action = "read") {
  const script = `import fs from "node:fs";
    import { verifyMessage } from "viem";
    import { privateKeyToAccount } from "viem/accounts";
    import { createWallet, getBaseSepoliaTransferContext, getWalletAddress, getWalletBalance, getWalletSource } from ${JSON.stringify(walletModule)};
    let requestedAddress = null;
    if (${JSON.stringify(action)} === "balance") {
      globalThis.fetch = async (_url, options) => {
        const request = JSON.parse(options.body);
        requestedAddress = request.params[0];
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0xde0b6b3a7640000" }),
          { status: 200, headers: { "content-type": "application/json" } });
      };
    }
    const address = ${JSON.stringify(action)} === "create-and-sign" ? createWallet(() => ${JSON.stringify(localTestKey)})
      : ${JSON.stringify(action)} === "create" ? createWallet() : getWalletAddress();
    const balance = ${JSON.stringify(action)} === "balance" ? await getWalletBalance() : undefined;
    let savedKeyValid, savedAddressValid, derivedAddressMatches, signatureValid;
    if (${JSON.stringify(action)} === "create-and-sign") {
      const record = JSON.parse(fs.readFileSync(".agent-wallet.json", "utf8"));
      savedKeyValid = /^0x[0-9a-fA-F]{64}$/.test(record.privateKey);
      savedAddressValid = /^0x[0-9a-fA-F]{40}$/.test(record.address);
      derivedAddressMatches = privateKeyToAccount(record.privateKey).address === address && record.address === address;
      const signature = await getBaseSepoliaTransferContext().account.signMessage({ message: "PetOps isolated wallet test" });
      signatureValid = await verifyMessage({ address, message: "PetOps isolated wallet test", signature });
    }
    console.log(JSON.stringify({ address, source: getWalletSource(), balance, requestedAddress,
      savedKeyValid, savedAddressValid, derivedAddressMatches, signatureValid }));`;
  const env = { ...process.env };
  if (envKey === null) delete env.WALLET_PRIVATE_KEY;
  else env.WALLET_PRIVATE_KEY = envKey;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: directory, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(output);
}

test("deployment wallet address remains identical across fresh processes and without a local file", (t) => {
  const { directory, walletFile } = fixture(t);
  writeFileSync(walletFile, JSON.stringify({ privateKey: localTestKey }));
  const first = restart(directory, envTestKey, "create");
  const second = restart(directory, envTestKey);
  rmSync(walletFile);
  const third = restart(directory, envTestKey);
  assert.match(first.address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(first.source, "environment");
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.equal(existsSync(walletFile), false);
});

test("Base Sepolia balance lookup uses the env wallet public address", (t) => {
  const { directory } = fixture(t);
  const result = restart(directory, envTestKey, "balance");
  assert.equal(result.balance, "1 ETH");
  assert.equal(result.requestedAddress.toLowerCase(), result.address.toLowerCase());
});

test("environment wallet creation never writes a local wallet file", (t) => {
  const { directory, walletFile } = fixture(t);
  const created = restart(directory, envTestKey, "create");
  assert.equal(created.source, "environment");
  assert.equal(existsSync(walletFile), false);
});

test("an invalid env key does not silently switch to the local wallet", (t) => {
  const { directory, walletFile } = fixture(t);
  writeFileSync(walletFile, JSON.stringify({ privateKey: localTestKey }));
  assert.throws(() => restart(directory, "0x123"));
  assert.equal(existsSync(walletFile), true);
});

test("local Create Wallet reuses the saved address without an env key", (t) => {
  const { directory, walletFile } = fixture(t);
  writeFileSync(walletFile, JSON.stringify({ privateKey: localTestKey }));
  const created = restart(directory, null, "create");
  assert.equal(created.source, "local");
  assert.equal(existsSync(walletFile), true);
  assert.deepEqual(restart(directory, null), created);
});

test("new local Create Wallet stores distinct address and key fields and signs", (t) => {
  const { directory, walletFile } = fixture(t);
  const created = restart(directory, null, "create-and-sign");
  assert.equal(created.source, "local");
  assert.equal(existsSync(walletFile), true);
  assert.equal(created.savedKeyValid, true);
  assert.equal(created.savedAddressValid, true);
  assert.equal(created.derivedAddressMatches, true);
  assert.equal(created.signatureValid, true);
  assert.equal(restart(directory, null).address, created.address);
});

test("a local address that disagrees with its private key is rejected", (t) => {
  const { directory, walletFile } = fixture(t);
  writeFileSync(walletFile, JSON.stringify({ address: `0x${"3".repeat(40)}`, privateKey: localTestKey }));
  assert.throws(() => restart(directory, null));
});
