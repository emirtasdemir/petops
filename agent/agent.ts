/**
 * THE AGENT
 *
 * An agent is a loop:
 *   1. Send the chat + the list of tools to Groq.
 *   2. If the model wants to call a tool -> run it, send back the result, repeat.
 *   3. If the model answers with text -> done.
 */
import Groq from "groq-sdk";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { availableTools } from "./tool-registry";
import { listPetObservations, listPetProfiles } from "./pet-store";
import { retryGroqCall } from "./groq-retry";
import { detectResponseLanguage, languageInstruction } from "./response-language";
import { careTaskError, explicitPlanRequest, explicitTaskRequest, handleSuggestionReply, suggestionsForTurn, withSuggestions } from "./proactive-agent";
import type { ActionSuggestion } from "./action-suggestions";

export const MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b";
const MAX_STEPS = 5;
const week2Evaluation = process.env.PETOPS_WEEK2_EVAL === "1";
const languageEvaluation = process.env.PETOPS_LANGUAGE_EVAL === "1";
const evaluationMode = week2Evaluation || languageEvaluation;
const week2ToolNames = new Set([
  "save_pet_supply", "check_pet_supply_status", "create_care_task",
]);
const languageToolNames = new Set(["save_pet_profile", "save_pet_supply", "check_pet_supply_status"]);
const agentTools = week2Evaluation ? availableTools.filter((tool) => week2ToolNames.has(tool.name))
  : languageEvaluation ? availableTools.filter((tool) => languageToolNames.has(tool.name)) : availableTools;

const SYSTEM_PROMPT =
  "You are PetOps AI Pet Care Agent. Help users track their pets' care and act on the pet facts they provide. " +
  "Use save_pet_profile for stable profile facts such as name, species, age, weight, food name, or lasting notes; do not treat a temporary symptom or today's appetite as a new profile. When the user explicitly asks to save a profile and gives a name plus an animal type, call save_pet_profile directly rather than asking for facts already stated. Words such as cat, kitten, kedi, or kedim supply species cat; dog, puppy, köpek, or köpeğim supply species dog. Extract stated age in years and weight in kg. Breed, foodName, and notes are optional: omit them when absent, without sending null or asking follow-up questions. Ask a follow-up only when a required name or species genuinely cannot be inferred from the user's message or saved profile. " +
  "Use get_pet_profile when asked what you know about a pet. Use create_care_task when asked to schedule or remember a care action, and get_care_tasks when asked about pending tasks. " +
  "When the user reports something they actually observed about a pet, such as Luna eating less than usual today, call get_pet_profile to check the saved pet, then call record_pet_observation with the user's facts. The saved pets are listed below; do not ask for species or age for a pet already listed. Keep the observation description in the user's language and close to their wording. Do not record hypothetical questions. Use get_pet_observations when asked about recent observations or history. " +
  "When asked for a recurring care plan, use the saved pet profiles and recent observations provided in the system context to suggest practical non-medical care. Call get_care_plan to check existing active plans, and use the profile and observation read tools when more detail is needed. Then call create_care_plan with mode propose to present a reviewable plan; this does not save an active plan. Show its title, description, frequency, next due date, and approval command. Only an explicit ONAYLA command for that proposal can save it. " +
  "If the user asks for one combined routine with daily, weekly, and monthly items, make ONE custom-frequency care plan whose description clearly lists each cadence. Do not silently drop any requested item or make three separately approved plans. " +
  "For care plans, omit nextDueAt when the user did not specify a starting date or time; the tool sets tomorrow 09:00 in the user's timezone. If the user specified one, pass that date and time with timezone offset. " +
  "Use get_care_plan to read saved plans. If the requested plan is already active, say it already exists and do not ask for another approval. Use update_care_plan only when the user explicitly requests a change to an existing plan. When changing a plan's frequency, also update its title and description if they still say the old frequency. Avoid duplicate active plans. After a plan is approved and saved, you may create one matching CareTask for its next due date if useful; do not create a whole recurring series at once. " +
  "Do not write a definitive medical treatment plan or veterinary prescription. General care means feeding, weight tracking, grooming, and observing; do not assign medical examinations to the user. For health-related care plans, mention that a veterinarian should review medical decisions. " +
  "For a new profile, ask for the pet's name or species only if it is genuinely missing after reading the user's message. Never ask again for a supplied name, animal type, age, or weight. For a care task naming a pet, call get_pet_profile first to check saved information; do not ask for species just because it is absent from the current message. If no profile exists, ask the user to create one. " +
  "For create_care_task, provide either petId or petName. When petId is known, pass petId and omit petName; never fill unused optional arguments with null. " +
  "For one user request, create each care task at most once. If create_care_task returns duplicate: true, tell the user the existing task was found; do not say a new task was created. " +
  "Record each reported observation at most once per request. If record_pet_observation returns duplicate: true, say it was already recorded, not that a new observation was saved. If it returns saved: true, you may confirm the new record. " +
  "Never give a definitive veterinary diagnosis. If the user's report is high severity or the tool reports repeated: true, recommend a veterinary evaluation without claiming a diagnosis, even if the record could not be saved. " +
  "When a due date is relative, calculate it from the current time in the user's timezone and pass an ISO 8601 timestamp with timezone offset. If no time is given, assume 09:00 local time and mention that assumption. " +
  "Never invent pet facts. Confirm a profile, task, or observation was saved only after its tool returns saved: true. If a tool fails, explain that nothing was saved. " +
  "For references like 'bu durumu' or 'this', resolve the latest relevant observation in the conversation; check its saved record when needed. If asked for both saved plans and pending tasks, call BOTH get_care_plan and get_care_tasks and summarize both results. " +
  "Pet supply tracking is a separate PetOps capability. When the user reports a current stock amount for a saved pet, use save_pet_supply; do not ask for optional usage or threshold values that were not given. Interpret g/day versus kg of stock with their stated units: pass dailyUsageUnit when it differs from unit, and never divide incompatible units. Use get_pet_supplies to list stock, update_pet_supply for an explicit change, and check_pet_supply_status for remaining days or low-stock questions. Estimate days only from a recorded positive dailyUsage; if missing, say the estimate is unavailable. If lowStock is true, suggest replenishing the supply but do not say it was bought or ordered. Offer a restock follow-up task, and call create_care_task for it only when the user explicitly asks for that task; never create one automatically from a low-stock result. Wallet and x402 are not used to purchase supplies. Confirm stock was saved or updated only when the corresponding tool returns saved: true; if duplicate: true, say the existing record was retained. " +
  "PetOps can proactively identify sensible next steps from profiles, observations, tasks, plans, and supplies. A separate structured suggestion layer adds those user-facing suggestions after your answer; do not duplicate its follow-up questions. Do not call create_care_task or propose a care plan unless the user explicitly requested that action. A simple yes or do it is handled only for a previously offered suggestion. Never claim a suggested task, plan, or purchase already happened. Do not infer that low supply caused an appetite or health observation. " +
  "The response language is fixed by a separate system instruction for this request. Apply it to final answers, tool-result explanations, errors, and care-plan proposals. Do not infer a language from saved data, tool output, or the user's timezone. Keep tool names, IDs, and internal fields unchanged. In Turkish answers use Günlük, Haftalık, Aylık, or Özel without English enum values in parentheses. For dates, use the tool's *Local field verbatim when present; ISO timestamps ending in Z are UTC and must not be labeled as local time. Keep answers short and practical. " +
  "Other starter tools remain available when relevant; the wallet pays automatically for paid tools.";

export type ChatMessage = { role: "user" | "agent"; text: string; suggestions?: ActionSuggestion[] };
export type Step = { tool: string; args: unknown; result: unknown; error?: boolean };

function toolCallKey(name: string, args: unknown): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sorted(item)]))
      : value;
  return `${name}:${JSON.stringify(sorted(args))}`;
}

export async function runAgent(history: ChatMessage[], ctx: { baseUrl: string; timeZone?: string }) {
  const userMessage = history.at(-1)?.role === "user" ? history.at(-1)!.text.trim() : "";
  const responseLanguage = detectResponseLanguage(userMessage);
  let timeZone = ctx.timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    timeZone = "UTC";
  }
  const toolContext = { ...ctx, timeZone, userMessage };
  const suggestionReply = await handleSuggestionReply(history, responseLanguage, timeZone);
  if (suggestionReply) return suggestionReply;
  const approval = /^ONAYLA\s+([0-9a-f]{8}-[0-9a-f-]{27})$/i.exec(userMessage);
  if (approval) {
    const tool = availableTools.find((item) => item.name === "create_care_plan")!;
    const args = { mode: "confirm", proposalId: approval[1] };
    try {
      const result = await tool.run(args, toolContext) as {
        saved: boolean; duplicate: boolean; plan: { id: string; title: string };
      };
      return {
        answer: result.saved
          ? responseLanguage === "tr" ? `“${result.plan.title}” bakım planı kaydedildi.` : `Care plan “${result.plan.title}” was saved.`
          : responseLanguage === "tr" ? `Benzer bir aktif bakım planı zaten var: “${result.plan.title}”. Yeni plan oluşturulmadı.` : `A similar active care plan already exists: “${result.plan.title}”. No new plan was created.`,
        steps: [{ tool: tool.name, args, result, error: false }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        answer: responseLanguage === "tr" ? "Bakım planı kaydedilemedi. Lütfen tekrar deneyin." : "The care plan could not be saved. Please try again.",
        steps: [{ tool: tool.name, args, result: { error: message }, error: true }],
      };
    }
  }

  const ai = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 });
  const savedPets = listPetProfiles().map(({ id, name, species, age, weightKg }) => ({
    id, name, species, age, weightKg,
    recentObservations: listPetObservations(id, 3).map(({ type, description, severity, observedAt }) => ({
      type, description, severity, observedAt,
    })),
  }));
  const currentTime = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "full", timeStyle: "long" }).format(new Date());
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: `${SYSTEM_PROMPT} Saved pet profiles and recent observations: ${JSON.stringify(savedPets)}. Current time: ${currentTime}. User timezone: ${timeZone}.` },
    { role: "system", content: languageInstruction(responseLanguage) },
    ...history.map((m): ChatCompletionMessageParam => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    })),
  ];
  const steps: Step[] = [];
  const failedCalls = new Set<string>();
  let modelCalls = 0;

  for (let i = 0; i < MAX_STEPS; i++) {
    const response = await retryGroqCall(() => {
      modelCalls++;
      return ai.chat.completions.create({
        model: MODEL,
        messages,
        ...(evaluationMode ? { reasoning_effort: "low" as const } : {}),
        tools: agentTools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters as Record<string, unknown>,
          },
        })),
      });
    });

    const message = response.choices[0]?.message;
    if (!message) throw new Error("Groq returned no message.");
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      const suggestions = suggestionsForTurn({ userMessage, steps, language: responseLanguage, timeZone });
      return { answer: withSuggestions(message.content ?? "", suggestions), steps, suggestions,
        ...(evaluationMode ? { modelCalls } : {}) };
    }

    // Preserve the assistant's tool calls so each result can be matched by ID.
    messages.push({ role: "assistant", content: message.content, tool_calls: calls });

    for (const call of calls) {
      const tool = agentTools.find((t) => t.name === call.function.name);
      let args: unknown = call.function.arguments;
      let result: unknown;
      let error = false;
      let key: string | undefined;
      try {
        args = JSON.parse(call.function.arguments);
        key = toolCallKey(call.function.name, args);
        if (failedCalls.has(key)) {
          return {
            answer: responseLanguage === "tr"
              ? "Aynı başarısız araç çağrısını yeniden çalıştırmadım. Lütfen isteği veya bilgileri gözden geçirin."
              : "I did not repeat the same failed tool call. Please review the request or its details.",
            steps, ...(evaluationMode ? { modelCalls } : {}),
          };
        }
        if (!tool) throw new Error(`No tool named ${call.function.name}`);
        if (tool.name === "create_care_task" && !explicitTaskRequest(userMessage)) {
          throw new Error("Creating a care task requires an explicit user request or confirmation of a suggestion.");
        }
        if (tool.name === "create_care_plan" && (args as { mode?: unknown }).mode === "propose" &&
            !explicitPlanRequest(userMessage)) {
          throw new Error("Preparing a care plan requires an explicit user request or confirmation of a suggestion.");
        }
        result = await tool.run(args, toolContext);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
        error = true;
        if (key) failedCalls.add(key);
      }
      steps.push({ tool: call.function.name, args, result, error });
      if (error && call.function.name === "create_care_task") {
        return { answer: careTaskError((result as { error: string }).error, responseLanguage),
          steps, ...(evaluationMode ? { modelCalls } : {}) };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ result }) });
    }
  }

  return {
    answer: responseLanguage === "tr"
      ? "İşlem adımı sınırına ulaştım. İsteğini daha kısa yazarak tekrar dener misin?"
      : "I reached the step limit. Could you try a shorter request?",
    steps, ...(evaluationMode ? { modelCalls } : {}),
  };
}
