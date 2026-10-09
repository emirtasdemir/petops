export type ComparableObservation = {
  petId: string;
  type: string;
  description: string;
  severity: string;
  observedAt: string;
  createdAt: string;
};

const DUPLICATE_WINDOW_MS = 60 * 60 * 1000;
const STOP_WORDS = new Set([
  "a", "an", "and", "at", "bir", "bugun", "bu", "icin", "is", "my", "nin", "of", "on",
  "s", "than", "the", "today", "ve",
]);

function tokens(text: string, petName: string): Set<string> {
  const normalize = (value: string) => value.toLocaleLowerCase("tr").normalize("NFKD")
    .replace(/\p{M}/gu, "").replace(/ı/g, "i");
  const names = new Set(normalize(petName).match(/[\p{L}\p{N}]+/gu) ?? []);
  const words = normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => !STOP_WORDS.has(word) && !names.has(word)).map((word) => {
    if (/^mama/.test(word) || word === "food") return "food";
    if (["az", "less", "reduced"].includes(word)) return "less";
    if (["normalden", "normal", "usual"].includes(word)) return "normal";
    if (["yedi", "yemedi", "ate", "eaten", "eat"].includes(word)) return "eat";
    if (/^kus/.test(word) || /^vomit/.test(word)) return "vomit";
    return word;
  }));
}

export function similarObservationDescriptions(a: string, b: string, petName: string): boolean {
  const first = tokens(a, petName);
  const second = tokens(b, petName);
  if (first.size === 0 || second.size === 0) return false;
  const shared = [...first].filter((word) => second.has(word)).length;
  return shared / (first.size + second.size - shared) >= 0.75;
}

export function areDuplicateObservations(a: ComparableObservation, b: ComparableObservation, petName: string): boolean {
  if (a.petId !== b.petId || a.type !== b.type || a.severity !== b.severity) return false;
  const createdGap = Math.abs(Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const observedGap = Math.abs(Date.parse(a.observedAt) - Date.parse(b.observedAt));
  return Number.isFinite(createdGap) && Number.isFinite(observedGap) &&
    createdGap <= DUPLICATE_WINDOW_MS && observedGap <= DUPLICATE_WINDOW_MS &&
    similarObservationDescriptions(a.description, b.description, petName);
}
