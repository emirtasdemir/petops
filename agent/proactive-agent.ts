import { availableTools } from "./tool-registry";
import { listCarePlans, listCareTasks, listPetObservations, listPetProfiles, listPetSupplies } from "./pet-store";
import { buildActionSuggestions, nextLocalMorning, renderActionSuggestions, type ActionSuggestion } from "./action-suggestions";
import type { ResponseLanguage } from "./response-language";

type ToolStep = { tool: string; result: unknown; error?: boolean };
type ChatTurn = { role: "user" | "agent"; text: string; suggestions?: ActionSuggestion[] };

function resultObject(step: ToolStep): Record<string, unknown> {
  return step.result && typeof step.result === "object" ? step.result as Record<string, unknown> : {};
}

export function suggestionsForTurn(input: {
  userMessage: string; steps: ToolStep[]; language: ResponseLanguage; timeZone: string; now?: Date;
}): ActionSuggestion[] {
  const profiles = listPetProfiles();
  const matchingStep = [...input.steps].reverse().find((step) => !step.error &&
    ["record_pet_observation", "save_pet_profile", "get_pet_profile", "save_pet_supply", "update_pet_supply",
      "check_pet_supply_status", "get_pet_supplies", "get_care_tasks", "get_care_plan"].includes(step.tool));
  const result = matchingStep ? resultObject(matchingStep) : {};
  const nested = (result.observation ?? result.profile ?? result.supply) as { petId?: string; id?: string } | undefined;
  const petId = typeof result.petId === "string" ? result.petId : nested?.petId ??
    (matchingStep?.tool === "save_pet_profile" || matchingStep?.tool === "get_pet_profile" ? nested?.id : undefined);
  const pet = profiles.find((item) => item.id === petId) ??
    profiles.find((item) => input.userMessage.toLocaleLowerCase("tr").includes(item.name.toLocaleLowerCase("tr"))) ??
    (profiles.length === 1 ? profiles[0] : undefined);
  if (!pet) return [];

  const observationStep = [...input.steps].reverse().find((step) =>
    !step.error && step.tool === "record_pet_observation");
  const observationResult = observationStep ? resultObject(observationStep) : {};
  const observation = observationResult.observation && typeof observationResult.observation === "object"
    ? observationResult.observation as ReturnType<typeof listPetObservations>[number]
    : undefined;
  const toolNames = new Set(input.steps.filter((step) => !step.error).map((step) => step.tool));
  const alreadyActed = toolNames.has("create_care_task") || toolNames.has("create_care_plan");
  if (alreadyActed) return [];
  const supplyFocus = ["save_pet_supply", "update_pet_supply", "get_pet_supplies", "check_pet_supply_status"]
    .some((name) => toolNames.has(name));
  const profileFocus = toolNames.has("save_pet_profile") || toolNames.has("get_pet_profile") ||
    /\b(?:profile|what do you know)\b|profil|hakkında/i.test(input.userMessage);
  const planFocus = toolNames.has("get_care_plan") || /\b(?:care plan|routine)\b|bakım planı/i.test(input.userMessage);
  const taskFocus = toolNames.has("get_care_tasks") || /\b(?:pending|upcoming|overdue)\b|bekleyen|yaklaşan|geciken/i.test(input.userMessage);
  return buildActionSuggestions({
    pet,
    observations: listPetObservations(pet.id, 20),
    tasks: listCareTasks({ petId: pet.id, status: "pending" }),
    plans: listCarePlans(pet.id),
    supplies: listPetSupplies(pet.id),
    language: input.language,
    timeZone: input.timeZone,
    now: input.now ?? new Date(),
    focus: {
      observation,
      repeated: observationResult.repeated === true,
      supply: supplyFocus,
      profile: profileFocus && !observation && !supplyFocus,
      plan: planFocus && !observation && !supplyFocus,
      tasks: taskFocus,
    },
  });
}

export function withSuggestions(answer: string, suggestions: ActionSuggestion[]): string {
  const rendered = renderActionSuggestions(suggestions);
  return rendered ? `${answer.trim()}\n\n${rendered}`.trim() : answer;
}

export function isAffirmative(message: string): boolean {
  return /^(?:yes(?:,? please)?|do it|please do|go ahead|sure|evet|evet lütfen|yap|lütfen yap|tamam|onaylıyorum)[.!\s]*$/iu
    .test(message.trim());
}

export function isNegative(message: string): boolean {
  return /^(?:no(?: thanks)?|not now|hayır|hayır teşekkürler|şimdi değil)[.!\s]*$/iu.test(message.trim());
}

export function explicitTaskRequest(message: string): boolean {
  return /\b(?:create|make|add|schedule|set)\b.{0,70}\b(?:task|reminder)\b|\bremind me\b|^(?:please\s+)?(?:check|buy|restock)\b.{0,70}\b(?:tomorrow|next week)\b|(?:görev|hatırlatıcı).{0,60}(?:oluştur|ekle|ayarla)|(?:yarın|haftaya).{0,60}(?:kontrol et|hatırlat|al)|(?:kontrol et|hatırlat).{0,60}(?:yarın|haftaya)/iu
    .test(message);
}

export function explicitPlanRequest(message: string): boolean {
  return /\b(?:create|prepare|draft|make|build)\b.{0,70}\b(?:plan|routine)\b|(?:plan|rutin).{0,60}(?:hazırla|oluştur|yap)|(?:hazırla|oluştur).{0,60}(?:plan|rutin)/iu
    .test(message);
}

function previousSuggestions(history: ChatTurn[]): ActionSuggestion[] {
  const previous = history.at(-2);
  return previous?.role === "agent" && Array.isArray(previous.suggestions) ? previous.suggestions : [];
}

export async function handleSuggestionReply(history: ChatTurn[], language: ResponseLanguage, timeZone: string):
  Promise<{ answer: string; steps: { tool: string; args: unknown; result: unknown; error: boolean }[]; suggestions: ActionSuggestion[] } | null> {
  const userMessage = history.at(-1)?.text ?? "";
  if (!isAffirmative(userMessage) && !isNegative(userMessage)) return null;
  const pending = previousSuggestions(history);
  if (!pending.length) return null;
  if (isNegative(userMessage)) return {
    answer: language === "tr" ? "Tamam, herhangi bir yeni görev veya plan oluşturmuyorum." : "Okay, I won't create a new task or plan.",
    steps: [], suggestions: [],
  };
  const actionable = pending.filter((item) => item.requiresConfirmation && item.suggestedTool);
  if (actionable.length !== 1) return {
    answer: language === "tr" ? "Hangi öneriyi onayladığınızı belirtir misiniz?" : "Which suggestion would you like me to act on?",
    steps: [], suggestions: pending,
  };
  const proposal = actionable[0];
  const expectedTool = proposal.type === "care_plan" ? "create_care_plan"
    : proposal.type === "restock_task" || proposal.type === "follow_up_task" ? "create_care_task" : null;
  const pet = listPetProfiles().find((item) => item.id === proposal.petId);
  const observations = pet ? listPetObservations(pet.id, 20) : [];
  const supplies = pet ? listPetSupplies(pet.id) : [];
  const current = pet && proposal.suggestedTool === expectedTool
    ? buildActionSuggestions({
      pet, observations, supplies, tasks: listCareTasks({ petId: pet.id, status: "pending" }),
      plans: listCarePlans(pet.id), language, timeZone, now: new Date(),
      focus: {
        profile: proposal.type === "care_plan",
        observation: proposal.type === "follow_up_task"
          ? observations.find((item) => proposal.id === `follow-up:${item.id}`) : undefined,
        supply: proposal.type === "restock_task",
      },
    }).find((item) => item.id === proposal.id && item.suggestedTool === expectedTool)
    : undefined;
  const tool = availableTools.find((item) => item.name === current?.suggestedTool);
  if (!current || !tool || !current.suggestedArgs || current.suggestedArgs.petId !== proposal.petId) return {
    answer: language === "tr" ? "Bu öneri artık geçerli değil. Güncel durumu tekrar kontrol edin." : "That suggestion is no longer current. Please check the latest status again.",
    steps: [], suggestions: [],
  };
  const args = current.suggestedTool === "create_care_task"
    ? { ...current.suggestedArgs, dueAt: nextLocalMorning(new Date(), timeZone) }
    : current.suggestedArgs;
  try {
    const result = await tool.run(args, { baseUrl: "", timeZone, userMessage });
    const outcome = result as { saved?: boolean; duplicate?: boolean; approvalRequired?: boolean; task?: { title?: string }; proposal?: { title?: string }; approvalCommand?: string };
    const answer = current.suggestedTool === "create_care_plan"
      ? outcome.approvalRequired
        ? language === "tr"
          ? `Bakım planı taslağı hazırlandı: “${outcome.proposal?.title ?? proposal.title}”. Kaydetmek için ${outcome.approvalCommand} yazın.`
          : `I prepared a care plan draft: “${outcome.proposal?.title ?? proposal.title}”. To save it, send ${outcome.approvalCommand}.`
        : language === "tr" ? "Bakım planı taslağı hazırlanamadı." : "The care plan draft could not be prepared."
      : outcome.saved
        ? language === "tr" ? `Görev oluşturuldu: “${outcome.task?.title ?? proposal.title}”.` : `Task created: “${outcome.task?.title ?? proposal.title}”.`
        : outcome.duplicate
          ? language === "tr" ? "Benzer bir bekleyen görev zaten var; yeni görev oluşturulmadı." : "A similar pending task already exists; no new task was created."
          : language === "tr" ? "Görev oluşturulamadı." : "The task could not be created.";
    return { answer, steps: [{ tool: tool.name, args, result, error: false }], suggestions: [] };
  } catch (error) {
    return {
      answer: language === "tr" ? "Önerilen aksiyon tamamlanamadı; yeni kayıt oluşturulduğunu varsaymayın." : "The suggested action could not be completed; no new record is confirmed.",
      steps: [{ tool: tool.name, args, result: { error: error instanceof Error ? error.message : String(error) }, error: true }],
      suggestions: [],
    };
  }
}
