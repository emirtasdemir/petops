import { MODEL, runAgent } from "@/agent/agent";
import { availableTools } from "@/agent/tool-registry";
import { groqErrorInfo, rateLimitUserMessage } from "@/agent/groq-retry";
import { detectResponseLanguage, type ResponseLanguage } from "@/agent/response-language";

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
  let responseLanguage: ResponseLanguage = "en";
  try {
    const { messages, timeZone } = await req.json();
    if (Array.isArray(messages)) {
      const lastUserMessage = [...messages].reverse().find((message) => message?.role === "user" && typeof message.text === "string");
      if (lastUserMessage) responseLanguage = detectResponseLanguage(lastUserMessage.text);
    }
    if (!Array.isArray(messages) || !messages.length ||
        messages.some((message) => !message || (message.role !== "user" && message.role !== "agent") || typeof message.text !== "string") ||
        messages.at(-1).role !== "user") {
      return Response.json({ error: responseLanguage === "tr"
        ? "Mesaj okunamadı. Lütfen isteğinizi yeniden gönderin."
        : "Your message could not be read. Please send it again." }, { status: 400 });
    }
    if (!process.env.GROQ_API_KEY) return Response.json({ error: responseLanguage === "tr"
      ? "PetOps hazır değil. .env dosyasına GROQ_API_KEY ekleyip sunucuyu yeniden başlatın."
      : "PetOps is not ready. Add GROQ_API_KEY to .env and restart the server." }, { status: 500 });
    const result = await runAgent(messages, { baseUrl: new URL(req.url).origin, timeZone });
    return Response.json(result);
  } catch (err) {
    const { status, rateLimitKind } = groqErrorInfo(err);
    if (status === 429) return Response.json({ error: rateLimitUserMessage(rateLimitKind, responseLanguage) }, { status: 429 });
    if (status !== null && status >= 500 && status < 600) {
      return Response.json({ error: responseLanguage === "tr"
        ? "Yapay zekâ servisine şu anda ulaşılamıyor. Kısa süre sonra tekrar deneyin."
        : "The AI service is unavailable right now. Please try again shortly." }, { status: 503 });
    }
    return Response.json({ error: responseLanguage === "tr"
      ? "İstek tamamlanamadı. Lütfen tekrar deneyin."
      : "The request could not be completed. Please try again." }, { status: 500 });
  }
}
