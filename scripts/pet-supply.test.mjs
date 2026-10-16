import assert from "node:assert/strict";
import test from "node:test";
import { applySupplyUpdate, convertSupplyAmount, supplyStatus, upsertSupply } from "../agent/pet-supply.ts";

const now = "2026-10-16T09:00:00.000Z";
const base = { petId: "luna", name: "mama", category: "food", unit: "kg" };

test("4 kg food at 120 g/day lasts about 33 days", () => {
  const result = upsertSupply([], { ...base, quantity: 4, dailyUsage: 120, dailyUsageUnit: "g" }, "s1", now);
  assert.equal(result.supply.dailyUsage, 0.12);
  assert.equal(supplyStatus(result.supply).daysRemaining, 33);
});

test("0.4 kg food falls below a 0.5 kg threshold", () => {
  const result = upsertSupply([], {
    ...base, quantity: 0.4, dailyUsage: 120, dailyUsageUnit: "g", lowStockThreshold: 0.5,
  }, "s1", now);
  assert.equal(supplyStatus(result.supply).lowStock, true);
});

test("missing daily usage does not produce a daysRemaining estimate", () => {
  const result = upsertSupply([], { ...base, quantity: 4 }, "s1", now);
  assert.equal(Object.hasOwn(supplyStatus(result.supply), "daysRemaining"), false);
  assert.equal(supplyStatus(result.supply).lowStock, null);
});

test("saving the same food twice reuses one supply record", () => {
  const first = upsertSupply([], { ...base, quantity: 4 }, "s1", now);
  const second = upsertSupply(first.supplies, { ...base, name: "MAMA", quantity: 4000, unit: "g" }, "s2", now);
  assert.equal(second.supplies.length, 1);
  assert.equal(second.supply.id, "s1");
  assert.equal(second.duplicate, true);
  assert.equal(second.saved, false);
});

test("a changed stock amount updates the existing record", () => {
  const first = upsertSupply([], { ...base, quantity: 4 }, "s1", now);
  const second = upsertSupply(first.supplies, { ...base, quantity: 400, unit: "g" }, "s2", "2026-10-16T10:00:00.000Z");
  assert.equal(second.supplies.length, 1);
  assert.equal(second.supply.quantity, 0.4);
  assert.equal(second.created, false);
  assert.equal(second.saved, true);
  assert.equal(convertSupplyAmount(120, "g", "kg"), 0.12);
});

test("an update converts 400 g to 0.4 kg without clearing daily usage", () => {
  const first = upsertSupply([], { ...base, quantity: 4, dailyUsage: 120, dailyUsageUnit: "g" }, "s1", now);
  const result = applySupplyUpdate(first.supply, {
    quantity: 400, quantityUnit: "g", lowStockThreshold: 0.5,
  }, "2026-10-16T10:00:00.000Z");
  assert.equal(result.saved, true);
  assert.equal(result.supply.quantity, 0.4);
  assert.equal(result.supply.dailyUsage, 0.12);
  assert.equal(supplyStatus(result.supply).lowStock, true);
});
