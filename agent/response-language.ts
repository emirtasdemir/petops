export type ResponseLanguage = "en" | "tr";

const turkishWords = new Set([
  "adında", "ağırlığında", "benim", "bir", "bugün", "görev", "göster", "için", "kaç",
  "kaldı", "kedi", "kedim", "kedimin", "köpek", "köpeğim", "maması", "mamasını",
  "normalden", "onayla", "profilini", "saat", "stoğu", "stok", "tüketiyor", "yarın", "yeter",
]);

export function detectResponseLanguage(message: string): ResponseLanguage {
  if (/[çğıİöşü]/i.test(message)) return "tr";
  const words = message.toLocaleLowerCase("tr").match(/\p{L}+/gu) ?? [];
  return words.some((word) => turkishWords.has(word)) ? "tr" : "en";
}

export function languageInstruction(language: ResponseLanguage): string {
  const instruction = language === "tr"
    ? "RESPONSE LANGUAGE: Turkish. All user-facing natural-language text in this turn must be Turkish. Do not switch languages."
    : "RESPONSE LANGUAGE: English. All user-facing natural-language text in this turn must be English. Do not switch languages.";
  return `${instruction} Keep tool names, JSON fields, and technical identifiers unchanged.`;
}
