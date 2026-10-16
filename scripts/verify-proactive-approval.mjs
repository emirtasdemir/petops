import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildActionSuggestions } from "../agent/action-suggestions.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testDir = mkdtempSync(join(tmpdir(), "petops-proactive-eval-"));
const dataFile = join(testDir, "petops-proactive-check.json");
const generatedGuides = ["AGENTS.md", "CLAUDE.md"];
const preexistingGuides = new Set(generatedGuides.filter((name) => existsSync(join(root, name))));
const pet = { id: "luna-proactive-test", name: "Luna", species: "cat", breed: null, age: 3, weightKg: 4.8, foodName: null, notes: null };
const stamp = new Date().toISOString();
const food = { id: "food-proactive-test", petId: pet.id, name: "food", category: "food", quantity: 0.4, unit: "kg",
  dailyUsage: 0.12, lowStockThreshold: 0.5, createdAt: stamp, updatedAt: stamp };
const observation = { id: "appetite-proactive-test", petId: pet.id, type: "appetite", description: "Luna ate less than usual today.",
  severity: "low", observedAt: stamp, createdAt: stamp };
let server;
let passed = 0;

function fixture({ supplies = [], observations = [] } = {}) {
  return { profiles: [pet], tasks: [], observations, carePlans: [], carePlanProposals: [], supplies };
}

function reset(data) {
  writeFileSync(dataFile, JSON.stringify(data), { mode: 0o600 });
}

function saved() {
  return JSON.parse(readFileSync(dataFile, "utf8"));
}

function suggestion(data, focus) {
  return buildActionSuggestions({ pet, observations: data.observations, tasks: data.tasks, plans: data.carePlans,
    supplies: data.supplies, language: "en", timeZone: "Europe/Istanbul", now: new Date(), focus });
}

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function ready(url) {
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error("The local server exited before becoming ready.");
    let response;
    try { response = await fetch(`${url}/api/agent`, { signal: AbortSignal.timeout(3000) }); }
    catch { /* Wait for server startup. */ }
    if (response?.ok) {
      assert.equal((await response.json()).hasApiKey, true, "GROQ_API_KEY is missing from .env.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The local server did not become ready.");
}

async function reply(url, text, suggestions) {
  const response = await fetch(`${url}/api/agent`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [
      { role: "user", text: "How is Luna doing?" },
      { role: "agent", text: suggestions.map((item) => item.description).join("\n"), suggestions },
      { role: "user", text },
    ], timeZone: "Europe/Istanbul" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error ?? `HTTP ${response.status}`);
  return body;
}

async function check(name, run) {
  await run();
  passed++;
  console.log(`${name}: PASS`);
}

try {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const next = join(root, "node_modules", "next", "dist", "bin", "next");
  assert.ok(existsSync(next), "Install dependencies first.");
  server = spawn(process.execPath, [next, "dev", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root, env: { ...process.env, PETOPS_DATA_FILE: dataFile, GROQ_API_KEY: "test-only-no-model-calls" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.on("error", () => {});
  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});
  await ready(url);

  await check("No confirmation creates no task", async () => {
    const data = fixture({ supplies: [food] });
    reset(data);
    const result = await reply(url, "no", suggestion(data, { supply: true }));
    assert.equal(result.steps.length, 0);
    assert.equal(saved().tasks.length, 0);
  });

  await check("Yes confirms low-stock restock task", async () => {
    const data = fixture({ supplies: [food] });
    reset(data);
    const result = await reply(url, "Yes, do it.", suggestion(data, { supply: true }));
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].tool, "create_care_task");
    assert.equal(result.steps[0].result.saved, true);
    assert.equal(result.steps[0].args.petId, pet.id);
    assert.equal(Object.hasOwn(result.steps[0].args, "petName"), false);
    assert.equal(result.steps[0].args.title, "Buy more food for Luna");
    assert.equal(result.steps[0].args.description, "Restock the low supply.");
    assert.match(result.steps[0].args.dueAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hourCycle: "h23" })
      .format(new Date(result.steps[0].args.dueAt)), "09");
    assert.doesNotMatch(result.answer, /step limit/i);
    assert.equal(saved().tasks.length, 1);
    console.log(`create_care_task arguments: ${JSON.stringify(result.steps[0].args)}`);
  });

  await check("Replaying the same suggestion does not create a second pending task", async () => {
    const data = fixture({ supplies: [food] });
    reset(data);
    const offered = suggestion(data, { supply: true });
    const first = await reply(url, "Yes, do it.", offered);
    assert.equal(first.steps.length, 1);
    const second = await reply(url, "Yes, do it.", offered);
    assert.equal(second.steps.length, 0);
    assert.equal(saved().tasks.length, 1);
  });

  await check("Controlled task validation failure stops after one call", async () => {
    const longFood = { ...food, name: "food".repeat(501) };
    const data = fixture({ supplies: [longFood] });
    reset(data);
    const result = await reply(url, "Yes, do it.", suggestion(data, { supply: true }));
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].tool, "create_care_task");
    assert.equal(result.steps[0].error, true);
    assert.match(result.steps[0].result.error, /title is too long/i);
    assert.match(result.answer, /task title is too long/i);
    assert.doesNotMatch(result.answer, /step limit/i);
    assert.equal(saved().tasks.length, 0);
    console.log(`Controlled tool error: ${result.steps[0].result.error}`);
  });

  await check("Confirmation ignores client-supplied tool arguments", async () => {
    const data = fixture({ supplies: [food] });
    reset(data);
    const offered = suggestion(data, { supply: true });
    offered[0].suggestedArgs.title = "Unrelated client-supplied action";
    const result = await reply(url, "yes", offered);
    assert.equal(result.steps[0].tool, "create_care_task");
    assert.notEqual(saved().tasks[0].title, "Unrelated client-supplied action");
  });

  await check("Do it confirms appetite follow-up task", async () => {
    const data = fixture({ observations: [observation] });
    reset(data);
    const result = await reply(url, "do it", suggestion(data, { observation }));
    assert.equal(result.steps[0].tool, "create_care_task");
    assert.equal(result.steps[0].result.saved, true);
    assert.equal(saved().tasks.length, 1);
  });

  await check("Yes prepares a care plan but does not activate it", async () => {
    const data = fixture();
    reset(data);
    const result = await reply(url, "yes", suggestion(data, { profile: true }));
    assert.equal(result.steps[0].tool, "create_care_plan");
    assert.equal(result.steps[0].result.approvalRequired, true);
    assert.equal(saved().carePlans.length, 0);
    assert.equal(saved().carePlanProposals.length, 1);
  });
} catch (error) {
  console.error(`Proactive approval verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
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
  for (const name of generatedGuides) {
    const path = join(root, name);
    if (preexistingGuides.has(name) || !existsSync(path)) continue;
    const contents = readFileSync(path, "utf8");
    const generated = name === "AGENTS.md"
      ? contents.startsWith("<!-- BEGIN:nextjs-agent-rules -->") && contents.trimEnd().endsWith("<!-- END:nextjs-agent-rules -->")
      : contents.trim() === "@AGENTS.md";
    if (generated) unlinkSync(path);
  }
  console.log(`Proactive approval checks: ${passed}/7 passed`);
  if (passed !== 7) process.exitCode = 1;
}
