import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectResponseLanguage } from "../agent/response-language.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const smoke = process.argv.includes("--smoke");
const evalModel = process.argv.find((arg) => arg.startsWith("--model="))?.slice("--model=".length);
if (evalModel && !["openai/gpt-oss-20b", "openai/gpt-oss-120b"].includes(evalModel)) {
  throw new Error("Use a project-tested Groq model ID for --model.");
}
const testDir = mkdtempSync(join(tmpdir(), "petops-language-eval-"));
const dataFile = join(testDir, "petops-language-check.json");
const petId = "luna-language-evaluation";
const stamp = "2026-10-16T09:00:00.000Z";
const originalRootFiles = new Map(["AGENTS.md", "CLAUDE.md"].map((name) => [name, existsSync(join(root, name))]));
const englishRepetitions = smoke ? 1 : 10;
let server;
let groqCalls = 0;
let saw429 = false;
let englishPassed = 0;
let turkishPassed = 0;

function fixture(kind) {
  return {
    profiles: kind === "profile" ? [] : [{
      id: petId, name: "Luna", species: "cat", breed: null, age: 3, weightKg: 4.8, foodName: null, notes: null,
    }],
    tasks: [], observations: [], carePlans: [], carePlanProposals: [],
    supplies: kind === "status" ? [{
      id: "luna-language-food", petId, name: "food", category: "food", quantity: 4, unit: "kg",
      dailyUsage: 0.12, lowStockThreshold: null, createdAt: stamp, updatedAt: stamp,
    }] : [],
  };
}

const cases = [
  { language: "en", kind: "profile", prompt: "I have a 3-year-old cat named Luna who weighs 4.8 kg. Save her profile." },
  { language: "en", kind: "supply", prompt: "Luna has 4 kg of food left and eats about 120 grams per day. Save this supply information." },
  { language: "en", kind: "status", prompt: "About how many days will Luna's food last?" },
  { language: "tr", kind: "profile", prompt: "Luna adında 3 yaşında, 4.8 kg ağırlığında bir kedim var. Profilini kaydet." },
  { language: "tr", kind: "supply", prompt: "Luna için 4 kg mama kaldı. Günde yaklaşık 120 gram tüketiyor." },
  { language: "tr", kind: "status", prompt: "Luna'nın maması yaklaşık kaç gün yeter?" },
];

function validate(body, item) {
  const actualLanguage = detectResponseLanguage(body.answer ?? "");
  assert.equal(actualLanguage, item.language, `Expected ${item.language} user-facing answer, got ${actualLanguage}.`);
  assert.ok(body.answer?.trim(), "Agent answer was empty.");
  const steps = body.steps ?? [];
  const name = item.kind === "profile" ? "save_pet_profile"
    : item.kind === "supply" ? "save_pet_supply" : "check_pet_supply_status";
  const step = steps.find((entry) => entry.tool === name && !entry.error);
  assert.ok(step, `Expected successful ${name} call.`);
  if (item.kind === "profile") {
    const profile = step.result.profile;
    assert.equal(step.result.saved, true);
    assert.equal(profile.name, "Luna");
    assert.equal(profile.species, "cat");
    assert.equal(profile.age, 3);
    assert.equal(profile.weightKg, 4.8);
  } else if (item.kind === "supply") {
    assert.equal(step.result.saved, true);
    const supply = step.result.supply;
    assert.equal(supply.category, "food");
    assert.equal(supply.petId, petId);
    assert.ok(Math.abs(supply.quantity / supply.dailyUsage - 33.33) < 1);
  } else {
    const food = step.result.supplies.find((entry) => entry.supply.category === "food");
    assert.ok(food, "Saved food supply was not returned.");
    assert.ok(Math.abs(food.daysRemaining - 33) <= 1);
    assert.match(body.answer, /\b3[2-4]\b|thirty[- ]three|otuz\s+üç/i, "The answer did not report about 33 days.");
  }
}

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (server.exitCode !== null) throw new Error("Evaluation server exited before becoming ready.");
    let response;
    try {
      response = await fetch(`${url}/api/agent`, { signal: AbortSignal.timeout(3000) });
    } catch { /* Server is still starting. */ }
    if (response?.ok) {
      const body = await response.json();
      assert.equal(body.hasApiKey, true, "GROQ_API_KEY is missing from .env.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Evaluation server did not become ready within 90 seconds.");
}

async function ask(url, prompt) {
  const response = await fetch(`${url}/api/agent`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", text: prompt }], timeZone: "Europe/Istanbul" }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json();
  if (response.status === 429) saw429 = true;
  assert.equal(response.status, 200, `Agent request failed with HTTP ${response.status}: ${body.error ?? "unknown error"}`);
  groqCalls += body.modelCalls ?? 0;
  return body;
}

try {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const next = join(root, "node_modules", "next", "dist", "bin", "next");
  assert.ok(existsSync(next), "Install project dependencies before running this test.");
  server = spawn(process.execPath, [next, "dev", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root, env: {
      ...process.env, PETOPS_DATA_FILE: dataFile, PETOPS_LANGUAGE_EVAL: "1",
      ...(evalModel ? { GROQ_MODEL: evalModel } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.on("error", () => {});
  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});
  await waitForServer(url);
  console.log(`Model: ${evalModel ?? "GROQ_MODEL from .env"}`);

  for (const item of cases) {
    const repetitions = item.language === "en" ? englishRepetitions : 1;
    let passed = 0;
    for (let attempt = 1; attempt <= repetitions; attempt++) {
      writeFileSync(dataFile, JSON.stringify(fixture(item.kind)), { mode: 0o600 });
      try {
        const body = await ask(url, item.prompt);
        validate(body, item);
        passed++;
        if (item.language === "en") englishPassed++;
        else turkishPassed++;
      } catch (error) {
        console.log(`${item.language.toUpperCase()} ${item.kind} attempt ${attempt}: FAIL - ${error instanceof Error ? error.message : String(error)}`);
      }
      if (saw429) break;
    }
    console.log(`${item.language.toUpperCase()} ${item.kind}: ${passed}/${repetitions} passed`);
    if (saw429) {
      console.log("Stopped after HTTP 429 to avoid further quota usage.");
      break;
    }
  }
} catch (error) {
  console.error(`Language evaluation setup failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (server && server.exitCode === null) {
    if (process.platform === "win32") {
      await new Promise((resolve) => {
        const killer = spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
        killer.once("error", resolve);
        killer.once("exit", resolve);
      });
    } else server.kill("SIGTERM");
  }
  if (existsSync(dataFile)) unlinkSync(dataFile);
  rmdirSync(testDir);
  for (const [name, existed] of originalRootFiles) {
    if (!existed && existsSync(join(root, name))) unlinkSync(join(root, name));
  }
  console.log(`English user-facing answers: ${englishPassed}/${3 * englishRepetitions}`);
  console.log(`Turkish user-facing answers: ${turkishPassed}/3`);
  console.log(`Approximate Groq calls: ${groqCalls}`);
  console.log(`HTTP 429 encountered: ${saw429 ? "yes" : "no"}`);
  if (englishPassed !== 3 * englishRepetitions || turkishPassed !== 3) process.exitCode = 1;
}
