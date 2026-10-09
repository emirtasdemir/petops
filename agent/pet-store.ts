import "server-only";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { areDuplicateCareTasks } from "./care-task-duplicates";
import { areDuplicateObservations, similarObservationDescriptions } from "./observation-duplicates";
import { areSimilarCarePlans } from "./care-plan-duplicates";

export type PetProfile = {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  age: number | null;
  weightKg: number | null;
  foodName: string | null;
  notes: string | null;
};

export type CareTask = {
  id: string;
  petId: string;
  title: string;
  description: string;
  dueAt: string | null;
  status: "pending" | "completed";
};

export type ObservationType = "appetite" | "behavior" | "stool" | "vomiting" | "activity" | "weight" | "other";
export type ObservationSeverity = "low" | "medium" | "high";

export type PetObservation = {
  id: string;
  petId: string;
  type: ObservationType;
  description: string;
  severity: ObservationSeverity;
  observedAt: string;
  createdAt: string;
};

export type CarePlanFrequency = "daily" | "weekly" | "monthly" | "custom";

export type CarePlan = {
  id: string;
  petId: string;
  title: string;
  description: string;
  frequency: CarePlanFrequency;
  nextDueAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CarePlanProposal = Pick<CarePlan, "petId" | "title" | "description" | "frequency" | "nextDueAt"> & {
  id: string;
  createdAt: string;
};

type PetData = {
  profiles: PetProfile[];
  tasks: CareTask[];
  observations: PetObservation[];
  carePlans: CarePlan[];
  carePlanProposals: CarePlanProposal[];
};

const DATA_FILE = process.env.PETOPS_DATA_FILE || join(process.cwd(), ".petops-data.json");

function readData(): PetData {
  if (!existsSync(/* turbopackIgnore: true */ DATA_FILE)) {
    return { profiles: [], tasks: [], observations: [], carePlans: [], carePlanProposals: [] };
  }
  const data: unknown = JSON.parse(readFileSync(/* turbopackIgnore: true */ DATA_FILE, "utf8"));
  if (!data || typeof data !== "object" || !("profiles" in data) || !("tasks" in data) ||
      !Array.isArray(data.profiles) || !Array.isArray(data.tasks)) {
    throw new Error("PetOps demo data is invalid. Check .petops-data.json.");
  }
  if ("observations" in data && !Array.isArray(data.observations)) {
    throw new Error("PetOps observations data is invalid. Check .petops-data.json.");
  }
  if (("carePlans" in data && !Array.isArray(data.carePlans)) ||
      ("carePlanProposals" in data && !Array.isArray(data.carePlanProposals))) {
    throw new Error("PetOps care plan data is invalid. Check .petops-data.json.");
  }
  return {
    profiles: data.profiles as PetProfile[],
    tasks: data.tasks as CareTask[],
    observations: "observations" in data ? data.observations as PetObservation[] : [],
    carePlans: "carePlans" in data ? data.carePlans as CarePlan[] : [],
    carePlanProposals: "carePlanProposals" in data ? data.carePlanProposals as CarePlanProposal[] : [],
  };
}

function writeData(data: PetData): void {
  const temporaryFile = `${DATA_FILE}.${randomUUID()}.tmp`;
  writeFileSync(temporaryFile, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryFile, DATA_FILE);
}

export function listPetProfiles(): PetProfile[] {
  return readData().profiles;
}

export function findPetProfile(petId?: string, name?: string): PetProfile {
  const profiles = listPetProfiles();
  const matches = petId
    ? profiles.filter((pet) => pet.id === petId)
    : profiles.filter((pet) => pet.name.toLocaleLowerCase() === name?.toLocaleLowerCase());
  if (matches.length === 0) throw new Error(`Pet profile not found${name ? `: ${name}` : ""}.`);
  if (matches.length > 1) throw new Error(`Multiple pets match ${name}. Use a pet ID.`);
  return matches[0];
}

export function savePetProfile(fields: Omit<Partial<PetProfile>, "id"> & { petId?: string }): { saved: true; created: boolean; profile: PetProfile } {
  const data = readData();
  const existing = fields.petId
    ? data.profiles.find((pet) => pet.id === fields.petId)
    : data.profiles.find((pet) => pet.name.toLocaleLowerCase() === fields.name?.toLocaleLowerCase());
  if (fields.petId && !existing) throw new Error("Pet profile not found for the supplied petId.");
  if (!existing && (!fields.name || !fields.species)) {
    throw new Error("A new pet profile needs both name and species.");
  }
  if (fields.name && data.profiles.some((pet) => pet.id !== existing?.id && pet.name.toLocaleLowerCase() === fields.name?.toLocaleLowerCase())) {
    throw new Error(`A pet named ${fields.name} already exists. Use its petId to update it.`);
  }

  const profile: PetProfile = {
    id: existing?.id ?? randomUUID(),
    name: fields.name ?? existing?.name ?? "",
    species: fields.species ?? existing?.species ?? "",
    breed: fields.breed !== undefined ? fields.breed : existing?.breed ?? null,
    age: fields.age !== undefined ? fields.age : existing?.age ?? null,
    weightKg: fields.weightKg !== undefined ? fields.weightKg : existing?.weightKg ?? null,
    foodName: fields.foodName !== undefined ? fields.foodName : existing?.foodName ?? null,
    notes: fields.notes !== undefined ? fields.notes : existing?.notes ?? null,
  };
  if (existing) data.profiles[data.profiles.findIndex((pet) => pet.id === existing.id)] = profile;
  else data.profiles.push(profile);
  writeData(data);
  return { saved: true, created: !existing, profile };
}

export function createCareTask(fields: { petId: string; title: string; description: string; dueAt: string | null }):
  { saved: true; duplicate: false; task: CareTask } | { saved: false; duplicate: true; task: CareTask } {
  const data = readData();
  const pet = data.profiles.find((profile) => profile.id === fields.petId);
  if (!pet) throw new Error("Pet profile not found for this task.");
  const task: CareTask = { id: randomUUID(), ...fields, status: "pending" };
  const duplicate = data.tasks.find((existing) => areDuplicateCareTasks(existing, task, pet.name));
  if (duplicate) return { saved: false, duplicate: true, task: duplicate };
  data.tasks.push(task);
  writeData(data);
  return { saved: true, duplicate: false, task };
}

export function listCareTasks(filter: { petId?: string; status: "pending" | "completed" | "all" }): CareTask[] {
  return readData().tasks.filter((task) =>
    (!filter.petId || task.petId === filter.petId) && (filter.status === "all" || task.status === filter.status)
  );
}

export function recordPetObservation(fields: { petId: string; type: ObservationType; description: string; severity: ObservationSeverity; observedAt: string }):
  { saved: true; duplicate: false; repeated: boolean; observation: PetObservation } |
  { saved: false; duplicate: true; repeated: boolean; observation: PetObservation } {
  const data = readData();
  const pet = data.profiles.find((profile) => profile.id === fields.petId);
  if (!pet) throw new Error("Pet profile not found for this observation.");
  const observation: PetObservation = { id: randomUUID(), ...fields, createdAt: new Date().toISOString() };
  const duplicate = data.observations.find((existing) => areDuplicateObservations(existing, observation, pet.name));
  const repeated = data.observations.some((existing) =>
    existing.petId === fields.petId && existing.type === fields.type &&
    similarObservationDescriptions(existing.description, fields.description, pet.name) &&
    Date.parse(observation.createdAt) - Date.parse(existing.createdAt) > 60 * 60 * 1000 &&
    Date.parse(observation.createdAt) - Date.parse(existing.createdAt) <= 7 * 24 * 60 * 60 * 1000
  );
  if (duplicate) return { saved: false, duplicate: true, repeated, observation: duplicate };
  data.observations.push(observation);
  writeData(data);
  return { saved: true, duplicate: false, repeated, observation };
}

export function listPetObservations(petId: string, limit = 10): PetObservation[] {
  return readData().observations
    .filter((observation) => observation.petId === petId)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

export function proposeCarePlan(fields: Pick<CarePlan, "petId" | "title" | "description" | "frequency" | "nextDueAt">):
  { saved: false; duplicate: true; plan: CarePlan } |
  { saved: false; approvalRequired: true; proposal: CarePlanProposal; approvalCommand: string } {
  const data = readData();
  const pet = data.profiles.find((profile) => profile.id === fields.petId);
  if (!pet) throw new Error("Pet profile not found for this care plan.");
  const duplicate = data.carePlans.find((plan) => plan.active && areSimilarCarePlans(plan, fields, pet.name));
  if (duplicate) return { saved: false, duplicate: true, plan: duplicate };
  const pending = data.carePlanProposals.find((proposal) => areSimilarCarePlans(proposal, fields, pet.name));
  if (pending) return { saved: false, approvalRequired: true, proposal: pending, approvalCommand: `ONAYLA ${pending.id}` };
  const proposal: CarePlanProposal = { id: randomUUID(), ...fields, createdAt: new Date().toISOString() };
  data.carePlanProposals.push(proposal);
  writeData(data);
  return { saved: false, approvalRequired: true, proposal, approvalCommand: `ONAYLA ${proposal.id}` };
}

export function confirmCarePlanProposal(proposalId: string, approvalCommand: string):
  { saved: true; duplicate: false; plan: CarePlan } | { saved: false; duplicate: true; plan: CarePlan } {
  if (approvalCommand.trim().toLocaleUpperCase("tr") !== `ONAYLA ${proposalId}`.toLocaleUpperCase("tr")) {
    throw new Error(`This care plan needs explicit approval. Send ONAYLA ${proposalId} to save it.`);
  }
  const data = readData();
  const proposal = data.carePlanProposals.find((item) => item.id === proposalId);
  if (!proposal) throw new Error("Care plan proposal not found or already approved.");
  const pet = data.profiles.find((profile) => profile.id === proposal.petId);
  if (!pet) throw new Error("Pet profile not found for this care plan.");
  const duplicate = data.carePlans.find((plan) => plan.active && areSimilarCarePlans(plan, proposal, pet.name));
  if (duplicate) return { saved: false, duplicate: true, plan: duplicate };
  const now = new Date().toISOString();
  const plan: CarePlan = {
    id: randomUUID(), petId: proposal.petId, title: proposal.title, description: proposal.description,
    frequency: proposal.frequency, nextDueAt: proposal.nextDueAt, active: true, createdAt: now, updatedAt: now,
  };
  data.carePlans.push(plan);
  data.carePlanProposals = data.carePlanProposals.filter((item) => item.id !== proposalId);
  writeData(data);
  return { saved: true, duplicate: false, plan };
}

export function listCarePlans(petId?: string, includeInactive = false): CarePlan[] {
  return readData().carePlans.filter((plan) =>
    (!petId || plan.petId === petId) && (includeInactive || plan.active)
  );
}

export function getCarePlan(planId: string): CarePlan {
  const plan = readData().carePlans.find((item) => item.id === planId);
  if (!plan) throw new Error("Care plan not found.");
  return plan;
}

export function updateCarePlan(planId: string, changes: Partial<Pick<CarePlan, "title" | "description" | "frequency" | "nextDueAt" | "active">>):
  { saved: true; plan: CarePlan } {
  const data = readData();
  const index = data.carePlans.findIndex((plan) => plan.id === planId);
  if (index < 0) throw new Error("Care plan not found.");
  const current = data.carePlans[index];
  const plan: CarePlan = { ...current, ...changes, updatedAt: new Date().toISOString() };
  const pet = data.profiles.find((profile) => profile.id === current.petId);
  if (plan.active && pet && data.carePlans.some((other) => other.id !== plan.id && other.active && areSimilarCarePlans(other, plan, pet.name))) {
    throw new Error("A similar active care plan already exists for this pet.");
  }
  data.carePlans[index] = plan;
  writeData(data);
  return { saved: true, plan };
}
