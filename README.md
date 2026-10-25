# PetOps

## Product Logo

<p align="center">
  <img src="public/petops-logo.png" alt="PetOps Logo" width="500">
</p>

## Product Name

**PetOps** — AI Pet Care Agent

## Project Description

PetOps is an AI pet care agent that helps users manage their pets' ongoing care through persistent profiles, observations, care tasks, and user-approved care plans. It turns everyday updates into structured records and practical follow-ups while keeping users in control of long-term plans. Week 2 adds supply tracking, proactive suggestions, and a user-confirmed crypto transfer capability on Base Sepolia Testnet. Week 3 adds a real x402 payment flow for a Premium Pet Care Report.

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
| viem | `^2.56.9` | Base Sepolia wallet signing, transfers, balance checks, and receipt verification |
| `@x402/core`, `@x402/evm`, `@x402/next` | `^2.28.0` each | x402 v2 client, EVM payment scheme, and protected Next.js API route |

Pet data is stored in a local JSON file. The interface also uses components built with `@base-ui/react` (`^1.8.0`).

## Supported AI Models

PetOps uses the Groq SDK. Set `GROQ_MODEL` in `.env` to choose the model. The following Groq provider model IDs have been used and tested for this project:

- `openai/gpt-oss-20b` — application fallback when `GROQ_MODEL` is unset or empty.
- `openai/gpt-oss-120b` — model selected in `.env.example`.

Other model IDs are not claimed as verified. The active model appears in the UI.

## Agent Tools

### PetOps core tools

PetOps has **13 care and supply tools**: the nine care tools below and four supply tools.

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
| `save_pet_supply` | Save stock and optional daily usage for a pet. |
| `get_pet_supplies` | List a pet's recorded supplies. |
| `update_pet_supply` | Update stock, usage, or a low-stock threshold. |
| `check_pet_supply_status` | Report low stock and estimate remaining days when usage data exists. |

### Crypto transfer tools

| Tool | Purpose |
| :--- | :--- |
| `prepare_token_transfer` | Validate a requested transfer and return a review proposal; **no transaction is sent**. |
| `execute_token_transfer` | Submit the previously reviewed proposal only after explicit confirmation. |

### x402 premium report tools and resource

| Tool or resource | Purpose |
| :--- | :--- |
| `prepare_x402_payment` | Request the premium resource, parse its HTTP 402 payment requirement, and prepare a review. **No payment is made.** |
| `execute_x402_payment` | Execute one explicitly approved x402 payment, then request the protected resource again and return the report and settlement details. |
| `/api/premium/pet-report` | Protected Premium Pet Care Report API resource; it returns HTTP 402 without payment and releases the report after successful settlement. It is an API resource, not a separate registered agent tool. |

### Starter/demo tools

| Tool | Purpose |
| :--- | :--- |
| `get_my_wallet` | Read the agent wallet's public address and Base Sepolia balance. |
| `get_weather` | Use the starter's signed-payment weather example; it is separate from the Week 3 on-chain x402 flow. |
| `roll_dice` | Run the starter's simple tool example. |

The registry in `agent/tool-registry.ts` places PetOps tools before starter/demo tools. Crypto transfer and x402 payment execution are controlled by separate server-side confirmation flows, rather than ordinary model tool selection.

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
- **Pet supply tracking:** Record food and other supplies, estimate remaining days when daily usage is known, and detect low stock against a saved threshold.
- **Proactive suggestions:** Connect care context to useful next steps without creating tasks, plans, or purchases without the required user request or approval.
- **User-confirmed actions:** Create suggested follow-up tasks only after confirmation; transfer proposals also require explicit confirmation.
- **Deterministic English/Turkish responses:** Fix the response language for each request and its full tool loop.
- **Base Sepolia testnet transfers:** Parse a supported natural-language request, show a transaction review, then submit it only after explicit confirmation. A returned transaction hash and explorer link identify the submitted transaction.
- **Single-use transfer proposals:** Duplicate confirmation does not submit a second transaction, and failed blockchain submissions are not blindly retried.
- **PetOps interface:** Custom logo, colors, chat, tool cards, and wallet panel replace the starter look.
- **x402 premium report:** A user can review the price, asset, network, paying wallet, and recipient before unlocking a protected care report with an approved Base Sepolia testnet payment.

## Demo Video

Demo video: [https://www.youtube.com/watch?v=4MMZUcMhcMI](https://www.youtube.com/watch?v=4MMZUcMhcMI)

Week 2 demo video: [https://youtu.be/R8Iq7xtynqE](https://youtu.be/R8Iq7xtynqE)

## Demo Links

Week 1 (PetOps.v1): [https://www.youtube.com/watch?v=4MMZUcMhcMI](https://www.youtube.com/watch?v=4MMZUcMhcMI)

Week 2 (PetOps.v2): [https://youtu.be/R8Iq7xtynqE](https://youtu.be/R8Iq7xtynqE)

Week 3 (PetOps.v3): Coming soon

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

### Base Sepolia transfer flow

With an agent test wallet configured, a user can write `Send 0.001 ETH to 0x...` (replacing `0x...` with a valid EVM recipient address). PetOps extracts the token, amount, sender wallet, recipient, and **Base Sepolia Testnet** network into a review card. `prepare_token_transfer` does not broadcast a transaction. The user must inspect the card and explicitly select **Confirm Transfer** or reply `Yes, send it.` before `execute_token_transfer` submits the signed transaction. On submission, PetOps shows its transaction hash and BaseScan explorer link. A proposal is single-use, and a failed submission is not automatically retried.

For isolated verification, set `PETOPS_DATA_FILE` to a new, empty path before starting the server. After `npm run build`, run `npm run start -- -p 3113`; in another terminal with the same data path, run `node scripts/verify-week1-demo.mjs`. The script never resets or deletes data, so use a fresh path for each run.

## Week 2 Highlights

- Pet supply tracking
- Remaining-days estimation
- Low-stock detection
- Proactive next-action suggestions
- User-confirmed task execution
- Deterministic response language
- Improved retry and tool error handling
- Natural-language, user-confirmed Base Sepolia transfer flow
- Wallet persistence through `WALLET_PRIVATE_KEY` in deployed environments
- Customized PetOps UI

## Week 2 Evaluation

Run `node scripts/verify-week2-agent.mjs` to evaluate five independent English prompts against the agent's real Groq tool-calling loop. The script starts an isolated local server and uses a temporary JSON data file; it does not change `.petops-data.json`. Pass `--model=openai/gpt-oss-20b` to select that tested model for one evaluation run without changing `.env`.

1. **Supply Save:** Save Luna's 4 kg food stock and 120 g/day usage with `save_pet_supply`.
2. **Supply Status:** Check the stock with `check_pet_supply_status` and report about 33 days remaining.
3. **Low Stock:** Detect 0.4 kg below a 0.5 kg threshold without claiming an order was placed.
4. **No Automatic Action:** Check low stock without creating a restock task or making a purchase.
5. **Explicit Restock Task:** Check low stock, then create a task for tomorrow only after the user requests it.

Latest run (October 16, 2026, `openai/gpt-oss-20b`): **Week 2 Agent Evaluation: 5/5 passed** with English responses required for every scenario; approximately 22 Groq model calls and no HTTP 429. A separate isolated language regression run passed 30/30 English and 3/3 Turkish responses. The response language is selected from the latest user message in code and pinned for every model turn.

At the Week 2 handoff, the local suite passed **49/49 tests**, including transfer preparation, explicit confirmation, duplicate-confirmation protection, wallet persistence across fresh processes, and signing with an isolated test key. A live **0.001 ETH transfer** from the PetOps test wallet to the requested recipient successfully completed on **Base Sepolia Testnet**; the on-chain receipt reports success in block 49209911. [View the transaction and hash on BaseScan](https://sepolia.basescan.org/tx/0x3241abd72d75c8c73e52e7f0892a5b7b5e7633a3ce745575ad590ff7c82b7292).

## Week 3: Verified x402 Premium Pet Care Report

PetOps now supports a real **x402 v2** payment for the **Premium Pet Care Report** at `/api/premium/pet-report`. The route uses the `exact` payment scheme on **Base Sepolia Testnet** (`eip155:84532`), with [official Base Sepolia test USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses) (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`) at **0.001 USDC** per report. The payer is the PetOps agent wallet; the configured `X402_PAY_TO_ADDRESS` is the recipient.

1. A user asks for a premium report, for example: `Generate a premium care report for Luna.`
2. `prepare_x402_payment` requests the protected API, receives HTTP 402, parses its payment requirement, and shows a review of the resource, price, asset, network, payer, and recipient. It **does not pay**.
3. The user explicitly confirms the review. `execute_x402_payment` uses the agent wallet and x402 SDK to submit the approved payment. The proposal is single-use; duplicate confirmation cannot create another payment, and a failed payment is not blindly retried.
4. After successful settlement, PetOps requests the protected resource again. The report is returned only after payment succeeds, together with a transaction hash and explorer link. The report offers general care guidance, not a veterinary diagnosis or prescription.

**Live Base Sepolia verification:** One 0.001 test USDC x402 payment settled successfully. The payer's USDC balance changed from **20 to 19.999**, and the recipient's from **0 to 0.001**. The Premium Pet Care Report for Luna was unlocked. The on-chain receipt was `success`, and its USDC transfer event matched the payer, recipient, and amount. Exactly one paid HTTP request was sent; there was no duplicate payment or retry loop.

- Transaction hash: `0x4a34cb4e787a5e5e31f626627e11a78d2f9041c76b0cf29eb9de44b09c4b8f53`
- Explorer: [View the verified transaction on Base Sepolia Blockscout](https://base-sepolia.blockscout.com/tx/0x4a34cb4e787a5e5e31f626627e11a78d2f9041c76b0cf29eb9de44b09c4b8f53)
- Local regression suite after the Week 3 changes: **61/61 tests passed** (`npm test`).

## Future Scope

- **Next infrastructure steps:** Move pet and payment-proposal data to durable hosted storage, add multi-user support and authentication, and improve agent memory.
- **Further agent work:** Explore product recommendation and search tools, richer care reports, and additional user-approved paid resources.
- **Payment operations:** Add user-specific wallet controls and stronger receipt monitoring before considering broader deployment.

These are planned directions, not current capabilities.

## Social Media

X/Twitter: [https://x.com/PetOpsAI](https://x.com/PetOpsAI)

## Installation

1. Install Node.js 20 or newer, then run `npm install`.
2. Copy `.env.example` to `.env` (`cp .env.example .env`, or `Copy-Item .env.example .env` in PowerShell).
3. Add your Groq API key to `GROQ_API_KEY` in `.env`. Select one of the project-tested models with `GROQ_MODEL`.
4. Run `npm run dev` and open [http://localhost:3000](http://localhost:3000).

Restart the server after changing `.env`. A wallet is optional for the PetOps care flow but required for a confirmed Base Sepolia transfer or x402 report payment. Set `X402_PAY_TO_ADDRESS` to a separate Base Sepolia test wallet that should receive premium-report payments. The paying wallet needs Base Sepolia test USDC for the report; direct on-chain transfers also need test ETH for gas. For a deployed wallet that keeps the same address across Render restarts and redeploys, configure `WALLET_PRIVATE_KEY` as an environment secret on Render; use the same valid key each time.

## Environment Variables

The committed `.env.example` contains placeholders only:

```dotenv
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b
WALLET_PRIVATE_KEY=
X402_PAY_TO_ADDRESS=
```

| Variable | Purpose |
| :--- | :--- |
| `GROQ_API_KEY` | Required Groq API key; put the real value only in your ignored `.env` file. |
| `GROQ_MODEL` | Model ID; `.env.example` selects `openai/gpt-oss-120b`, and an empty or missing value falls back to `openai/gpt-oss-20b`. |
| `WALLET_PRIVATE_KEY` | Base Sepolia test-wallet key. When set, it takes priority over `.agent-wallet.json` and keeps the same public address across restarts and redeploys. Leave blank to use the local Create Wallet flow. Store the real value only as a deployment secret or in ignored local `.env`. |
| `X402_PAY_TO_ADDRESS` | Public Base Sepolia recipient address for premium-report payments. The premium endpoint stays unavailable until a valid address is configured. |
| `PETOPS_DATA_FILE` | Optional server-side path for a separate local JSON data file, useful for isolated verification. |
| `PETOPS_TRANSFER_FILE` | Optional server-side path for isolated transfer proposal tests; by default proposals use ignored `.petops-transfers.json`. |
| `PETOPS_X402_FILE` | Optional server-side path for isolated x402 payment-proposal tests; by default proposals use ignored `.petops-x402.json`. |

## Security & Safety

`.gitignore` excludes `.env` variants, `.agent-wallet.json`, `.petops-data.json`, `.petops-transfers.json`, `.petops-x402.json`, and their local backups. `.env.example` contains no credentials. Keep API keys and private keys out of source files and commits. The private key is never returned in wallet, transfer, or x402 API responses, shown in the UI, or logged by the application. In production, store it only as the `WALLET_PRIVATE_KEY` environment secret. Local development can use the ignored `.agent-wallet.json` file created by **Create Wallet**; that ephemeral file is not a reliable source of wallet persistence across Render redeploys.

The agent wallet, transfers, and x402 premium-report payment use **Base Sepolia Testnet** only. They are not designed for mainnet funds. A natural-language request only prepares a review; x402 payment and token transfers require explicit confirmation before an on-chain submission. The public demo has no authentication, so anyone with access to it can request and confirm testnet payments or transfers from its shared test wallet. Keep the wallet limited to testnet assets.

The wallet and starter weather example are preserved from the starter kit; the verified x402 premium-report flow was added in Week 3. x402 is optional for ordinary pet care. PetOps does not provide definitive veterinary diagnoses or prescriptions; for high-severity or recurring observations, it can recommend veterinary evaluation. A proposed long-term care plan cannot be activated without explicit user approval.

## Current Limitations

- The local JSON store is designed for one local user. There is no account system, multi-user isolation, or hosted database yet.
- A `custom` plan can describe daily, weekly, and monthly activities, but it has one `nextDueAt` value and does not automatically schedule a series of recurring tasks.
- PetOps supports care tracking and follow-ups, not clinical decision-making. A veterinarian should guide medical decisions.
- The wallet and the starter weather payment example are not part of the required Week 1 pet care flow. The real x402 premium-report flow is a separate Week 3 capability.
- The Week 2 normal transfer tool recognizes a narrow set of English and Turkish commands. Its ERC-20/USDC option requires a separately configured trusted contract address and matching on-chain metadata; this limitation does not apply to the Week 3 x402 report payment in official Base Sepolia test USDC.
- Transfer proposals are kept in a local JSON file. A redeploy can discard a pending review; the user must prepare and confirm a new one. Submission returns a transaction hash, not a guarantee of final chain confirmation.
- x402 payment proposals also use local JSON storage. A restart or redeploy can discard a pending review; a user must then request a fresh review. The live Week 3 payment was independently verified on-chain, but future transactions still require checking their own receipts.
- The public demo has no user authentication or per-user wallet isolation. Do not fund its wallet with mainnet assets.

## What I Learned in Week 1

- Tool schemas and agent instructions must agree, especially around optional values, IDs, and dates with time-zone offsets.
- A successful tool result should determine whether the agent says a record was saved. Duplicate checks and explicit approval protect persistent care data.
- Retrying only a failed model request avoids rerunning a tool that has already changed data. Rate-limit guidance should be specific only when the error details support it.
- Local persistence validates the care workflow while showing where stronger storage and access controls are needed.
