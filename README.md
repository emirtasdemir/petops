# PetOps

## Product Logo

<p align="center">
  <img src="public/petops-logo.png" alt="PetOps Logo" width="500">
</p>

## Product Name

**PetOps** — AI Pet Care Agent

## Project Description

PetOps is an AI pet care agent that helps users manage their pets' ongoing care through persistent profiles, observations, care tasks, and user-approved care plans. It turns everyday updates into structured records and practical follow-ups while keeping users in control of long-term plans.

The Agentmaxxing starter kit originally used Gemini. PetOps replaces its agent model layer with the official TypeScript `groq-sdk` package and uses Groq tool/function calling to select tools and incorporate their results into responses.

## Problem PetOps Solves

Pet care details often arrive as scattered notes: a change in appetite, a task to check tomorrow, or a routine that needs repeating. PetOps keeps those details connected to a pet profile, makes recent observations and pending tasks easy to retrieve, and lets users review a longer-term care plan before it becomes active.

## Tech Stack

Versions below are the dependency ranges declared in `package.json`:

| Technology | Declared version | Role |
| :--- | :--- | :--- |
| Next.js | `^16.3.6` | Web application and API routes |
| React / React DOM | `^19.3.0` | User interface |
| TypeScript | `^5.9.3` | Typed application and agent code |
| Groq SDK (`groq-sdk`) | `^1.6.0` | Model calls and tool/function calling |
| Tailwind CSS | `^4.3.3` | Styling |
| shadcn | `^4.21.0` | UI component tooling |
| viem | `^2.56.9` | Preserved starter wallet and x402 flow |

Pet data is stored in a local JSON file for Week 1. The interface also uses components built with `@base-ui/react` (`^1.8.0`).

## Supported AI Models

PetOps uses the Groq SDK. Set `GROQ_MODEL` in `.env` to choose the model. The following Groq provider model IDs have been used and tested for this project:

- `openai/gpt-oss-20b` — application fallback when `GROQ_MODEL` is unset or empty.
- `openai/gpt-oss-120b` — model selected in `.env.example`.

Other model IDs are not claimed as verified. The active model appears in the UI.

## Agent Tools

### PetOps core tools

PetOps has **9 core tools** for the care workflow:

| Tool | Purpose |
| :--- | :--- |
| `get_pet_profile` | Read a saved pet profile. |
| `save_pet_profile` | Save or update a pet profile. |
| `record_pet_observation` | Record a user-reported observation. |
| `get_pet_observations` | Retrieve a pet's recent observations. |
| `create_care_task` | Create a dated follow-up task. |
| `get_care_tasks` | Retrieve care tasks, including pending tasks. |
| `create_care_plan` | Propose a care plan, then save it after explicit approval. |
| `get_care_plan` | Retrieve saved care plans. |
| `update_care_plan` | Update or deactivate a saved plan on request. |

### Starter/demo tools

| Tool | Purpose |
| :--- | :--- |
| `get_my_wallet` | Read the optional agent wallet's address and testnet balance. |
| `get_weather` | Use the preserved paid weather/x402 example. |
| `roll_dice` | Run the starter's simple tool example. |

The registry in `agent/tool-registry.ts` places PetOps tools before starter/demo tools.

## Key Features

- **Persistent pet profiles:** Save a pet's identity, age, weight, food, and care notes for later conversations.
- **Persistent observations:** Record what a user actually reports and read recent observations in newest-first order.
- **Care task creation:** Turn a follow-up request into a dated task and list pending work.
- **Duplicate protection:** Avoid creating another similar observation, pending task, or active plan when one already exists.
- **User-approved care plans:** Show a proposal first; save a long-term plan only after explicit approval.
- **Local persistence:** Keep Week 1 pet records in `.petops-data.json` rather than losing them between local sessions.
- **Tool calling:** Let the Groq model call the appropriate registered tool and respond using the result.
- **Rate-limit handling:** Retry eligible transient model failures without rerunning successful tools and give rate-limit feedback when details are available.
- **Veterinary safety boundary:** Avoid definitive diagnoses or prescriptions and suggest veterinary evaluation for high-severity or recurring concerns.

## Demo Video

Demo video: Coming soon

## Demo Links

Week 1 (PetOps.v1): Coming soon

Live App: [https://petops-u7si.onrender.com](https://petops-u7si.onrender.com)

Repository: [https://github.com/emirtasdemir/petops](https://github.com/emirtasdemir/petops)

### Demo Flow

Start with an empty local data file and send these messages in order:

1. `My cat is named Luna. She is 3 years old and weighs 4.8 kg. Save her profile.`
2. `Luna ate less food than usual today.`
3. `What are Luna's recent observations?`
4. `Check this again tomorrow.`
5. `Create a care plan for Luna with daily food checks, weekly weight checks, and monthly general care. Show me the proposal before saving it.`
6. Review the proposed plan and use its approval button, or send the exact `ONAYLA <proposal-id>` command shown with it.
7. `Show Luna's saved care plan and pending tasks.`

The three cadences are represented in one `custom` plan description and require one approval. They do not automatically generate separate recurring tasks. If the user gives no start date or time, the plan's first due time defaults to 09:00 on the next day in the user's time zone.

The browser sends its IANA time zone with chat requests. The agent and tools use it for relative dates and local display; if it is missing or invalid, the server falls back to UTC. Stored timestamps use ISO format. The verification script explicitly uses `Europe/Istanbul` for reproducible checks; the application itself is not locked to Istanbul.

For isolated verification, set `PETOPS_DATA_FILE` to a new, empty path before starting the server. After `npm run build`, run `npm run start -- -p 3113`; in another terminal with the same data path, run `node scripts/verify-week1-demo.mjs`. The script never resets or deletes data, so use a fresh path for each run.

## Future Scope

- **Week 2 direction:** Move pet data to a hosted persistent database, add multi-user support, track pet food and supplies, and improve agent memory.
- **Week 3 direction:** Explore product recommendation and search tools, wallet-enabled actions, x402 paid API integration, and Base Sepolia payment experiments.

These are planned directions, not current Week 1 capabilities.

## Social Media

X/Twitter: https://x.com/PetOpsAI

## Installation

1. Install Node.js 20 or newer, then run `npm install`.
2. Copy `.env.example` to `.env` (`cp .env.example .env`, or `Copy-Item .env.example .env` in PowerShell).
3. Add your Groq API key to `GROQ_API_KEY` in `.env`. Select one of the project-tested models with `GROQ_MODEL`.
4. Run `npm run dev` and open [http://localhost:3000](http://localhost:3000).

Restart the server after changing `.env`. Creating a wallet is optional for the PetOps care flow.

## Environment Variables

The committed `.env.example` contains placeholders only:

```dotenv
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b
WALLET_PRIVATE_KEY=
```

| Variable | Purpose |
| :--- | :--- |
| `GROQ_API_KEY` | Required Groq API key; put the real value only in your ignored `.env` file. |
| `GROQ_MODEL` | Model ID; `.env.example` selects `openai/gpt-oss-120b`, and an empty or missing value falls back to `openai/gpt-oss-20b`. |
| `WALLET_PRIVATE_KEY` | Optional test-wallet private key for the preserved wallet/x402 example. Leave blank for the core PetOps flow. |
| `PETOPS_DATA_FILE` | Optional server-side path for a separate local JSON data file, useful for isolated verification. |

## Security & Safety

`.gitignore` excludes `.env` variants, `.agent-wallet.json`, `.petops-data.json`, and their local backups. `.env.example` contains no credentials. Keep API keys and private keys out of source files and commits. Use only a test wallet for the optional starter payment flow.

Wallet and x402 infrastructure are preserved from the starter kit but are not required for the Week 1 PetOps care workflow. PetOps does not provide definitive veterinary diagnoses or prescriptions; for high-severity or recurring observations, it can recommend veterinary evaluation. A proposed long-term care plan cannot be activated without explicit user approval.

## Current Limitations

- The local JSON store is designed for one local user. There is no account system, multi-user isolation, or hosted database yet.
- A `custom` plan can describe daily, weekly, and monthly activities, but it has one `nextDueAt` value and does not automatically schedule a series of recurring tasks.
- PetOps supports care tracking and follow-ups, not clinical decision-making. A veterinarian should guide medical decisions.
- Wallet and x402 tools are retained from the starter kit but are not part of the required Week 1 pet care flow.

## What I Learned in Week 1

- Tool schemas and agent instructions must agree, especially around optional values, IDs, and dates with time-zone offsets.
- A successful tool result should determine whether the agent says a record was saved. Duplicate checks and explicit approval protect persistent care data.
- Retrying only a failed model request avoids rerunning a tool that has already changed data. Rate-limit guidance should be specific only when the error details support it.
- Local persistence validates the care workflow while showing where stronger storage and access controls are needed.
