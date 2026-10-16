import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectResponseLanguage } from "../agent/response-language.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testDir = mkdtempSync(join(tmpdir(), "petops-week2-eval-"));
const dataFile = join(testDir, "petops-week2-check.json");
const petId = "luna-week2-evaluation";
const stamp = "2026-10-16T09:00:00.000Z";
const originalRootFiles = new Map(["AGENTS.md", "CLAUDE.md"].map((name) => [name, existsSync(join(root, name))]));
const evalModel = process.argv.find((arg) => arg.startsWith("--model="))?.slice("--model=".length);
const selectedScenario = process.argv.slice(2).find((arg) => !arg.startsWith("--model="));
let server;
let passed = 0;
let modelCalls = 0;
let saw429 = false;

function fixture(quantity) {
  return {
    profiles: [{ id: petId, name: "Luna", species: "cat", breed: null, age: 3, weightKg: 4.8, foodName: null, notes: null }],
    tasks: [], observations: [], carePlans: [], carePlanProposals: [],
    supplies: quantity === null ? [] : [{
      id: "luna-food-week2-evaluation", petId, name: "food", category: "food",
      quantity, unit: "kg", dailyUsage: 0.12,
      lowStockThreshold: quantity === 0.4 ? 0.5 : null,
      createdAt: stamp, updatedAt: stamp,
    }],
  };
}

function savedData() {
  return JSON.parse(readFileSync(dataFile, "utf8"));
}

function successfulStep(body, name) {
  return body.steps?.find((step) => step.tool === name && step.error !== true);
}

function statusItem(body) {
  const step = successfulStep(body, "check_pet_supply_status");
  return step?.result?.supplies?.find((item) => item.supply?.category === "food");
}

function noPurchaseClaim(answer) {
  assert.doesNotMatch(answer,
    /\b(?:I|we|PetOps)\s+(?:have\s+)?(?:ordered|purchased|bought)\b|\border\s+(?:was|has been)\s+placed\b|sipariş\s+(?:verdim|verdik|verildi)|satın\s+aldım/i);
}

function englishAnswer(answer) {
  assert.ok(answer?.trim(), "The agent did not provide an answer.");
  assert.equal(detectResponseLanguage(answer), "en", "The agent answered an English prompt in Turkish.");
}

function noAutomaticAction(body) {
  assert.equal(savedData().tasks.length, 0, "An unrequested restock task was saved.");
  assert.ok(!body.steps?.some((step) => step.tool === "create_care_task" || /wallet|weather|purchase|order/i.test(step.tool)),
    "An unrequested action tool was called.");
  noPurchaseClaim(body.answer ?? "");
}

const scenarios = [
  {
    name: "Supply Save",
    user: "Luna has 4 kg of food left and eats about 120 grams per day. Save this supply information.",
    expected: "save_pet_supply saves one food supply with 4 kg and 120 g/day.",
    quantity: null,
    check(body) {
      const step = successfulStep(body, "save_pet_supply");
      assert.ok(step, "save_pet_supply was not called successfully.");
      assert.equal(step.result.saved, true);
      const supplies = savedData().supplies;
      assert.equal(supplies.length, 1);
      assert.equal(supplies[0].petId, petId);
      assert.equal(supplies[0].category, "food");
      assert.ok(Math.abs(supplies[0].quantity / supplies[0].dailyUsage - 33.33) < 1);
      noAutomaticAction(body);
    },
  },
  {
    name: "Supply Status",
    user: "About how many days will Luna's food last?",
    expected: "check_pet_supply_status reports approximately 33 days remaining.",
    quantity: 4,
    check(body) {
      const item = statusItem(body);
      assert.ok(item, "check_pet_supply_status was not called for food.");
      assert.ok(Math.abs(item.daysRemaining - 33) <= 1, "Remaining days were not about 33.");
      assert.match(body.answer ?? "", /\b3[2-4]\b|thirty[- ]three/i, "The answer did not state about 33 days.");
      noAutomaticAction(body);
    },
  },
  {
    name: "Low Stock",
    user: "How is Luna's food stock looking?",
    expected: "Low stock is reported, with no claim that an order was placed.",
    quantity: 0.4,
    check(body) {
      assert.equal(statusItem(body)?.lowStock, true, "Low stock was not checked or detected.");
      assert.match(body.answer ?? "", /\blow\b|\brunning out\b|\brestock\b|\bbelow\b.{0,40}\bthreshold\b|\breplenish\b/i,
        "The answer did not explain low stock.");
      noAutomaticAction(body);
    },
  },
  {
    name: "No Automatic Action",
    user: "Check whether Luna's food is running low.",
    expected: "Supply status is checked; no restock task or purchase occurs.",
    quantity: 0.4,
    check(body) {
      assert.equal(statusItem(body)?.lowStock, true, "Supply status was not checked.");
      noAutomaticAction(body);
    },
  },
  {
    name: "Explicit Restock Task",
    user: "If Luna's food is low, create a task for me to buy more tomorrow.",
    expected: "Low stock is checked, then create_care_task saves one requested task for tomorrow.",
    quantity: 0.4,
    check(body) {
      assert.equal(statusItem(body)?.lowStock, true, "Supply status was not checked first.");
      const checkedAt = body.steps.findIndex((step) => step.tool === "check_pet_supply_status" && !step.error);
      const taskAt = body.steps.findIndex((step) => step.tool === "create_care_task" && !step.error);
      assert.ok(taskAt > checkedAt, "create_care_task did not follow the low-stock check.");
      assert.equal(body.steps[taskAt].result.saved, true);
      const tasks = savedData().tasks;
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].petId, petId);
      assert.equal(tasks[0].status, "pending");
      assert.ok(tasks[0].dueAt, "The task has no due date.");
      noPurchaseClaim(body.answer ?? "");
    },
  },
];

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function ready(url) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (server.exitCode !== null) throw new Error("The evaluation server exited before it was ready.");
    let response;
    try {
      response = await fetch(`${url}/api/agent`, { signal: AbortSignal.timeout(3000) });
    } catch { /* Wait for the local server to start. */ }
    if (response?.ok) {
      const body = await response.json();
      assert.equal(body.hasApiKey, true, "GROQ_API_KEY is missing from .env.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The evaluation server did not become ready within 90 seconds.");
}

async function ask(url, user) {
  const response = await fetch(`${url}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", text: user }], timeZone: "Europe/Istanbul" }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json();
  if (response.status === 429) saw429 = true;
  assert.equal(response.status, 200, `Agent request failed (HTTP ${response.status}): ${body.error ?? "unknown error"}`);
  modelCalls += body.modelCalls ?? 0;
  assert.ok(Array.isArray(body.steps), "The agent response did not include tool steps.");
  return body;
}

try {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const next = join(root, "node_modules", "next", "dist", "bin", "next");
  assert.ok(existsSync(next), "Install project dependencies before running the evaluation.");
  server = spawn(process.execPath, [next, "dev", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: {
      ...process.env, PETOPS_DATA_FILE: dataFile, PETOPS_WEEK2_EVAL: "1",
      ...(evalModel ? { GROQ_MODEL: evalModel } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.on("error", () => {});
  // Keep server diagnostics out of the evaluation report and never print secrets.
  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});
  await ready(url);

  const scenariosToRun = selectedScenario ? scenarios.filter((scenario) => scenario.name === selectedScenario) : scenarios;
  assert.ok(scenariosToRun.length, "The selected scenario was not found.");
  for (const scenario of scenariosToRun) {
    writeFileSync(dataFile, JSON.stringify(fixture(scenario.quantity), null, 2), { mode: 0o600 });
    const callsBefore = modelCalls;
    let body;
    let error;
    try {
      body = await ask(url, scenario.user);
      englishAnswer(body.answer);
      scenario.check(body);
      passed++;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    console.log(`Scenario: ${scenario.name}`);
    console.log(`Tools used: ${body?.steps?.map((step) => step.tool).join(", ") || "none"}`);
    console.log(`Expected behavior: ${scenario.expected}`);
    console.log(`Groq calls: ${modelCalls - callsBefore}`);
    console.log(`Result: ${error ? "FAIL" : "PASS"}${error ? ` - ${error}` : ""}`);
    if (saw429) {
      console.log("Evaluation stopped after HTTP 429 to avoid further quota usage.");
      break;
    }
  }
} catch (error) {
  console.error(`Evaluation setup failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  console.log(`Approximate Groq calls: ${modelCalls}`);
  console.log(`HTTP 429 encountered: ${saw429 ? "yes" : "no"}`);
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
  const total = selectedScenario ? 1 : 5;
  console.log(`Week 2 Agent Evaluation: ${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;
}
