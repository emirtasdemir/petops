"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  HeartPulse,
  ExternalLink,
  CalendarDays,
  PawPrint,
  RefreshCw,
  RotateCcw,
  SendHorizontal,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { detectResponseLanguage } from "@/agent/response-language";
import type { ActionSuggestion } from "@/agent/action-suggestions";
import type { TransferReview } from "@/agent/transfer-flow";

type Step = { tool: string; args: unknown; result: { payment?: { amount: string }; [key: string]: unknown } | null; error?: boolean };
type Message = { role: "user" | "agent"; text: string; steps?: Step[]; suggestions?: ActionSuggestion[]; transferProposal?: TransferReview; error?: boolean };
type Status = { hasApiKey: boolean; model: string; tools: { name: string; description: string }[] };
type WalletInfo = { address: string | null; balance?: string; source?: "environment" | "local" | null };

const EXAMPLES = [
  { title: "Create a pet profile", icon: PawPrint, prompt: "I have a 3-year-old cat named Luna who weighs 4.8 kg. Save her profile." },
  { title: "Record an observation", icon: HeartPulse, prompt: "Luna ate less food than usual today." },
  { title: "Prepare a care plan", icon: CalendarDays, prompt: "Create a daily feeding, weekly weight check, and monthly general care plan for Luna." },
];

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadWallet = () => fetch("/api/wallet").then((r) => r.json()).then(setWallet);

  useEffect(() => {
    fetch("/api/agent").then((r) => r.json()).then(setStatus);
    loadWallet();
  }, []);

  useEffect(() => {
    if (messages.length === 0 && !thinking) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  async function createWallet() {
    setCreating(true);
    await fetch("/api/wallet", { method: "POST" });
    await loadWallet();
    setCreating(false);
  }

  async function send(text: string) {
    if (!text.trim() || thinking) return;
    const history: Message[] = [...messages, { role: "user", text }];
    setMessages(history);
    setInput("");
    setThinking(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.filter((m) => !m.error).map(({ role, text, suggestions, transferProposal }) => ({ role, text, suggestions, transferProposal })),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await res.json();
      setMessages((m) => [...m, data.error ? { role: "agent", text: data.error, error: true } : { role: "agent", text: data.answer, steps: data.steps, suggestions: data.suggestions, transferProposal: data.transferProposal }]);
      if (data.steps?.some((s: Step) => s.result?.payment)) loadWallet();
    } catch {
      setMessages((m) => [...m, { role: "agent", text: detectResponseLanguage(text) === "tr"
        ? "PetOps sunucusuna bağlanılamadı. Sunucunun çalıştığını kontrol edip tekrar deneyin."
        : "Could not reach the PetOps server. Check that it is running and try again.", error: true }]);
    }
    setThinking(false);
  }

  const ready = Boolean(status?.hasApiKey);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1480px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
      {/* Header */}
      <header className="relative overflow-hidden rounded-3xl border border-cyan/20 bg-card/85 px-5 py-5 shadow-[0_20px_70px_rgba(0,11,25,0.24)] sm:px-8 sm:py-7">
        <div aria-hidden className="pointer-events-none absolute -top-24 right-0 size-72 rounded-full bg-blue/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-cyan/25 bg-background/65 shadow-[0_8px_30px_rgba(26,189,205,0.1)]">
              <Image src="/petops-logo.png" alt="PetOps Logo" width={56} height={56} className="size-14 object-contain" priority />
            </div>
            <div>
              <h1 className="text-3xl leading-none font-bold tracking-tight text-foreground sm:text-4xl">PetOps</h1>
              <p className="mt-1 text-sm font-medium tracking-wide text-cyan">AI Pet Care Agent</p>
            </div>
          </div>
          {status && (
            <div className="max-w-full rounded-full border border-cyan/20 bg-background/45 px-3 py-1.5 text-xs text-muted-foreground">
              Active model <span className="ml-1 break-all font-mono text-blue-soft">{status.model}</span>
            </div>
          )}
        </div>
        <div className="relative mt-7 border-t border-cyan/15 pt-6">
          <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">Care, connected</p>
          <h2 className="mt-2 max-w-3xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            A clearer picture of <span className="text-cyan">everyday pet care.</span>
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Keep profiles, observations, supplies, and care plans together. PetOps helps you see what matters next.
          </p>
        </div>
      </header>

      <div className="grid min-w-0 flex-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Left: setup + tools */}
        <aside className="order-2 flex min-w-0 flex-col gap-6 lg:order-1">
          <Card className="border border-cyan/15 bg-card/90 shadow-[0_18px_45px_rgba(0,10,22,0.16)]">
            <CardHeader>
              <SectionTitle title="Getting started" />
            </CardHeader>
            <CardContent className="flex flex-col">
              <SetupStep number={1} title="Connect PetOps" done={ready}>
                {status && !ready && (
                  <p className="text-muted-foreground">
                    Paste it into <Code>.env</Code> as <Code>GROQ_API_KEY</Code>, then restart <Code>npm run dev</Code>.{" "}
                    <a className="text-primary underline underline-offset-4" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
                      Get a key
                    </a>
                  </p>
                )}
                {ready && <p className="text-muted-foreground">Your agent is ready to help.</p>}
              </SetupStep>

              <SetupStep number={2} title="Start a conversation" done={messages.some((m) => m.role === "agent" && !m.error)}>
                <p className="text-muted-foreground">Tell PetOps about your pet or pick a demo example.</p>
              </SetupStep>

              <SetupStep number={3} title="Optional demo wallet" done={Boolean(wallet?.address)} last>
                {wallet && !wallet.address && (
                  <div className="flex flex-col gap-3">
                    <p className="text-muted-foreground">The agent signs payments with this wallet to use paid APIs.</p>
                    <Button onClick={createWallet} disabled={creating} className="w-fit rounded-xl px-4">
                      <Wallet /> {creating ? "Creating..." : "Create wallet"}
                    </Button>
                  </div>
                )}
                {wallet?.address && <WalletDetails wallet={wallet} onRefresh={loadWallet} />}
              </SetupStep>
            </CardContent>
          </Card>

          <Card className="border border-cyan/15 bg-card/90 shadow-[0_18px_45px_rgba(0,10,22,0.16)]">
            <CardHeader>
              <SectionTitle title="What PetOps can do" />
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {status?.tools.map((t) => (
                <div key={t.name} className="rounded-xl border border-cyan/10 bg-background/35 p-3">
                  <p className="font-mono text-xs font-semibold text-cyan">
                    {t.name}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.description}</p>
                </div>
              ))}
              <p className="border-t border-cyan/15 pt-4 text-xs text-muted-foreground">
                Pet care tools come first. Wallet and demo tools remain optional.
              </p>
            </CardContent>
          </Card>
        </aside>

        {/* Right: chat */}
        <Card className="order-1 flex h-[min(840px,calc(100vh-2rem))] min-h-[560px] min-w-0 flex-col border border-cyan/20 bg-card/95 shadow-[0_22px_65px_rgba(0,10,22,0.25)] lg:order-2 lg:sticky lg:top-6">
          <CardHeader className="border-b border-cyan/15">
            <SectionTitle title="Care conversation" />
            <CardAction>
              <Button variant="ghost" size="sm" className="rounded-lg text-muted-foreground hover:text-cyan" onClick={() => setMessages([])} disabled={messages.length === 0 || thinking}>
                <RotateCcw /> Clear
              </Button>
            </CardAction>
          </CardHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 px-4 py-5 sm:px-6">
              {messages.length === 0 && (
                <div className="flex flex-col items-center gap-6 px-1 py-8 text-center sm:py-12">
                  <div className="flex size-32 items-center justify-center rounded-full border border-cyan/20 bg-blue/10 shadow-[0_0_55px_rgba(45,174,214,0.13)] sm:size-40">
                    <Image
                      src="/petops-logo.png"
                      alt="PetOps Logo"
                      width={140}
                      height={140}
                      className="h-auto w-28 max-w-full sm:w-[140px]"
                      priority
                    />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">TELL PETOPS ABOUT YOUR PET</p>
                    <p className="mx-auto mt-2 max-w-lg leading-relaxed text-muted-foreground">
                      Start with an example or describe your pet’s condition. Demo wallet is optional.
                    </p>
                  </div>
                  <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-3">
                    {EXAMPLES.map((example) => {
                      const Icon = example.icon;
                      return (
                        <Button key={example.title} variant="outline" onClick={() => send(example.prompt)} disabled={!ready}
                          className="group h-auto min-h-36 w-full flex-col items-start justify-start gap-3 whitespace-normal rounded-2xl border-cyan/20 bg-secondary/45 p-4 text-left shadow-sm hover:border-primary/50 hover:bg-accent/45 dark:bg-secondary/45 dark:hover:bg-accent/45">
                          <span className="flex size-9 items-center justify-center rounded-xl bg-blue/15 text-cyan group-hover:bg-primary/15">
                            <Icon className="size-5" />
                          </span>
                          <span className="text-sm font-semibold text-foreground">{example.title}</span>
                          <span className="text-xs leading-relaxed font-normal text-muted-foreground">{example.prompt}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="max-w-[88%] self-end rounded-2xl rounded-br-md bg-blue px-4 py-3 font-medium text-white shadow-[0_8px_22px_rgba(16,105,176,0.2)]">
                    {m.text}
                  </div>
                ) : (
                  <div key={i} className="flex max-w-[92%] gap-3 self-start">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-cyan/20 bg-primary/10">
                      <Bot className="size-4 text-cyan" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      {m.steps?.map((s, j) => <ToolCall key={j} step={s} />)}
                      {m.transferProposal && !messages.slice(i + 1).some((later) => later.role === "user") && (
                        <div className="flex flex-col gap-3 rounded-xl border border-cyan/30 bg-blue/10 p-4 text-sm">
                          <p className="font-semibold text-cyan">{m.transferProposal.responseLanguage === "tr" ? "Transfer incelemesi" : "Transfer review"} · {m.transferProposal.network}</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <p><span className="text-muted-foreground">Token</span><br />{m.transferProposal.token}</p>
                            <p><span className="text-muted-foreground">{m.transferProposal.responseLanguage === "tr" ? "Miktar" : "Amount"}</span><br />{m.transferProposal.amount}</p>
                            <p className="min-w-0 break-all"><span className="text-muted-foreground">{m.transferProposal.responseLanguage === "tr" ? "Gönderen" : "From"}</span><br /><code className="text-xs">{m.transferProposal.from}</code></p>
                            <p className="min-w-0 break-all"><span className="text-muted-foreground">{m.transferProposal.responseLanguage === "tr" ? "Alıcı" : "To"}</span><br /><code className="text-xs">{m.transferProposal.recipient}</code></p>
                            <p><span className="text-muted-foreground">{m.transferProposal.responseLanguage === "tr" ? "Ağ" : "Network"}</span><br />{m.transferProposal.network}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">{m.transferProposal.responseLanguage === "tr" ? "Henüz işlem gönderilmedi. Onaylamadan önce tüm bilgileri kontrol edin." : "No transaction has been sent. Verify every detail before confirming."}</p>
                          <Button className="w-fit rounded-lg px-4" onClick={() => send(`CONFIRM_TRANSFER ${m.transferProposal!.id}`)} disabled={thinking}>
                            {m.transferProposal.responseLanguage === "tr" ? "Transferi Onayla" : "Confirm Transfer"}
                          </Button>
                        </div>
                      )}
                      {m.steps?.map((s, j) => {
                        const approval = planApproval(s);
                        if (!approval || messages.slice(i + 1).some((later) => later.role === "user" && later.text === approval.command)) return null;
                        return (
                          <div key={`approval-${j}`} className="flex flex-col gap-2 rounded-xl border border-primary/35 bg-primary/5 p-4 text-sm">
                            <p className="font-semibold">Proposed care plan: {approval.title}</p>
                            <p className="text-muted-foreground">{approval.description}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {({ daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "Custom" } as Record<string, string>)[approval.frequency] ?? approval.frequency}
                              {" · "}{new Date(approval.nextDueAt).toLocaleString()}
                            </p>
                            <Button className="w-fit rounded-lg px-4" onClick={() => send(approval.command)} disabled={thinking}>Approve plan</Button>
                          </div>
                        );
                      })}
                      <div className={cn("rounded-2xl rounded-tl-md border px-4 py-3 leading-relaxed whitespace-pre-wrap", m.error ? "flex gap-2 border-destructive/25 bg-destructive/10 text-destructive" : "border-cyan/10 bg-secondary/65")}>
                        {m.error && <CircleAlert className="mt-0.5 size-4 shrink-0" />}
                        {m.text}
                      </div>
                    </div>
                  </div>
                )
              )}

              {thinking && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="size-2 animate-pulse rounded-full bg-primary" /> PetOps is thinking
                </p>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <CardFooter className="border-t border-cyan/15 bg-background/25 pt-4">
            <form
              className="flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <div className={cn("flex min-w-0 flex-1 items-center rounded-xl border border-input bg-background/70 focus-within:border-cyan focus-within:ring-2 focus-within:ring-cyan/15", !ready && "opacity-50")}>
                <PawPrint className="ml-3 size-4 shrink-0 text-cyan" />
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={ready ? "Share a care update or ask PetOps..." : "Add your Groq API key to start"}
                  disabled={!ready}
                  className="h-11 border-0 bg-transparent focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 dark:bg-transparent dark:disabled:bg-transparent"
                />
              </div>
              <Button type="submit" className="h-11 rounded-xl px-4 shadow-[0_6px_20px_rgba(41,203,189,0.2)] sm:px-5" disabled={!ready || thinking || !input.trim()} aria-label="Send">
                <SendHorizontal /> <span className="hidden sm:inline">Send</span>
              </Button>
            </form>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <p className="flex items-center gap-2.5 text-sm font-semibold tracking-wide text-foreground">
      <span className="size-2 rounded-full bg-primary shadow-[0_0_12px_rgba(41,203,189,0.55)]" />
      {title}
    </p>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>;
}

function SetupStep(props: { number: number; title: string; done: boolean; last?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
            props.done ? "border-primary bg-primary text-primary-foreground" : "border-cyan/35 bg-blue/10 text-cyan"
          )}
        >
          {props.done ? <Check className="size-3.5" strokeWidth={3} /> : props.number}
        </span>
        {!props.last && <span className={cn("w-px flex-1", props.done ? "bg-primary/50" : "bg-border")} />}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-2", !props.last && "pb-6")}>
        <p className="font-semibold tracking-tight">{props.title}</p>
        {props.children}
      </div>
    </div>
  );
}

function WalletDetails({ wallet, onRefresh }: { wallet: WalletInfo; onRefresh: () => void }) {
  const [copied, setCopied] = useState(false);
  const address = wallet.address!;

  function copy() {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-cyan/15 bg-background/55 p-3">
      <div className="flex items-center justify-between gap-2">
        <code className="truncate font-mono text-xs text-cyan">{address}</code>
        <Button variant="ghost" size="icon-xs" onClick={copy} aria-label="Copy address">
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Balance <span className="text-foreground">{wallet.balance}</span>
        </span>
        <Button variant="ghost" size="icon-xs" onClick={onRefresh} aria-label="Refresh balance">
          <RefreshCw />
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-cyan/15 pt-3 text-xs">
        <a className="inline-flex items-center gap-1 hover:text-primary" href={`https://sepolia.basescan.org/address/${address}`} target="_blank" rel="noreferrer">
          Explorer <ExternalLink className="size-3" />
        </a>
        <a className="inline-flex items-center gap-1 hover:text-primary" href="https://docs.base.org/base-chain/tools/network-faucets" target="_blank" rel="noreferrer">
          Get test ETH <ExternalLink className="size-3" />
        </a>
      </div>
      <p className="text-xs text-muted-foreground">Base Sepolia testnet. {wallet.source === "environment" ? "Wallet configured for this deployment." : "Wallet saved locally in .agent-wallet.json."}</p>
    </div>
  );
}

function ToolCall({ step }: { step: Step }) {
  const payment = step.result?.payment;
  return (
    <Collapsible className="overflow-hidden rounded-xl border border-cyan/20 bg-background/40 text-xs">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-blue/10">
        <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
        <span className="text-muted-foreground">Action</span>
        <span className="min-w-0 truncate font-mono text-cyan">{step.tool}</span>
        {payment && <Badge className="ml-auto bg-blue font-mono text-white">Paid {payment.amount}</Badge>}
        {step.error && <Badge variant="destructive" className="ml-auto font-mono">Failed</Badge>}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 border-t border-cyan/15 px-3 py-2">
        <Json label="Input" value={step.args} />
        <Json label="Output" value={step.result} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function planApproval(step: Step): { command: string; title: string; description: string; frequency: string; nextDueAt: string } | null {
  if (step.tool !== "create_care_plan" || !step.result || step.result.approvalRequired !== true) return null;
  const proposal = step.result.proposal;
  const command = step.result.approvalCommand;
  if (!proposal || typeof proposal !== "object" || typeof command !== "string") return null;
  const value = proposal as Record<string, unknown>;
  if (typeof value.title !== "string" || typeof value.description !== "string" ||
      typeof value.frequency !== "string" || typeof value.nextDueAt !== "string") return null;
  return { command, title: value.title, description: value.description, frequency: value.frequency, nextDueAt: value.nextDueAt };
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-muted-foreground">{label}</p>
      <pre className="overflow-x-auto rounded-lg bg-background/75 p-2 font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
