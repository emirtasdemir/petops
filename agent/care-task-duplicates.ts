export type ComparableCareTask = {
  petId: string;
  title: string;
  description: string;
  dueAt: string | null;
  status: "pending" | "completed";
};

const DUE_WINDOW_MS = 60 * 60 * 1000;
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "at", "bir", "bu", "et", "for", "icin", "is", "my", "nin", "of",
  "on", "s", "that", "the", "this", "to", "ve", "your",
]);

function taskTokens(text: string, petName: string): Set<string> {
  const normalized = text.toLocaleLowerCase("tr").normalize("NFKD")
    .replace(/\p{M}/gu, "").replace(/ı/g, "i");
  const petTokens = new Set(petName.toLocaleLowerCase("tr").normalize("NFKD")
    .replace(/\p{M}/gu, "").replace(/ı/g, "i").match(/[\p{L}\p{N}]+/gu) ?? []);
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens = words.filter((word) => !STOP_WORDS.has(word) && !petTokens.has(word)).map((word) => {
    if (/^mama/.test(word) || ["food", "meal"].includes(word)) return "food";
    if (/^kontrol/.test(word) || ["check", "inspect"].includes(word)) return "check";
    if (/^besle/.test(word) || ["feed", "feeding"].includes(word)) return "feed";
    if (["su", "water"].includes(word)) return "water";
    if (/^ilac/.test(word) || ["medicine", "medication"].includes(word)) return "medication";
    if (/^yuruyus/.test(word) || ["walk", "walking"].includes(word)) return "walk";
    return word;
  });
  return new Set(tokens);
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / (a.size + b.size - shared);
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  return [...a].every((token) => b.has(token));
}

function datesNear(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const first = Date.parse(a);
  const second = Date.parse(b);
  return Number.isFinite(first) && Number.isFinite(second) && Math.abs(first - second) <= DUE_WINDOW_MS;
}

export function areDuplicateCareTasks(a: ComparableCareTask, b: ComparableCareTask, petName: string): boolean {
  if (a.status !== "pending" || b.status !== "pending" || a.petId !== b.petId || !datesNear(a.dueAt, b.dueAt)) {
    return false;
  }
  const aTitle = taskTokens(a.title, petName);
  const bTitle = taskTokens(b.title, petName);
  if (similarity(aTitle, bTitle) < 0.75) return false;

  const aDescription = taskTokens(a.description, petName);
  const bDescription = taskTokens(b.description, petName);
  if (aDescription.size === 0 || bDescription.size === 0) return true;
  return similarity(aDescription, bDescription) >= 0.75 ||
    isSubset(aDescription, bDescription) || isSubset(bDescription, aDescription);
}
