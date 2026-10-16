import assert from "node:assert/strict";
import test from "node:test";
import { detectResponseLanguage, languageInstruction } from "../agent/response-language.ts";

test("English is the default for unclear or English requests", () => {
  assert.equal(detectResponseLanguage(""), "en");
  assert.equal(detectResponseLanguage("About how many days will Luna's food last?"), "en");
  assert.equal(detectResponseLanguage("I have a 3-year-old cat named Luna who weighs 4.8 kg."), "en");
});

test("Turkish characters and distinctive words select Turkish", () => {
  assert.equal(detectResponseLanguage("Luna için 4 kg mama kaldı."), "tr");
  assert.equal(detectResponseLanguage("Luna adinda bir kedim var. Profilini kaydet."), "tr");
  assert.equal(detectResponseLanguage("LUNA'NIN MAMASI KAC GUN YETER?"), "tr");
});

test("the fixed instruction addresses only natural language", () => {
  assert.match(languageInstruction("en"), /^RESPONSE LANGUAGE: English\./);
  assert.match(languageInstruction("tr"), /^RESPONSE LANGUAGE: Turkish\./);
  assert.match(languageInstruction("en"), /tool names, JSON fields, and technical identifiers unchanged/);
});
