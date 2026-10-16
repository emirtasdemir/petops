export type SupplyCategory = "food" | "treat" | "litter" | "medicine" | "other";

export type PetSupply = {
  id: string;
  petId: string;
  name: string;
  category: SupplyCategory;
  quantity: number;
  unit: string;
  dailyUsage: number | null;
  lowStockThreshold: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SupplyInput = {
  petId: string;
  name: string;
  category: SupplyCategory;
  quantity: number;
  unit: string;
  dailyUsage?: number;
  dailyUsageUnit?: string;
  lowStockThreshold?: number;
  thresholdUnit?: string;
};

const units: Record<string, { canonical: string; family: string; factor: number }> = {
  kg: { canonical: "kg", family: "mass", factor: 1000 },
  kilogram: { canonical: "kg", family: "mass", factor: 1000 },
  kilograms: { canonical: "kg", family: "mass", factor: 1000 },
  g: { canonical: "g", family: "mass", factor: 1 },
  gram: { canonical: "g", family: "mass", factor: 1 },
  grams: { canonical: "g", family: "mass", factor: 1 },
  l: { canonical: "l", family: "volume", factor: 1000 },
  liter: { canonical: "l", family: "volume", factor: 1000 },
  litre: { canonical: "l", family: "volume", factor: 1000 },
  ml: { canonical: "ml", family: "volume", factor: 1 },
  milliliter: { canonical: "ml", family: "volume", factor: 1 },
  millilitre: { canonical: "ml", family: "volume", factor: 1 },
  piece: { canonical: "piece", family: "count", factor: 1 },
  pieces: { canonical: "piece", family: "count", factor: 1 },
  pcs: { canonical: "piece", family: "count", factor: 1 },
  adet: { canonical: "piece", family: "count", factor: 1 },
};

export function normalizeSupplyUnit(unit: string): string {
  const value = unit.trim().toLocaleLowerCase("tr");
  if (!value) throw new Error("A supply unit is required.");
  return units[value]?.canonical ?? value;
}

export function convertSupplyAmount(amount: number, fromUnit: string, toUnit: string): number {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Supply amounts must be non-negative finite numbers.");
  const from = normalizeSupplyUnit(fromUnit);
  const to = normalizeSupplyUnit(toUnit);
  if (from === to) return amount;
  const source = units[from];
  const target = units[to];
  if (!source || !target || source.family !== target.family) {
    throw new Error(`Cannot convert supply units from ${fromUnit} to ${toUnit}.`);
  }
  return amount * source.factor / target.factor;
}

function supplyKey(name: string): string {
  return name.trim().normalize("NFKC").toLocaleLowerCase("tr").replace(/\s+/g, " ");
}

export function upsertSupply(supplies: PetSupply[], input: SupplyInput, id: string, now: string):
  { supplies: PetSupply[]; supply: PetSupply; saved: boolean; created: boolean; duplicate: boolean } {
  const name = input.name.trim();
  if (!name) throw new Error("A supply name is required.");
  if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new Error("Supply quantity must be non-negative.");
  if (input.dailyUsage !== undefined && (!Number.isFinite(input.dailyUsage) || input.dailyUsage <= 0)) {
    throw new Error("Daily usage must be greater than zero.");
  }
  if (input.lowStockThreshold !== undefined && (!Number.isFinite(input.lowStockThreshold) || input.lowStockThreshold < 0)) {
    throw new Error("Low-stock threshold must be non-negative.");
  }
  const incomingUnit = normalizeSupplyUnit(input.unit);
  const index = supplies.findIndex((item) =>
    item.petId === input.petId && item.category === input.category && supplyKey(item.name) === supplyKey(name)
  );
  const existing = supplies[index];
  const unit = existing?.unit ?? incomingUnit;
  const quantity = convertSupplyAmount(input.quantity, incomingUnit, unit);
  const dailyUsage = input.dailyUsage === undefined
    ? existing?.dailyUsage ?? null
    : convertSupplyAmount(input.dailyUsage, input.dailyUsageUnit ?? incomingUnit, unit);
  const lowStockThreshold = input.lowStockThreshold === undefined
    ? existing?.lowStockThreshold ?? null
    : convertSupplyAmount(input.lowStockThreshold, input.thresholdUnit ?? incomingUnit, unit);
  if (existing && existing.quantity === quantity && existing.dailyUsage === dailyUsage &&
      existing.lowStockThreshold === lowStockThreshold) {
    return { supplies, supply: existing, saved: false, created: false, duplicate: true };
  }
  const supply: PetSupply = {
    id: existing?.id ?? id, petId: input.petId, name: existing?.name ?? name, category: input.category,
    quantity, unit, dailyUsage, lowStockThreshold,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  const next = [...supplies];
  if (existing) next[index] = supply;
  else next.push(supply);
  return { supplies: next, supply, saved: true, created: !existing, duplicate: false };
}

export function applySupplyUpdate(current: PetSupply, changes: {
  quantity?: number;
  quantityUnit?: string;
  dailyUsage?: number | null;
  dailyUsageUnit?: string;
  lowStockThreshold?: number | null;
  thresholdUnit?: string;
}, now: string): { saved: boolean; supply: PetSupply } {
  const quantity = changes.quantity === undefined ? current.quantity
    : convertSupplyAmount(changes.quantity, changes.quantityUnit ?? current.unit, current.unit);
  const dailyUsage = changes.dailyUsage === undefined ? current.dailyUsage
    : changes.dailyUsage === null ? null
      : convertSupplyAmount(changes.dailyUsage, changes.dailyUsageUnit ?? current.unit, current.unit);
  const lowStockThreshold = changes.lowStockThreshold === undefined ? current.lowStockThreshold
    : changes.lowStockThreshold === null ? null
      : convertSupplyAmount(changes.lowStockThreshold, changes.thresholdUnit ?? current.unit, current.unit);
  if (changes.dailyUsage !== undefined && dailyUsage !== null && dailyUsage <= 0) {
    throw new Error("Daily usage must be greater than zero.");
  }
  if (quantity === current.quantity && dailyUsage === current.dailyUsage && lowStockThreshold === current.lowStockThreshold) {
    return { saved: false, supply: current };
  }
  return { saved: true, supply: { ...current, quantity, dailyUsage, lowStockThreshold, updatedAt: now } };
}

export function supplyStatus(supply: PetSupply):
  { supply: PetSupply; lowStock: boolean | null; daysRemaining?: number } {
  const lowStock = supply.quantity === 0 ? true : supply.lowStockThreshold === null
    ? null : supply.quantity < supply.lowStockThreshold;
  if (supply.dailyUsage === null || supply.dailyUsage <= 0) return { supply, lowStock };
  return { supply, lowStock, daysRemaining: Math.round(supply.quantity / supply.dailyUsage) };
}
