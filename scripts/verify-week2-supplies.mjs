import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const dataFile = process.env.PETOPS_DATA_FILE;
const baseUrl = process.env.PETOPS_TEST_URL ?? "http://localhost:3116";
if (!dataFile || !basename(dataFile).startsWith("petops-week2-check-") || existsSync(dataFile)) {
  throw new Error("Use a fresh PETOPS_DATA_FILE named petops-week2-check-*.json for this test.");
}

const petId = "luna-week2-check";
const registryResponse = await fetch(`${baseUrl}/api/agent`);
assert.equal(registryResponse.status, 200);
const registeredTools = new Set((await registryResponse.json()).tools.map((tool) => tool.name));
for (const name of ["save_pet_supply", "get_pet_supplies", "update_pet_supply", "check_pet_supply_status"]) {
  assert.ok(registeredTools.has(name), `${name} is missing from the agent tool registry.`);
}
writeFileSync(dataFile, JSON.stringify({
  profiles: [{ id: petId, name: "Luna", species: "cat", breed: null, age: 3, weightKg: 4.8, foodName: null, notes: null }],
  tasks: [], observations: [], carePlans: [], carePlanProposals: [],
}, null, 2), { mode: 0o600 });

async function ask(message) {
  const response = await fetch(`${baseUrl}/api/agent`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", text: message }], timeZone: "Europe/Istanbul" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Agent request failed: ${body.error ?? response.status}`);
  return body;
}

const english = await ask("Luna has 4 kg of mama left and eats about 120 g per day. Save this supply.");
const save = english.steps?.find((step) => step.tool === "save_pet_supply" && !step.error);
assert.ok(save, `English supply message did not call save_pet_supply: ${english.answer}`);
assert.equal(save.result.status.daysRemaining, 33);
assert.equal(save.result.supply.petId, petId);
assert.equal(readFileSync(dataFile, "utf8").includes('"supplies"'), true);
assert.equal(JSON.parse(readFileSync(dataFile, "utf8")).tasks.length, 0);
console.log("English save_pet_supply: 4 kg / 120 g/day = about 33 days; no automatic task.");

const turkish = await ask("Luna'nın mamasından 0.4 kg kaldı. Düşük stok eşiği 0.5 kg. Kaydı güncelle ve stok durumunu kontrol et.");
const changed = turkish.steps?.find((step) =>
  (step.tool === "save_pet_supply" || step.tool === "update_pet_supply") && !step.error
);
assert.ok(changed, `Turkish stock message did not update a supply: ${turkish.answer}`);
assert.equal(changed.result.status.lowStock, true);
const dataAfterLow = JSON.parse(readFileSync(dataFile, "utf8"));
assert.equal(dataAfterLow.supplies.length, 1);
assert.equal(dataAfterLow.supplies[0].quantity, 0.4);
assert.equal(dataAfterLow.supplies[0].lowStockThreshold, 0.5);
assert.equal(dataAfterLow.supplies[0].dailyUsage, 0.12);
assert.equal(dataAfterLow.tasks.length, 0);
console.log("Turkish supply update: low stock detected; no automatic task.");

const restock = await ask("Create a care task to restock Luna's mama tomorrow.");
const task = restock.steps?.find((step) => step.tool === "create_care_task" && !step.error);
assert.ok(task, `Explicit restock request did not call create_care_task: ${restock.answer}`);
assert.equal(JSON.parse(readFileSync(dataFile, "utf8")).tasks.length, 1);
console.log("Explicit restock request: create_care_task called and one task saved.");
