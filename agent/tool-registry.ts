import { petTools } from "./pet-tools";
import { supplyTools } from "./pet-supply-tools";
import { transferTools } from "./transfer-tools";
import { tools } from "./tools";

// Present the care workflow first; keep wallet and starter examples available afterward.
const petOrder = [
  "get_pet_profile", "save_pet_profile",
  "record_pet_observation", "get_pet_observations",
  "create_care_task", "get_care_tasks",
  "create_care_plan", "get_care_plan", "update_care_plan",
  "save_pet_supply", "get_pet_supplies", "update_pet_supply", "check_pet_supply_status",
];
const careTools = [...petTools, ...supplyTools];
export const availableTools = [
  ...petOrder.map((name) => careTools.find((tool) => tool.name === name)!),
  ...transferTools,
  ...tools.toSorted((a, b) => {
    if (a.name === "get_my_wallet") return -1;
    if (b.name === "get_my_wallet") return 1;
    return 0;
  }),
];
