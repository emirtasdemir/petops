import type { Tool } from "./tools";
import {
  confirmCarePlanProposal, createCareTask, findPetProfile, getCarePlan, listCarePlans, listCareTasks,
  listPetObservations, listPetProfiles, proposeCarePlan, recordPetObservation, savePetProfile, updateCarePlan,
  type CarePlanFrequency, type ObservationSeverity, type ObservationType,
} from "./pet-store";

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

function nullableString(value: unknown, field: string): string | null | undefined {
  return value === null ? null : optionalString(value, field);
}

function nullableNumber(value: unknown, field: string, minimum: number): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${field} must be a number of at least ${minimum}.`);
  }
  return value;
}

function dueDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = optionalString(value, "dueAt")!;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error("dueAt must be an ISO 8601 date and time with a timezone offset, such as 2026-10-07T09:00:00+03:00.");
  }
  return new Date(text).toISOString();
}

function observationDate(value: unknown): string {
  if (value === undefined || value === null) return new Date().toISOString();
  const text = optionalString(value, "observedAt")!;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error("observedAt must be an ISO 8601 date and time with a timezone offset.");
  }
  return new Date(text).toISOString();
}

const observationTypes: ObservationType[] = ["appetite", "behavior", "stool", "vomiting", "activity", "weight", "other"];
const observationSeverities: ObservationSeverity[] = ["low", "medium", "high"];
const carePlanFrequencies: CarePlanFrequency[] = ["daily", "weekly", "monthly", "custom"];
const frequencyLabels: Record<CarePlanFrequency, string> = {
  daily: "Günlük", weekly: "Haftalık", monthly: "Aylık", custom: "Özel",
};

function localDate(iso: string | null, timeZone?: string): string | null {
  if (!iso) return null;
  let zone = timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("tr-TR", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const formatted = new Intl.DateTimeFormat("tr-TR", {
    timeZone: zone, day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(iso));
  return `${formatted} (${zone})`;
}

function nextLocalMorning(timeZone?: string): string {
  let zone = timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => Number(dateParts.find((part) => part.type === type)?.value);
  const localNineAsUtc = Date.UTC(value("year"), value("month") - 1, value("day") + 1, 9);
  let candidate = localNineAsUtc;
  for (let i = 0; i < 2; i++) {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(candidate)).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
    const offset = match ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
    candidate = localNineAsUtc - offset * 60_000;
  }
  return new Date(candidate).toISOString();
}

export const petTools: Tool[] = [
  {
    name: "get_pet_profile",
    description: "Read a saved pet profile by petId or name. If petId is known, omit name. If neither is given, list all pet profiles. Omit unused optional fields instead of sending null. Use when asked what is known about a pet, or before creating a task for a named pet.",
    parameters: {
      type: "object",
      properties: {
        petId: { type: ["string", "null"], description: "Saved pet ID, if known; otherwise omit." },
        name: { type: ["string", "null"], description: "Pet name, e.g. Luna; omit if petId is known." },
      },
      additionalProperties: false,
    },
    run: async (rawArgs: unknown) => {
      const args = objectArgs(rawArgs);
      const petId = optionalString(args.petId, "petId");
      const name = optionalString(args.name, "name");
      return petId || name ? { profile: findPetProfile(petId, name) } : { profiles: listPetProfiles() };
    },
  },
  {
    name: "save_pet_profile",
    description: "Create or update a pet profile from facts the user provided. Use for statements like 'my cat is Luna, age 3'. Supply name and species for a new pet. Omit unknown optional fields; omitted fields remain unchanged on updates. Send null for a detail only when intentionally clearing it. A successful result has saved: true.",
    parameters: {
      type: "object",
      properties: {
        petId: { type: ["string", "null"], description: "Existing pet ID when updating a specific profile; otherwise omit." },
        name: { type: ["string", "null"], description: "Pet's name; required for a new profile." },
        species: { type: ["string", "null"], description: "Pet species, such as cat or dog; required for a new profile." },
        breed: { type: ["string", "null"], description: "Breed, if the user supplied it." },
        age: { type: ["number", "null"], description: "Age in years, if supplied." },
        weightKg: { type: ["number", "null"], description: "Weight in kilograms, if supplied." },
        foodName: { type: ["string", "null"], description: "Food name, if supplied." },
        notes: { type: ["string", "null"], description: "Other user-provided care notes." },
      },
      additionalProperties: false,
    },
    run: async (rawArgs: unknown) => {
      const args = objectArgs(rawArgs);
      return savePetProfile({
        petId: optionalString(args.petId, "petId"),
        name: optionalString(args.name, "name"),
        species: optionalString(args.species, "species"),
        breed: nullableString(args.breed, "breed"),
        age: nullableNumber(args.age, "age", 0),
        weightKg: nullableNumber(args.weightKg, "weightKg", 0.001),
        foodName: nullableString(args.foodName, "foodName"),
        notes: nullableString(args.notes, "notes"),
      });
    },
  },
  {
    name: "create_care_task",
    description: "Save a new pending care task for a pet, such as checking Luna's food tomorrow. Provide either petId or petName; one is enough. If petId is known, use it and omit petName entirely. Omit unused optional fields instead of sending null. Use an ISO 8601 dueAt with timezone when the user gave a due date; omit it when no date was given. If a similar pending task already exists at nearly the same time, returns that task with duplicate: true and saved: false instead of creating another.",
    parameters: {
      type: "object",
      properties: {
        petId: { type: ["string", "null"], description: "Saved pet ID. Prefer this when known, and omit petName." },
        petName: { type: ["string", "null"], description: "Pet name, e.g. Luna. Use only when petId is not known; otherwise omit." },
        title: { type: "string", description: "Short action title." },
        description: { type: ["string", "null"], description: "Optional details of the care task; omit if unused." },
        dueAt: { type: ["string", "null"], description: "ISO 8601 date and time with timezone offset, e.g. 2026-10-07T09:00:00+03:00." },
      },
      required: ["title"],
      additionalProperties: false,
    },
    run: async (rawArgs: unknown, ctx) => {
      const args = objectArgs(rawArgs);
      const petId = optionalString(args.petId, "petId");
      const petName = petId ? undefined : optionalString(args.petName, "petName");
      if (!petId && !petName) throw new Error("petId or petName is required.");
      const pet = petId ? findPetProfile(petId) : findPetProfile(undefined, petName);
      const title = optionalString(args.title, "title");
      if (!title) throw new Error("title is required.");
      const result = createCareTask({
        petId: pet.id,
        title,
        description: optionalString(args.description, "description") ?? "",
        dueAt: dueDate(args.dueAt),
      });
      return { ...result, task: { ...result.task, dueAtLocal: localDate(result.task.dueAt, ctx.timeZone) } };
    },
  },
  {
    name: "get_care_tasks",
    description: "List saved care tasks. By default return pending tasks; use status 'all' to include completed tasks. Optionally filter by petId or petName. If petId is known, omit petName. Omit unused optional fields instead of sending null. Use when asked what care tasks are pending.",
    parameters: {
      type: "object",
      properties: {
        petId: { type: ["string", "null"], description: "Saved pet ID, if known; otherwise omit." },
        petName: { type: ["string", "null"], description: "Pet name to filter by; omit if petId is known." },
        status: { type: ["string", "null"], enum: ["pending", "completed", "all", null], description: "Defaults to pending; omit if unused." },
      },
      additionalProperties: false,
    },
    run: async (rawArgs: unknown, ctx) => {
      const args = objectArgs(rawArgs);
      const petId = optionalString(args.petId, "petId");
      const petName = petId ? undefined : optionalString(args.petName, "petName");
      const status = args.status == null ? "pending" : args.status;
      if (status !== "pending" && status !== "completed" && status !== "all") {
        throw new Error("status must be pending, completed, or all.");
      }
      const resolvedPetId = petId || petName ? findPetProfile(petId, petName).id : undefined;
      const names = new Map(listPetProfiles().map((pet) => [pet.id, pet.name]));
      return { tasks: listCareTasks({ petId: resolvedPetId, status }).map((task) => ({
        ...task, petName: names.get(task.petId), dueAtLocal: localDate(task.dueAt, ctx.timeZone),
      })) };
    },
  },
  {
    name: "record_pet_observation",
    description: "Record a real, temporary pet observation reported by the user, such as Luna eating less than usual today or vomiting. Do not invent symptoms or a diagnosis, and do not use save_pet_profile for this. Identify the saved pet by petId or petName; if petId is known, omit petName. A saved pet does not need its species or age repeated in the user's message. Omit observedAt for an observation happening now. Returns saved: true only for a new record; duplicate: true means the same observation was already recorded recently. repeated: true means a similar older observation exists.",
    parameters: {
      type: "object",
      properties: {
        petId: { type: ["string", "null"], description: "Saved pet ID, if known; otherwise omit." },
        petName: { type: ["string", "null"], description: "Saved pet name; omit if petId is known." },
        type: { type: "string", enum: observationTypes, description: "Observation category." },
        description: { type: "string", description: "What the user actually observed, in their words. Do not add a diagnosis." },
        severity: { type: "string", enum: observationSeverities, description: "low for mild change, medium for notable concern, high for explicitly serious concern." },
        observedAt: { type: ["string", "null"], description: "ISO 8601 date and time with timezone offset. Omit if the observation is happening now." },
      },
      required: ["type", "description", "severity"],
      additionalProperties: false,
    },
    run: async (rawArgs: unknown) => {
      const args = objectArgs(rawArgs);
      const petId = optionalString(args.petId, "petId");
      const petName = petId ? undefined : optionalString(args.petName, "petName");
      if (!petId && !petName) throw new Error("petId or petName is required.");
      if (!observationTypes.includes(args.type as ObservationType)) throw new Error("Invalid observation type.");
      if (!observationSeverities.includes(args.severity as ObservationSeverity)) throw new Error("Invalid observation severity.");
      const description = optionalString(args.description, "description");
      if (!description) throw new Error("description is required.");
      const pet = petId ? findPetProfile(petId) : findPetProfile(undefined, petName);
      return recordPetObservation({
        petId: pet.id,
        type: args.type as ObservationType,
        description,
        severity: args.severity as ObservationSeverity,
        observedAt: observationDate(args.observedAt),
      });
    },
  },
  {
    name: "get_pet_observations",
    description: "Get the most recent saved observations for one pet, sorted from newest observedAt to oldest. Identify the saved pet by petId or petName; if petId is known, omit petName. Use when asked about a pet's observation history or whether a symptom has repeated.",
    parameters: {
      type: "object",
      properties: {
        petId: { type: ["string", "null"], description: "Saved pet ID, if known; otherwise omit." },
        petName: { type: ["string", "null"], description: "Saved pet name; omit if petId is known." },
        limit: { type: ["number", "null"], description: "Number of recent observations to return, from 1 to 50. Defaults to 10." },
      },
      additionalProperties: false,
    },
    run: async (rawArgs: unknown) => {
      const args = objectArgs(rawArgs);
      const petId = optionalString(args.petId, "petId");
      const petName = petId ? undefined : optionalString(args.petName, "petName");
      if (!petId && !petName) throw new Error("petId or petName is required.");
      const limit = args.limit == null ? 10 : args.limit;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new Error("limit must be an integer from 1 to 50.");
      }
      const pet = petId ? findPetProfile(petId) : findPetProfile(undefined, petName);
      return { petId: pet.id, observations: listPetObservations(pet.id, limit) };
    },
  },
  {
    name: "create_care_plan",
    description: "Two-step long-term care plan tool. Use the saved pet profile and recent observations in context, and check existing plans before proposing. First call mode 'propose' with a saved pet, title, description, and frequency to show a plan for user review; this does not save an active CarePlan. Give nextDueAt only if the user specifies a starting date or time. Otherwise the tool uses tomorrow at 09:00 in the user's timezone. After the user explicitly approves with the exact ONAYLA command shown in the proposal, call mode 'confirm' with proposalId. Never claim a plan was saved when approvalRequired is true. Do not create veterinary treatment plans or medical prescriptions. A similar active plan returns duplicate: true.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["propose", "confirm"], description: "propose before user approval; confirm only after explicit ONAYLA command." },
        proposalId: { type: ["string", "null"], description: "Proposal ID, required only for confirm." },
        petId: { type: ["string", "null"], description: "Saved pet ID for propose, if known; otherwise use petName." },
        petName: { type: ["string", "null"], description: "Saved pet name for propose; omit when petId is known." },
        title: { type: ["string", "null"], description: "Plan title, required for propose." },
        description: { type: ["string", "null"], description: "Practical non-medical plan description, required for propose." },
        frequency: { type: ["string", "null"], enum: ["daily", "weekly", "monthly", "custom", null], description: "Schedule frequency, required for propose." },
        nextDueAt: { type: ["string", "null"], description: "Next due time as ISO 8601 with timezone offset, only when the user provided a starting date or time; otherwise omit." },
      },
      required: ["mode"],
      additionalProperties: false,
    },
    run: async (rawArgs: unknown, ctx) => {
      const args = objectArgs(rawArgs);
      if (args.mode === "confirm") {
        const proposalId = optionalString(args.proposalId, "proposalId");
        if (!proposalId) throw new Error("proposalId is required to confirm a care plan.");
        return confirmCarePlanProposal(proposalId, ctx.userMessage ?? "");
      }
      if (args.mode !== "propose") throw new Error("mode must be propose or confirm.");
      const petId = optionalString(args.petId, "petId");
      const petName = petId ? undefined : optionalString(args.petName, "petName");
      if (!petId && !petName) throw new Error("petId or petName is required.");
      const pet = petId ? findPetProfile(petId) : findPetProfile(undefined, petName);
      const title = optionalString(args.title, "title");
      const description = optionalString(args.description, "description");
      if (!title || !description) throw new Error("title and description are required for a care plan proposal.");
      if (!carePlanFrequencies.includes(args.frequency as CarePlanFrequency)) throw new Error("Invalid care plan frequency.");
      const explicitDate = /(bugün|yarın|öbür gün|saat|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2})/iu
        .test(ctx.userMessage ?? "");
      const nextDueAt = explicitDate ? dueDate(args.nextDueAt) : nextLocalMorning(ctx.timeZone);
      if (!nextDueAt) throw new Error("Belirtilen başlangıç tarihini anlayamadım. Tarih ve saati yeniden yazar mısınız?");
      const result = proposeCarePlan({ petId: pet.id, title, description, frequency: args.frequency as CarePlanFrequency, nextDueAt });
      return "proposal" in result
        ? { ...result, proposal: { ...result.proposal, frequencyLabel: frequencyLabels[result.proposal.frequency], nextDueAtLocal: localDate(result.proposal.nextDueAt, ctx.timeZone) } }
        : { ...result, plan: { ...result.plan, frequencyLabel: frequencyLabels[result.plan.frequency], nextDueAtLocal: localDate(result.plan.nextDueAt, ctx.timeZone) } };
    },
  },
  {
    name: "get_care_plan",
    description: "Read a saved care plan by planId, or list active plans for a saved pet by petId or petName. Set includeInactive true to include deactivated plans. Pending proposals are not saved plans.",
    parameters: {
      type: "object",
      properties: {
        planId: { type: ["string", "null"], description: "Saved plan ID, if known." },
        petId: { type: ["string", "null"], description: "Saved pet ID, if planId is not known." },
        petName: { type: ["string", "null"], description: "Saved pet name, if neither planId nor petId is known." },
        includeInactive: { type: ["boolean", "null"], description: "Defaults to false." },
      },
      additionalProperties: false,
    },
    run: async (rawArgs: unknown, ctx) => {
      const args = objectArgs(rawArgs);
      const planId = optionalString(args.planId, "planId");
      if (planId) {
        const plan = getCarePlan(planId);
        return { plan: { ...plan, frequencyLabel: frequencyLabels[plan.frequency], nextDueAtLocal: localDate(plan.nextDueAt, ctx.timeZone) } };
      }
      const petId = optionalString(args.petId, "petId");
      const petName = petId ? undefined : optionalString(args.petName, "petName");
      if (!petId && !petName) throw new Error("planId, petId, or petName is required.");
      if (args.includeInactive != null && typeof args.includeInactive !== "boolean") throw new Error("includeInactive must be a boolean.");
      const pet = petId ? findPetProfile(petId) : findPetProfile(undefined, petName);
      return { petId: pet.id, plans: listCarePlans(pet.id, args.includeInactive === true).map((plan) => ({
        ...plan, frequencyLabel: frequencyLabels[plan.frequency], nextDueAtLocal: localDate(plan.nextDueAt, ctx.timeZone),
      })) };
    },
  },
  {
    name: "update_care_plan",
    description: "Update or deactivate an existing saved care plan only when the user explicitly requests that change. Provide planId and the fields to change. If frequency changes, update the title and description too when they mention the old frequency. Never turn a health observation into a medical treatment plan. A similar active plan will be rejected.",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string", description: "ID of an existing saved care plan." },
        title: { type: ["string", "null"], description: "New title; omit when unchanged." },
        description: { type: ["string", "null"], description: "New description; omit when unchanged." },
        frequency: { type: ["string", "null"], enum: ["daily", "weekly", "monthly", "custom", null], description: "New frequency; omit when unchanged." },
        nextDueAt: { type: ["string", "null"], description: "New next due time as ISO 8601 with timezone offset; omit when unchanged." },
        active: { type: ["boolean", "null"], description: "False to deactivate, true to reactivate; omit when unchanged." },
      },
      required: ["planId"],
      additionalProperties: false,
    },
    run: async (rawArgs: unknown, ctx) => {
      const args = objectArgs(rawArgs);
      const request = ctx.userMessage ?? "";
      if (!/(güncelle|degistir|değiştir|durdur|pasifleştir|etkinleştir|update|change|deactivate|activate)/i.test(request) &&
          !(request.toLocaleLowerCase("tr").includes("plan") && /\b(yap|olsun)\b/i.test(request))) {
        throw new Error("Changing a saved care plan requires an explicit user request.");
      }
      const planId = optionalString(args.planId, "planId");
      if (!planId) throw new Error("planId is required.");
      const changes: Parameters<typeof updateCarePlan>[1] = {};
      const title = optionalString(args.title, "title");
      const description = optionalString(args.description, "description");
      if (title) changes.title = title;
      if (description) changes.description = description;
      if (args.frequency != null) {
        if (!carePlanFrequencies.includes(args.frequency as CarePlanFrequency)) throw new Error("Invalid care plan frequency.");
        changes.frequency = args.frequency as CarePlanFrequency;
      }
      if (args.nextDueAt != null) changes.nextDueAt = dueDate(args.nextDueAt)!;
      if (args.active != null) {
        if (typeof args.active !== "boolean") throw new Error("active must be a boolean.");
        changes.active = args.active;
      }
      if (!Object.keys(changes).length) throw new Error("Provide at least one care plan field to update.");
      return updateCarePlan(planId, changes);
    },
  },
];
