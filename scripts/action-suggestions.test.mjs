import assert from "node:assert/strict";
import test from "node:test";
import { buildActionSuggestions } from "../agent/action-suggestions.ts";

const now = new Date("2026-10-16T12:00:00.000Z");
const pet = { id: "luna-test", name: "Luna", species: "cat", breed: null, age: 3, weightKg: 4.8, foodName: null, notes: null };
const observation = {
  id: "appetite-1", petId: pet.id, type: "appetite", description: "Luna ate less than usual today.",
  severity: "low", observedAt: now.toISOString(), createdAt: now.toISOString(),
};
const food = {
  id: "food-1", petId: pet.id, name: "food", category: "food", quantity: 0.4, unit: "kg",
  dailyUsage: 0.12, lowStockThreshold: 0.5, createdAt: now.toISOString(), updatedAt: now.toISOString(),
};

function suggestions(override = {}) {
  return buildActionSuggestions({
    pet, observations: [], tasks: [], plans: [], supplies: [], language: "en",
    timeZone: "Europe/Istanbul", now, focus: {}, ...override,
  });
}

test("low food stock offers a restock task without creating one", () => {
  const items = suggestions({ supplies: [food], focus: { supply: true } });
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "restock_task");
  assert.equal(items[0].suggestedTool, "create_care_task");
  assert.equal(items[0].requiresConfirmation, true);
  assert.match(items[0].description, /running low.*Would you like/i);
  assert.equal(items[0].suggestedArgs.petId, pet.id);
  assert.equal(items[0].suggestedArgs.dueAt, "2026-10-17T06:00:00.000Z");
});

test("appetite observation offers a next-day follow-up task", () => {
  const items = suggestions({ observations: [observation], focus: { observation } });
  assert.equal(items[0].type, "follow_up_task");
  assert.equal(items[0].suggestedTool, "create_care_task");
  assert.match(items[0].description, /appetite again tomorrow/i);
});

test("normal appetite does not trigger a reduced-appetite follow-up", () => {
  const normal = { ...observation, description: "Luna ate normally today." };
  assert.equal(suggestions({ observations: [normal], focus: { observation: normal } }).length, 0);
});

test("existing pending appetite task prevents another follow-up offer", () => {
  const task = { id: "appetite-task", petId: pet.id, title: "Check Luna's appetite again", description: "", dueAt: now.toISOString(), status: "pending" };
  const items = suggestions({ observations: [observation], tasks: [task], focus: { observation } });
  assert.equal(items[0].suggestedTool, null);
  assert.match(items[0].description, /already exists/i);
});

test("repeated observation adds monitoring and veterinary advice without diagnosis", () => {
  const older = { ...observation, id: "appetite-0", observedAt: "2026-10-15T12:00:00.000Z" };
  const items = suggestions({ observations: [observation, older], focus: { observation, repeated: true } });
  assert.ok(items.some((item) => item.type === "veterinary_follow_up" && item.suggestedTool === null));
  assert.match(items.find((item) => item.type === "veterinary_follow_up").description, /not a diagnosis/i);
});

test("missing active care plan offers a draft, never an active save", () => {
  const items = suggestions({ focus: { profile: true } });
  assert.equal(items[0].type, "care_plan");
  assert.equal(items[0].suggestedTool, "create_care_plan");
  assert.equal(items[0].suggestedArgs.mode, "propose");
  assert.match(items[0].description, /will not be saved without separate approval/i);
  const active = { id: "plan-1", petId: pet.id, title: "Daily care", description: "Food and water", frequency: "daily",
    nextDueAt: now.toISOString(), active: true, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  assert.equal(suggestions({ plans: [active], focus: { profile: true } }).length, 0);
  const contextual = suggestions({ observations: [observation], focus: { profile: true } });
  assert.match(contextual[0].suggestedArgs.description, /cat, age 3.*appetite observation/i);
});

test("existing pending restock task prevents another restock offer", () => {
  const task = { id: "restock-task", petId: pet.id, title: "Buy more food for Luna", description: "", dueAt: now.toISOString(), status: "pending" };
  const items = suggestions({ supplies: [food], tasks: [task], focus: { supply: true } });
  assert.equal(items[0].suggestedTool, null);
  assert.match(items[0].description, /already exists/i);
});

test("missing daily usage requests data without inventing a day estimate", () => {
  const items = suggestions({ supplies: [{ ...food, dailyUsage: null }], focus: { supply: true } });
  const missing = items.find((item) => item.type === "provide_missing_data");
  assert.ok(missing);
  assert.equal(missing.suggestedTool, null);
  assert.match(missing.description, /approximate daily usage/i);
  assert.doesNotMatch(missing.description, /\b\d+ days\b/i);
});

test("overdue care is flagged without assuming completion", () => {
  const task = { id: "task-1", petId: pet.id, title: "Weight check", description: "", dueAt: "2026-10-15T06:00:00.000Z", status: "pending" };
  const items = suggestions({ tasks: [task], focus: { tasks: true } });
  assert.equal(items[0].type, "task_follow_up");
  assert.match(items[0].description, /overdue.*won't assume it was completed/i);
  assert.equal(items[0].suggestedTool, null);
});

test("observation and low supply are reported separately without causal claims", () => {
  const items = suggestions({ observations: [observation], supplies: [food], focus: { observation } });
  assert.ok(items.some((item) => item.type === "follow_up_task"));
  const stock = items.find((item) => item.type === "restock_task");
  assert.ok(stock);
  assert.equal(stock.suggestedTool, null);
  assert.match(stock.description, /does not establish a cause/i);
});

test("Turkish request yields Turkish suggestions", () => {
  const items = suggestions({ supplies: [food], language: "tr", focus: { supply: true } });
  assert.match(items[0].description, /stoğu düşük.*ister misiniz/i);
});
