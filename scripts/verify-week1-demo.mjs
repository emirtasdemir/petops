import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const dataFile = process.env.PETOPS_DATA_FILE;
const baseUrl = process.env.PETOPS_DEMO_URL || "http://localhost:3113";
if (!dataFile || dataFile.endsWith(".petops-data.json")) {
  throw new Error("Set PETOPS_DATA_FILE to a separate, empty demo verification file before running this script.");
}
if (existsSync(dataFile)) {
  const existing = JSON.parse(readFileSync(dataFile, "utf8"));
  if (["profiles", "tasks", "observations", "carePlans", "carePlanProposals"].some((key) => existing[key]?.length)) {
    throw new Error("The verification file already contains records. Use a new empty file path; this script never deletes data.");
  }
}

const history = [];
async function ask(label, prompt) {
  history.push({ role: "user", text: prompt });
  const response = await fetch(`${baseUrl}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history, timeZone: "Europe/Istanbul" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${label}: ${body.error || response.status}`);
  assert.ok(body.answer, `${label}: empty answer`);
  history.push({ role: "agent", text: body.answer });
  console.log(`${label}: ${body.steps.map((step) => step.tool).join(", ")}\n${body.answer}\n`);
  return body;
}

function step(body, name) {
  const match = body.steps.find((item) => item.tool === name && !item.error);
  assert.ok(match, `Expected successful ${name} call.`);
  return match;
}

function data() {
  return JSON.parse(readFileSync(dataFile, "utf8"));
}

const profile = await ask("1 Profil", "Luna adında 3 yaşında, 4.8 kg ağırlığında bir kedim var. Profilini kaydet.");
assert.equal(step(profile, "save_pet_profile").result.saved, true);
assert.equal(data().profiles[0].name, "Luna");
assert.equal(data().profiles[0].age, 3);
assert.equal(data().profiles[0].weightKg, 4.8);

const observation = await ask("2 Gözlem", "Luna bugün normalden daha az mama yedi.");
assert.equal(step(observation, "record_pet_observation").result.saved, true);
assert.equal(data().observations[0].type, "appetite");

const observations = await ask("3 Gözlemleri getir", "Luna'nın son gözlemleri neler?");
assert.ok(step(observations, "get_pet_observations").result.observations.length > 0);

const task = await ask("4 Kontrol görevi", "Bu durumu yarın tekrar kontrol et.");
assert.equal(step(task, "create_care_task").result.saved, true);
assert.equal(data().tasks[0].status, "pending");
assert.ok(data().tasks[0].dueAt);

const proposalResponse = await ask("5 Plan önerisi", "Luna için günlük mama, haftalık kilo kontrolü ve aylık genel bakım planı hazırla. Önce öneriyi göster, onay vermeden kaydetme.");
const proposal = step(proposalResponse, "create_care_plan").result;
assert.equal(proposal.approvalRequired, true);
assert.equal(proposal.proposal.frequency, "custom");
assert.match(proposal.proposal.nextDueAtLocal, /09:00/);
assert.equal(data().carePlans.length, 0);
assert.match(proposal.proposal.description.toLocaleLowerCase("tr"), /günlük/);
assert.match(proposal.proposal.description.toLocaleLowerCase("tr"), /haftalık/);
assert.match(proposal.proposal.description.toLocaleLowerCase("tr"), /aylık/);

const confirmation = await ask("6 Plan onayı", proposal.approvalCommand);
assert.equal(step(confirmation, "create_care_plan").result.saved, true);
assert.equal(data().carePlans.length, 1);

const summary = await ask("7 Birleşik özet", "Luna için kayıtlı plan ve bekleyen görevleri göster.");
assert.ok(step(summary, "get_care_plan").result.plans.length > 0);
assert.ok(step(summary, "get_care_tasks").result.tasks.length > 0);
assert.match(step(summary, "get_care_plan").result.plans[0].nextDueAtLocal, /09:00/);
assert.match(step(summary, "get_care_tasks").result.tasks[0].dueAtLocal, /09:00/);
console.log("Week 1 demo checks passed.");
