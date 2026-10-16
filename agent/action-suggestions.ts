import type { CarePlan, CareTask, PetObservation, PetProfile, PetSupply } from "./pet-store";
import { similarObservationDescriptions } from "./observation-duplicates.ts";
import { supplyStatus } from "./pet-supply.ts";
import type { ResponseLanguage } from "./response-language";

export type ActionSuggestionType =
  | "follow_up_task" | "restock_task" | "care_plan" | "monitor_observation"
  | "provide_missing_data" | "veterinary_follow_up" | "task_follow_up";

export type ActionSuggestion = {
  id: string;
  petId: string;
  type: ActionSuggestionType;
  title: string;
  description: string;
  suggestedTool: "create_care_task" | "create_care_plan" | null;
  suggestedArgs: Record<string, unknown> | null;
  requiresConfirmation: boolean;
};

export type SuggestionContext = {
  pet: PetProfile;
  observations: PetObservation[];
  tasks: CareTask[];
  plans: CarePlan[];
  supplies: PetSupply[];
  language: ResponseLanguage;
  timeZone: string;
  now: Date;
  focus: { profile?: boolean; observation?: PetObservation; repeated?: boolean; supply?: boolean; tasks?: boolean; plan?: boolean };
};

export function nextLocalMorning(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const localNineAsUtc = Date.UTC(value("year"), value("month") - 1, value("day") + 1, 9);
  let candidate = localNineAsUtc;
  for (let i = 0; i < 2; i++) {
    const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(candidate)).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
    const offset = match ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
    candidate = localNineAsUtc - offset * 60_000;
  }
  return new Date(candidate).toISOString();
}

function suggestion(input: Omit<ActionSuggestion, "requiresConfirmation">): ActionSuggestion {
  return { ...input, requiresConfirmation: input.suggestedTool !== null };
}

export function buildActionSuggestions(context: SuggestionContext): ActionSuggestion[] {
  const { pet, observations, tasks, plans, supplies, language, focus, now, timeZone } = context;
  const tr = language === "tr";
  const items: ActionSuggestion[] = [];
  const tomorrow = nextLocalMorning(now, timeZone);

  if (focus.observation) {
    const observation = focus.observation;
    const repeated = focus.repeated || observations.some((other) =>
      other.id !== observation.id && other.type === observation.type &&
      similarObservationDescriptions(other.description, observation.description, pet.name));
    const reducedAppetite = observation.type === "appetite" &&
      /\b(?:less|reduced|decreased|poor|not eating|ate little|eating little)\b|az\s+(?:mama|yedi)|iştahsız|iştahı\s+az/iu
        .test(observation.description);
    if (reducedAppetite) {
      const alreadyScheduled = tasks.some((task) => task.status === "pending" &&
        /(?:appetite|iştah)/iu.test(task.title));
      items.push(suggestion({
        id: `follow-up:${observation.id}`, petId: pet.id, type: "follow_up_task",
        title: tr ? "İştah kontrolü" : "Appetite follow-up",
        description: alreadyScheduled
          ? tr ? `${pet.name} için iştah takibi öneririm; bu konuda bekleyen bir görev zaten var.`
            : `I recommend monitoring ${pet.name}'s appetite; a pending follow-up task already exists.`
          : tr
            ? `${pet.name} normalden az yedi. Yarın iştahını tekrar kontrol etmek için görev oluşturmamı ister misiniz?`
            : `${pet.name} ate less than usual. I recommend checking their appetite again tomorrow. Would you like me to create a follow-up task?`,
        suggestedTool: alreadyScheduled ? null : "create_care_task",
        suggestedArgs: alreadyScheduled ? null : {
          petId: pet.id,
          title: tr ? `${pet.name} için iştahı tekrar kontrol et` : `Check ${pet.name}'s appetite again`,
          description: tr ? "İştah değişimini takip et." : "Follow up on the appetite change.",
          dueAt: tomorrow,
        },
      }));
    }
    if (repeated || observation.severity === "high") {
      items.push(suggestion({
        id: `vet-follow-up:${observation.id}`, petId: pet.id, type: "veterinary_follow_up",
        title: tr ? "Yakın takip" : "Close monitoring",
        description: tr
          ? "Bu gözlem tekrarlandı veya yüksek önem taşıyor. Yakından izleyin; sürer ya da kötüleşirse veteriner değerlendirmesi alın. Bu bir teşhis değildir."
          : "This has been recorded more than once or marked high severity. Monitor it closely and seek veterinary advice if it continues or worsens. This is not a diagnosis.",
        suggestedTool: null, suggestedArgs: null,
      }));
    }
  }

  if (focus.supply || focus.observation) {
    for (const supply of supplies) {
      const status = supplyStatus(supply);
      if (status.lowStock === true) {
        const alreadyScheduled = tasks.some((task) => task.status === "pending" &&
          task.title.toLocaleLowerCase("tr").includes(supply.name.toLocaleLowerCase("tr")) &&
          /\b(?:buy|restock|replenish)\b|satın al|stok yenile/iu.test(task.title));
        items.push(suggestion({
          id: `restock:${supply.id}`, petId: pet.id, type: "restock_task",
          title: tr ? "Stok yenileme" : "Restock supply",
          description: focus.observation
            ? tr
              ? `${pet.name} için ${supply.name} stoğu da düşük. Bu durum ile gözlem arasında bir neden-sonuç ilişkisi kurulamıyor; stoğu ayrıca takip edin.`
              : `${pet.name}'s ${supply.name} stock is also low. This does not establish a cause for the observation; track the stock separately.`
            : alreadyScheduled
              ? tr ? `${pet.name} için ${supply.name} stoğu düşük; yeniden alma için bekleyen bir görev zaten var.`
                : `${pet.name}'s ${supply.name} is running low; a pending restock task already exists.`
            : tr
              ? `${pet.name} için ${supply.name} stoğu düşük. Yarın yeniden alma görevi oluşturmamı ister misiniz?`
              : `${pet.name}'s ${supply.name} is running low. I recommend creating a restock task for tomorrow. Would you like me to do that?`,
          suggestedTool: focus.observation || alreadyScheduled ? null : "create_care_task",
          suggestedArgs: focus.observation || alreadyScheduled ? null : {
            petId: pet.id,
            title: tr ? `${pet.name} için ${supply.name} satın al` : `Buy more ${supply.name} for ${pet.name}`,
            description: tr ? "Düşük stoğu yenile." : "Restock the low supply.",
            dueAt: tomorrow,
          },
        }));
      }
      if (supply.dailyUsage === null) {
        items.push(suggestion({
          id: `usage:${supply.id}`, petId: pet.id, type: "provide_missing_data",
          title: tr ? "Günlük tüketim eksik" : "Daily usage needed",
          description: tr
            ? `${supply.name} stoğunun kaç gün yeteceğini yaklaşık hesaplamak için günlük tüketimini paylaşabilirsiniz.`
            : `I can estimate how long ${supply.name} will last if you tell me the approximate daily usage.`,
          suggestedTool: null, suggestedArgs: null,
        }));
      }
    }
  }

  if ((focus.profile || focus.plan) && !plans.some((plan) => plan.active)) {
    const latest = observations[0];
    const profileSummary = tr
      ? `${pet.name} (${pet.species}${pet.age === null ? "" : `, ${pet.age} yaşında`})`
      : `${pet.name} (${pet.species}${pet.age === null ? "" : `, age ${pet.age}`})`;
    const planDescription = tr
      ? `${profileSummary} için günlük mama ve su kontrolü.${latest ? ` Son ${latest.type} gözlemini ayrıca takip et.` : ""}`
      : `Check food and water daily for ${profileSummary}.${latest ? ` Also monitor the recent ${latest.type} observation.` : ""}`;
    items.push(suggestion({
      id: `care-plan:${pet.id}`, petId: pet.id, type: "care_plan",
      title: tr ? "Bakım planı önerisi" : "Care plan proposal",
      description: tr
        ? `${pet.name} için aktif bir bakım planı yok. Profiline ve son gözlemlerine göre bir taslak hazırlamamı ister misiniz? Taslak ayrıca onaylanmadan kaydedilmez.`
        : `${pet.name} doesn't have an active care plan yet. I can prepare a draft based on the saved profile and recent observations. Would you like me to? The plan will not be saved without separate approval.`,
      suggestedTool: "create_care_plan",
      suggestedArgs: {
        mode: "propose", petId: pet.id,
        title: tr ? `${pet.name} için günlük bakım` : `Daily care for ${pet.name}`,
        description: planDescription,
        frequency: "daily",
      },
    }));
  }

  if (focus.tasks) {
    const pending = tasks.filter((task) => task.status === "pending" && task.dueAt);
    const overdue = pending.find((task) => Date.parse(task.dueAt!) < now.getTime());
    const upcoming = pending.find((task) => {
      const until = Date.parse(task.dueAt!) - now.getTime();
      return until >= 0 && until <= 48 * 60 * 60 * 1000;
    });
    const task = overdue ?? upcoming;
    if (task) {
      items.push(suggestion({
        id: `task-follow-up:${task.id}`, petId: pet.id, type: "task_follow_up",
        title: tr ? "Bekleyen görev" : "Pending care task",
        description: overdue
          ? tr ? `“${task.title}” görevinin tarihi geçti. Tamamlandığını varsaymıyorum; durumunu kontrol edin.`
            : `“${task.title}” is overdue. I won't assume it was completed; please check its status.`
          : tr ? `“${task.title}” görevinin tarihi yaklaşıyor. Gerekirse takip edin.`
            : `“${task.title}” is due soon. Please follow up if needed.`,
        suggestedTool: null, suggestedArgs: null,
      }));
    }
  }

  return items.slice(0, 3);
}

export function renderActionSuggestions(items: ActionSuggestion[]): string {
  return items.map((item) => item.description).join("\n\n");
}
