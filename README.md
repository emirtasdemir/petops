# PetOps

## What is PetOps?

PetOps is an AI pet care agent that helps users manage their pets’ ongoing care through persistent profiles, observations, care tasks, and user-approved care plans. It turns everyday updates into structured records and practical follow-ups while keeping people in control of long-term plans.

The starter kit originally used Gemini. For PetOps, the agent's model layer was migrated to Groq using the official TypeScript `groq-sdk` package. The agent uses Groq tool/function calling to select and run PetOps tools, then incorporates their results into its response.

## Week 1 Features

- Save and read pet profiles, including name, species, age, weight, food, and care notes.
- Record real observations, such as a change in appetite, and retrieve recent observations in newest-first order.
- Create dated care tasks and list pending tasks.
- Propose daily, weekly, monthly, or custom care plans. A proposal is stored for review, but it does **not** become an active long-term plan until the user explicitly approves it.
- Avoid duplicate observations, pending tasks, and active plans when similar records already exist.
- Retry eligible Groq model requests without rerunning tools that have already succeeded, and provide rate-limit messages based on the available error details.

Pet records are persisted in a local JSON file for Week 1. The wallet and x402 payment infrastructure from the starter kit remain available, but neither is required for the PetOps care flow at this stage.

## Tech Stack

- **Next.js, React, and TypeScript** for the application and API routes.
- **Groq `groq-sdk`** for the agent's model calls and tool/function calling.
- **Tailwind CSS and shadcn/ui** for the interface.
- **Local JSON storage** for Week 1 pet profiles, observations, care tasks, and care plans.
- **viem and the preserved x402 example** for the optional starter wallet and paid weather flow.

## Installation

1. Install Node.js 20 or newer, then run `npm install`.
2. Copy `.env.example` to `.env` (`cp .env.example .env`, or `Copy-Item .env.example .env` in PowerShell).
3. Add your Groq API key to `GROQ_API_KEY` in `.env`. Choose a Groq model that supports tool/function calling.
4. Run `npm run dev` and open [http://localhost:3000](http://localhost:3000).

Restart the server after changing `.env`. If `GROQ_MODEL` is empty or absent, the application falls back to `openai/gpt-oss-20b`. The UI shows the active model. Creating a wallet is optional unless you want to try the starter weather/x402 flow.

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
| `GROQ_MODEL` | Optional tool-capable Groq model; the example selects `openai/gpt-oss-120b`. |
| `WALLET_PRIVATE_KEY` | Optional test-wallet private key for the preserved wallet/x402 example. Leave blank for the core PetOps flow. |
| `PETOPS_DATA_FILE` | Optional server-side path for a separate local JSON data file, useful for isolated verification. |

## Agent Tools

| Area | Tools | What they do |
| :--- | :--- | :--- |
| Pet profiles | `get_pet_profile`, `save_pet_profile` | Read or save stable pet information. |
| Observations | `record_pet_observation`, `get_pet_observations` | Record a reported observation or read recent history. |
| Care tasks | `create_care_task`, `get_care_tasks` | Create a follow-up task or list pending tasks. |
| Care plans | `create_care_plan`, `get_care_plan`, `update_care_plan` | Propose and explicitly approve a plan, read saved plans, or update one on request. |
| Starter tools | `get_my_wallet`, `get_weather`, `roll_dice` | Keep the wallet/x402 and general tool examples accessible. |

PetOps tools live in `agent/pet-tools.ts`; the original examples remain in `agent/tools.ts`. `agent/tool-registry.ts` combines them for the agent and UI.

## Demo Flow

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

To verify the flow without changing your normal data file, set `PETOPS_DATA_FILE` to a new, empty path before starting the server. After `npm run build`, run `npm run start -- -p 3113`; in another terminal with the same data path, run `node scripts/verify-week1-demo.mjs`. The script never resets or deletes data, so use a fresh path for each run.

## Security & Safety

`.gitignore` excludes `.env` variants, `.agent-wallet.json`, `.petops-data.json`, and their local backups. `.env.example` contains no credentials. Never place an API key or a real private key in source files, commits, issues, or pull requests. Use only a test wallet for the optional x402 example; its signed demo payments do not move real funds on-chain.

PetOps does not provide a definitive veterinary diagnosis or prescription. For high-severity or recurring observations, it can recommend veterinary evaluation. A proposed long-term care plan cannot be activated without explicit user approval.

## What I Learned in Week 1

- Tool schemas and agent instructions must agree, especially around optional values, IDs, and dates with time-zone offsets.
- A successful tool result should determine whether the agent says a record was saved. Duplicate checks and explicit approval protect persistent care data.
- Retrying only a failed model request avoids rerunning a tool that has already changed data. Rate-limit guidance should be specific only when the error details support it.
- Local persistence is enough to validate the care workflow, while production use calls for stronger storage and access controls.

## Current Limitations

- The local JSON store is designed for one local user. There is no account system, multi-user isolation, or hosted database yet.
- A `custom` plan can describe daily, weekly, and monthly activities, but it has one `nextDueAt` value and does not automatically schedule a series of recurring tasks.
- PetOps supports care tracking and follow-ups, not clinical decision-making. A veterinarian should guide medical decisions.
- Wallet and x402 tools are retained from the starter kit but are not part of the required Week 1 pet care flow.
