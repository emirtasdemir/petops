import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { x402ResourceServer } from "@x402/core/server";
import type { FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { Address } from "viem";
import { findPetProfile, listCarePlans, listCareTasks, listPetObservations, listPetSupplies } from "./pet-store.ts";
import { PREMIUM_PATH, PREMIUM_PRICE, X402_NETWORK } from "./x402-config.ts";

export function createPremiumHandler(payTo: Address, facilitator: FacilitatorClient) {
  const server = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactEvmScheme());
  const handler = async (request: NextRequest) => {
    const petId = request.nextUrl.searchParams.get("petId") || "";
    const turkish = request.nextUrl.searchParams.get("lang") === "tr";
    try {
      const pet = findPetProfile(petId);
      const observations = listPetObservations(pet.id, 5);
      const pendingTasks = listCareTasks({ petId: pet.id, status: "pending" });
      const activePlans = listCarePlans(pet.id).filter((plan) => plan.active);
      const supplies = listPetSupplies(pet.id);
      return NextResponse.json({
        title: "Premium Pet Care Report", pet: { name: pet.name, species: pet.species, age: pet.age, weightKg: pet.weightKg },
        careSummary: { recentObservations: observations.length, pendingTasks: pendingTasks.length, activePlans: activePlans.length, supplies: supplies.length },
        feedingReminders: supplies.filter((item) => item.category === "food").map((item) => item.name),
        activitySuggestions: [turkish ? "Evcil hayvanınıza uygun düzenli bir aktivite rutini sürdürün." : "Keep a consistent activity routine appropriate for your pet."],
        observationFollowUp: observations.map((item) => ({ type: item.type, description: item.description, severity: item.severity })),
        generalRecommendations: turkish
          ? ["Bekleyen bakım görevlerini gözden geçirin.", "Süren veya kötüleşen sağlık sorunlarını veterinerle görüşün."]
          : ["Review pending care tasks.", "Discuss persistent or worsening health concerns with a veterinarian."],
        veterinaryNote: turkish
          ? "Bu rapor genel bakım önerisidir; veteriner teşhisi veya reçetesi değildir."
          : "This report is general care guidance, not a veterinary diagnosis or prescription.",
      });
    } catch {
      return NextResponse.json({ error: "Pet profile not found." }, { status: 404 });
    }
  };
  return withX402<unknown>(handler, {
    [PREMIUM_PATH]: {
      accepts: { scheme: "exact", price: PREMIUM_PRICE, network: X402_NETWORK, payTo },
      description: "Premium Pet Care Report", mimeType: "application/json",
    },
  }, server);
}
