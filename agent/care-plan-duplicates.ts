export type ComparableCarePlan = {
  petId: string;
  title: string;
  description: string;
  frequency: string;
};

function words(text: string, petName: string): Set<string> {
  const normalize = (value: string) => value.toLocaleLowerCase("tr").normalize("NFKD")
    .replace(/\p{M}/gu, "").replace(/ı/g, "i");
  const petWords = new Set(normalize(petName).match(/[\p{L}\p{N}]+/gu) ?? []);
  const stopWords = new Set(["a", "an", "and", "bir", "bu", "for", "icin", "of", "on", "the", "ve"]);
  return new Set((normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => !petWords.has(word) && !stopWords.has(word))
    .map((word) => {
      if (/^gunluk/.test(word)) return "daily";
      if (/^haftalik/.test(word)) return "weekly";
      if (/^aylik/.test(word)) return "monthly";
      if (/^bakim/.test(word)) return "care";
      if (/^plan/.test(word)) return "plan";
      return word;
    }));
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / (a.size + b.size - shared);
}

export function areSimilarCarePlans(a: ComparableCarePlan, b: ComparableCarePlan, petName: string): boolean {
  if (a.petId !== b.petId || a.frequency !== b.frequency) return false;
  const titleSimilarity = similarity(words(a.title, petName), words(b.title, petName));
  if (titleSimilarity < 0.75) return false;
  if (titleSimilarity === 1) return true;
  const firstDescription = words(a.description, petName);
  const secondDescription = words(b.description, petName);
  return !firstDescription.size || !secondDescription.size ||
    similarity(firstDescription, secondDescription) >= 0.6;
}
