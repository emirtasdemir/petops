import { MODEL, runAgent } from "@/agent/agent";
import { availableTools } from "@/agent/tool-registry";
import { groqErrorInfo, rateLimitUserMessage } from "@/agent/groq-retry";

// GET /api/agent -> setup status + the list of tools (shown on the page)
export async function GET() {
  return Response.json({
    hasApiKey: Boolean(process.env.GROQ_API_KEY),
    model: MODEL,
    tools: availableTools.map((t) => ({ name: t.name, description: t.description })),
  });
}

// POST /api/agent { messages } -> the agent's answer + the tools it used
export async function POST(req: Request) {
  if (!process.env.GROQ_API_KEY) {
    return Response.json({ error: "PetOps hazır değil. .env dosyasına GROQ_API_KEY ekleyip sunucuyu yeniden başlatın." }, { status: 500 });
  }

  try {
    const { messages, timeZone } = await req.json();
    if (!Array.isArray(messages) || !messages.length ||
        messages.some((message) => !message || (message.role !== "user" && message.role !== "agent") || typeof message.text !== "string") ||
        messages.at(-1).role !== "user") {
      return Response.json({ error: "Mesaj okunamadı. Lütfen isteğinizi yeniden gönderin." }, { status: 400 });
    }
    const result = await runAgent(messages, { baseUrl: new URL(req.url).origin, timeZone });
    return Response.json(result);
  } catch (err) {
    const { status, rateLimitKind } = groqErrorInfo(err);
    if (status === 429) return Response.json({ error: rateLimitUserMessage(rateLimitKind) }, { status: 429 });
    if (status !== null && status >= 500 && status < 600) {
      return Response.json({ error: "Yapay zekâ servisine şu anda ulaşılamıyor. Kısa süre sonra tekrar deneyin." }, { status: 503 });
    }
    return Response.json({ error: "İstek tamamlanamadı. Lütfen tekrar deneyin." }, { status: 500 });
  }
}
