import type { Tool } from "./tools";
import { findPetProfile, getPetSupply, listPetSupplies, savePetSupply, updatePetSupply } from "./pet-store";
import { supplyStatus, type SupplyCategory } from "./pet-supply";

const categories: SupplyCategory[] = ["food", "treat", "litter", "medicine", "other"];

function objectArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object.");
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  if (value.length > 2000) throw new Error(`${field} is too long.`);
  return value.trim();
}

function numberField(value: unknown, field: string, minimum: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${field} must be a number of at least ${minimum}.`);
  }
  return value;
}

function resolvePet(args: Record<string, unknown>) {
  const petId = optionalString(args.petId, "petId");
  const petName = petId ? undefined : optionalString(args.petName, "petName");
  if (!petId && !petName) throw new Error("petId or petName is required for pet supplies.");
  return findPetProfile(petId, petName);
}

function category(value: unknown): SupplyCategory {
  if (!categories.includes(value as SupplyCategory)) throw new Error("Invalid supply category.");
  return value as SupplyCategory;
}

const petIdentifier = {
  petId: { type: ["string", "null"], description: "Saved pet ID. If known, use it and omit petName." },
  petName: { type: ["string", "null"], description: "Saved pet name, e.g. Luna. Omit when petId is known." },
};

export const supplyTools: Tool[] = [
  {
    name: "save_pet_supply",
    description: "Save an explicitly reported current supply amount for a saved pet. Use food for mama/pet food. If the same pet already has the same name and category, update that record instead of adding a duplicate. For 'Luna için 4 kg mama kaldı. Günde yaklaşık 120 gram tüketiyor', use name 'mama', category food, quantity 4, unit kg, dailyUsage 120, dailyUsageUnit g. dailyUsage is consumption per day, not the total amount; preserve its stated unit using dailyUsageUnit when different from unit. Omit unknown dailyUsage, threshold, and other optional fields instead of sending null. Never invent stock amounts or purchases.",
    parameters: {
      type: "object",
      properties: {
        ...petIdentifier,
        name: { type: "string", description: "Supply or product name, e.g. mama or a named food brand." },
        category: { type: "string", enum: categories },
        quantity: { type: "number", description: "Current amount in unit; zero is allowed." },
        unit: { type: "string", description: "Unit of quantity, e.g. kg, g, ml, l, or piece." },
        dailyUsage: { type: ["number", "null"], description: "Positive amount consumed per day. Omit if unknown." },
        dailyUsageUnit: { type: ["string", "null"], description: "Unit for dailyUsage, e.g. g for 120 g/day. Omit only when identical to unit or dailyUsage is absent." },
        lowStockThreshold: { type: ["number", "null"], description: "Optional low-stock threshold, in thresholdUnit or unit. Omit if unknown." },
        thresholdUnit: { type: ["string", "null"], description: "Unit for lowStockThreshold if different from unit." },
      },
      required: ["name", "category", "quantity", "unit"],
      additionalProperties: false,
    },
    run: async (rawArgs: unknown) => {
      const args = objectArgs(rawArgs);
      const pet = resolvePet(args);
      const name = optionalString(args.name, "name");
      const unit = optionalString(args.unit, "unit");
      const quantity = numberField(args.quantity, "quantity", 0);
      if (!name || !unit || quantity === undefined) throw new Error("name, quantity, and unit are required.");
      const result = savePetSupply({
        petId: pet.id, name, category: category(args.category), quantity, unit,
        dailyUsage: numberField(args.dailyUsage, "dailyUsage", Number.EPSILON),
        dailyUsageUnit: optionalString(args.dailyUsageUnit, "dailyUsageUnit"),
        lowStockThreshold: numberField(args.lowStockThreshold, "lowStockThreshold", 0),
        thresholdUnit: optionalString(args.thresholdUnit, "thresholdUnit"),
      });
      return { ...result, status: supplyStatus(result.supply) };
    },
  },
  {
    name: "get_pet_supplies",
    description: "List saved supply records for a pet, including known remaining days and low-stock status. Use when the user asks what food, litter, treats, medicine, or other supplies remain. Do not claim a purchase was made.",
    parameters: { type: "object", properties: petIdentifier, additionalProperties: false },
    run: async (rawArgs: unknown) => {
      const pet = resolvePet(objectArgs(rawArgs));
      return { petId: pet.id, supplies: listPetSupplies(pet.id).map(supplyStatus) };
    },
  },
  {
    name: "update_pet_supply",
    description: "Update an existing supply's quantity, daily usage, or low-stock threshold only when the user reports a change. First get the supply ID with get_pet_supplies. Provide the unit of a changed amount if it differs from the saved supply unit. Omit unchanged fields instead of sending null. Do not create a care task or purchase anything.",
    parameters: {
      type: "object",
      properties: {
        supplyId: { type: "string", description: "ID of the saved supply to update." },
        quantity: { type: "number", description: "New current amount; omit if unchanged." },
        quantityUnit: { type: ["string", "null"], description: "Unit for quantity if different from the saved unit." },
        dailyUsage: { type: "number", description: "New positive daily consumption; omit if unchanged." },
        dailyUsageUnit: { type: ["string", "null"], description: "Unit for dailyUsage if different from the saved unit." },
        lowStockThreshold: { type: "number", description: "New threshold; omit if unchanged." },
        thresholdUnit: { type: ["string", "null"], description: "Unit for lowStockThreshold if different from the saved unit." },
      },
      required: ["supplyId"],
      additionalProperties: false,
    },
    run: async (rawArgs: unknown) => {
      const args = objectArgs(rawArgs);
      const supplyId = optionalString(args.supplyId, "supplyId");
      if (!supplyId) throw new Error("supplyId is required.");
      const changes = {
        quantity: numberField(args.quantity, "quantity", 0),
        quantityUnit: optionalString(args.quantityUnit, "quantityUnit"),
        dailyUsage: numberField(args.dailyUsage, "dailyUsage", Number.EPSILON),
        dailyUsageUnit: optionalString(args.dailyUsageUnit, "dailyUsageUnit"),
        lowStockThreshold: numberField(args.lowStockThreshold, "lowStockThreshold", 0),
        thresholdUnit: optionalString(args.thresholdUnit, "thresholdUnit"),
      };
      if (changes.quantity === undefined && changes.dailyUsage === undefined && changes.lowStockThreshold === undefined) {
        throw new Error("Provide quantity, dailyUsage, or lowStockThreshold to update.");
      }
      const result = updatePetSupply(supplyId, changes);
      return { ...result, status: supplyStatus(result.supply) };
    },
  },
  {
    name: "check_pet_supply_status",
    description: "Check a saved pet's supply status. Returns approximate daysRemaining only when positive dailyUsage is known; never invent a consumption estimate. lowStock is true when quantity is below its threshold or empty, false when known to be above it, and null when no threshold exists. Suggest restocking when lowStock is true, but do not claim an order or purchase. Do not create a care task unless the user explicitly asks for one.",
    parameters: {
      type: "object",
      properties: {
        ...petIdentifier,
        supplyId: { type: ["string", "null"], description: "Optional saved supply ID to check only one item." },
        name: { type: ["string", "null"], description: "Optional supply name to filter, e.g. mama." },
        category: { type: ["string", "null"], enum: [...categories, null], description: "Optional category filter." },
      },
      additionalProperties: false,
    },
    run: async (rawArgs: unknown) => {
      const args = objectArgs(rawArgs);
      const supplyId = optionalString(args.supplyId, "supplyId");
      const pet = supplyId && !args.petId && !args.petName
        ? findPetProfile(getPetSupply(supplyId).petId) : resolvePet(args);
      const name = optionalString(args.name, "name")?.toLocaleLowerCase("tr");
      const categoryFilter = args.category == null ? undefined : category(args.category);
      const supplies = listPetSupplies(pet.id).filter((item) =>
        (!supplyId || item.id === supplyId) && (!name || item.name.toLocaleLowerCase("tr") === name) &&
        (!categoryFilter || item.category === categoryFilter)
      );
      if (supplyId && !supplies.length) throw new Error("Pet supply not found for this pet.");
      return { petId: pet.id, supplies: supplies.map(supplyStatus) };
    },
  },
];
