"use client";

// OWNER: P3. Guided Try it: pick a cart, watch AgentPass decide.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FadeIn } from "@/components/fade-in";
import { gbp } from "@/components/format";
import { buildChecks, CHECK_LABELS, type CheckStatus, type GateCheck } from "@/components/gate-checks";
import { MandatePanel } from "@/components/mandate-panel";
import { SCENARIOS } from "@/components/scenarios";
import { useMotionAllowed } from "@/components/use-motion-allowed";
import { VERDICT, VerdictBadge } from "@/components/verdict";
import type { AgentResponse, ApproveResponse, Cart, Decision, GateResponse, Mandate, OrderResponse } from "@/lib/types";

const EASE = [0.22, 1, 0.36, 1] as const;
const TICK_MS = 260;

type Stage = "pick" | "agent" | "checks" | "result";
type ChatMessage = { id: string; role: "user" | "agent" | "note"; text: string };

async function post<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("The request did not reach the server.");
  }
  const data = (await response.json().catch(() => null)) as (T & { error?: string; reply?: string }) | null;
  if (!response.ok && !(data && typeof data === "object" && "reply" in data)) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  if (!data) throw new Error("Empty response from the server.");
  return data;
}

export function Checkout({ mandate, spent }: { mandate: Mandate; spent: number }) {
  const params = useSearchParams();
  const allowed = useMotionAllowed();
  const prompt = params.get("prompt");
  const [message, setMessage] = useState(prompt || "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [gate, setGate] = useState<GateResponse | null>(null);
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("pick");
  const [tick, setTick] = useState({ id: "", n: 0 });
  const [customOpen, setCustomOpen] = useState(Boolean(prompt));
  const resultRef = useRef<HTMLElement>(null);
  const [seenPrompt, setSeenPrompt] = useState(prompt);
  if (prompt !== seenPrompt) {
    setSeenPrompt(prompt);
    if (prompt) {
      setMessage(prompt);
      setCustomOpen(true);
    }
  }

  const checks = useMemo(() => (gate ? buildChecks(gate.decision, gate.reasons) : null), [gate]);
  const count = checks?.length ?? 0;
  const revealed = gate && tick.id === gate.decisionId ? tick.n : 0;
  const shown = checks && !allowed ? count : revealed;
  const done = Boolean(checks && shown >= count);
  const live = stage !== "pick";

  useEffect(() => {
    if (!count || !allowed || !gate || stage !== "checks") return;
    let shownCount = 0;
    const id = gate.decisionId;
    const step = () => {
      shownCount += 1;
      setTick({ id, n: shownCount });
      if (shownCount >= count) {
        window.clearInterval(timer);
        setStage("result");
      }
    };
    const timer = window.setInterval(step, TICK_MS);
    const kick = window.setTimeout(step, 40);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(timer);
    };
  }, [gate, allowed, count, stage]);

  useEffect(() => {
    if (!allowed && gate && stage === "checks") setStage("result");
  }, [allowed, gate, stage]);

  useEffect(() => {
    if (!live || !window.matchMedia("(max-width: 1023px)").matches) return;
    resultRef.current?.scrollIntoView({ behavior: allowed ? "smooth" : "auto", block: "start" });
  }, [stage, live, allowed, gate?.decisionId]);

  function say(role: ChatMessage["role"], text: string) {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role, text }]);
  }

  async function place(nextCart: Cart, receipt: string) {
    const placed = await post<OrderResponse>("/api/order", { cart: nextCart, receipt });
    setOrder(placed);
    return placed;
  }

  async function run(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || answering) return;
    setMessage(trimmed);
    setBusy(true);
    setError(null);
    setCart(null);
    setGate(null);
    setOrder(null);
    setPendingToken(null);
    setNote(null);
    setTick({ id: "", n: 0 });
    setStage("agent");
    setMessages([{ id: crypto.randomUUID(), role: "user", text: trimmed }]);
    try {
      const agent = await post<AgentResponse>("/api/agent", { message: trimmed, mandateId: mandate.id });
      say("agent", agent.reply);
      if (!agent.cart) {
        setStage("result");
        return;
      }
      setCart(agent.cart);
      setStage("checks");
      const verdict = await post<GateResponse>("/api/gate", { cart: agent.cart, mandateId: mandate.id });
      setGate(verdict);
      if (verdict.approvalToken) setPendingToken(verdict.approvalToken);
      if (verdict.receipt) await place(agent.cart, verdict.receipt);
      if (!allowed) setStage("result");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setStage("result");
    } finally {
      setBusy(false);
    }
  }

  async function answer(approved: boolean) {
    if (!pendingToken || !cart || answering) return;
    setAnswering(true);
    setError(null);
    try {
      const result = await post<ApproveResponse>("/api/approve", { approvalToken: pendingToken, approved });
      setPendingToken(null);
      if (result.receipt) {
        const placed = await place(cart, result.receipt);
        const line = `Sara said yes. Order ${placed.orderName} is ready.`;
        setNote(line);
        say("note", line);
      } else {
        const line = "Sara said no. Nothing was sent to the shop.";
        setNote(line);
        say("note", line);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Approval failed.");
    } finally {
      setAnswering(false);
    }
  }

  function reset() {
    setStage("pick");
    setMessages([]);
    setCart(null);
    setGate(null);
    setOrder(null);
    setPendingToken(null);
    setNote(null);
    setError(null);
    setTick({ id: "", n: 0 });
    setMessage("");
  }

  return (
    <FadeIn className="space-y-5">
      <MandatePanel
        key={`${mandate.weeklyBudget}-${mandate.perOrderCap}-${mandate.askAbove}`}
        mandate={mandate}
        spent={spent}
        compact
      />

      <StageStrip stage={stage} allowed={allowed} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="glass rounded-3xl p-4 sm:p-5" aria-labelledby="pick-title">
          <h2 id="pick-title" className="text-2xl">
            {live ? "Your request" : "Pick a cart"}
          </h2>
          <p className="muted mt-1 text-sm">{live ? "Watch what happens on the right." : "Tap one. AgentPass will check it live."}</p>

          {!live && (
            <ul className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {SCENARIOS.map((scenario, index) => (
                <li key={scenario.prompt}>
                  <motion.button
                    type="button"
                    className="scenario-card"
                    disabled={busy || answering}
                    onClick={() => void run(scenario.prompt)}
                    initial={allowed ? { opacity: 0, y: 12 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: allowed ? 0.35 : 0, delay: allowed ? index * 0.06 : 0, ease: EASE }}
                    whileTap={allowed ? { scale: 0.98 } : undefined}
                  >
                    <VerdictBadge decision={scenario.expect} />
                    <span className="mt-3 block text-lg font-medium leading-snug">{scenario.title}</span>
                    <span className="muted mt-1 block text-sm leading-relaxed">{scenario.note}</span>
                    <span className="scenario-go mt-3">Try this →</span>
                  </motion.button>
                </li>
              ))}
            </ul>
          )}

          {live && (
            <div className="mt-4 space-y-2" aria-live="polite">
              <AnimatePresence initial={false}>
                {messages.map((entry) => (
                  <motion.div
                    key={entry.id}
                    className={
                      entry.role === "user"
                        ? "bubble bubble-user"
                        : entry.role === "agent"
                          ? "bubble bubble-agent glass"
                          : "muted px-1 text-sm"
                    }
                    initial={allowed ? { opacity: 0, y: 8 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: allowed ? 0.3 : 0, ease: EASE }}
                  >
                    <p>{entry.text}</p>
                  </motion.div>
                ))}
              </AnimatePresence>
              {stage === "agent" && <PulseLine text="Agent is choosing products…" allowed={allowed} />}
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm" role="alert">
              {error}
            </p>
          )}

          {!live && (
            <div className="mt-4">
              <button type="button" className="quiet-link text-sm" onClick={() => setCustomOpen((value) => !value)}>
                {customOpen ? "Hide custom request" : "Or type your own"}
              </button>
              {customOpen && (
                <form
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(message);
                  }}
                >
                  <label className="sr-only" htmlFor="order">
                    What should the agent buy?
                  </label>
                  <input
                    id="order"
                    className="field"
                    placeholder="e.g. Restock 3 denim jackets"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    disabled={busy || answering}
                    autoComplete="off"
                  />
                  <button type="submit" className="btn btn-accent shrink-0" disabled={busy || answering || !message.trim()}>
                    Send
                  </button>
                </form>
              )}
            </div>
          )}

          {live && (
            <button type="button" className="btn btn-ghost mt-4" disabled={busy || answering} onClick={reset}>
              Try another
            </button>
          )}
        </section>

        <section ref={resultRef} className="glass scroll-mt-40 rounded-3xl p-4 sm:p-5" aria-labelledby="live-title">
          <h2 id="live-title" className="text-2xl">
            What AgentPass does
          </h2>

          {!live && <IdlePreview allowed={allowed} />}

          {live && (
            <>
              {cart && (
                <motion.ul
                  className="mt-4 border-y border-[var(--line)] py-3 text-sm"
                  initial={allowed ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                >
                  {cart.items.map((item) => (
                    <li key={`${item.variantId}-${item.quantity}`} className="flex justify-between gap-3 py-1">
                      <span>
                        {item.quantity} × {item.title}
                      </span>
                      <span className="num">{gbp(item.unitPrice * item.quantity)}</span>
                    </li>
                  ))}
                  {gate && (
                    <li className="flex justify-between gap-3 pt-2 font-medium">
                      <span>Total</span>
                      <span className="num">{gbp(gate.checkedTotal)}</span>
                    </li>
                  )}
                </motion.ul>
              )}

              {(stage === "checks" || stage === "result") && (
                <ol className="mt-4 space-y-2.5" aria-label="AgentPass checks">
                  {(checks ?? CHECK_LABELS.map((label) => ({ ...label, status: "pass" as const, detail: [] as string[] }))).map(
                    (check, index) => {
                      const visual: CheckStatus = checks && index < shown ? check.status : "wait";
                      return <CheckRow key={check.id} check={check} visual={visual} allowed={allowed} />;
                    },
                  )}
                </ol>
              )}

              {stage === "agent" && !cart && <PulseLine text="Waiting for the cart…" allowed={allowed} className="mt-6" />}

              {gate && (done || stage === "result") && (
                <motion.div
                  className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--glass-strong)] p-4"
                  initial={allowed ? { opacity: 0, y: 10 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: allowed ? 0.4 : 0, ease: EASE }}
                  aria-live="polite"
                >
                  <VerdictBadge decision={gate.decision} />
                  <p className="mt-3 text-2xl font-medium">{VERDICT[gate.decision].label}</p>
                  <p className="muted mt-2 text-sm leading-relaxed">{plainReason(gate.decision, gate.reasons)}</p>
                  {gate.decision === "APPROVE" && !order && !error && busy && (
                    <PulseLine text="Sending to the shop…" allowed={allowed} className="mt-3" />
                  )}
                  {order && (
                    <p className="mt-3 text-sm">
                      Order {order.orderName} is ready.{" "}
                      <Link className="quiet-link" href={`/receipt/${gate.decisionId}`}>
                        Open the slip
                      </Link>
                    </p>
                  )}
                  {note && <p className="mt-3 text-sm">{note}</p>}
                  {pendingToken && (
                    <div className="mt-4 border-t border-[var(--line)] pt-4">
                      <p className="font-medium">Sara needs to say yes</p>
                      <p className="muted mt-1 text-sm">Above the ask-first line. Nothing is ordered until she answers.</p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <button type="button" className="btn btn-accent flex-1" disabled={answering} onClick={() => void answer(true)}>
                          Yes, place the order
                        </button>
                        <button type="button" className="btn btn-ghost flex-1" disabled={answering} onClick={() => void answer(false)}>
                          No
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </>
          )}
        </section>
      </div>
    </FadeIn>
  );
}

function plainReason(decision: Decision, reasons: string[]) {
  if (decision === "APPROVE") return "Everything fitted Sara’s rules.";
  return reasons.join(". ");
}

function StageStrip({ stage, allowed }: { stage: Stage; allowed: boolean }) {
  const steps: { id: Stage; label: string }[] = [
    { id: "pick", label: "1 · Pick" },
    { id: "agent", label: "2 · Agent" },
    { id: "checks", label: "3 · Checks" },
    { id: "result", label: "4 · Result" },
  ];
  const order: Stage[] = ["pick", "agent", "checks", "result"];
  const active = order.indexOf(stage);

  return (
    <ol className="flex flex-wrap gap-2" aria-label="Demo steps">
      {steps.map((step, index) => {
        const on = index === active;
        const done = index < active;
        return (
          <li key={step.id}>
            <motion.span
              className="stage-pill"
              data-on={on}
              data-done={done}
              animate={allowed && on ? { scale: [1, 1.03, 1] } : { scale: 1 }}
              transition={allowed && on ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }}
            >
              {step.label}
            </motion.span>
          </li>
        );
      })}
    </ol>
  );
}

function IdlePreview({ allowed }: { allowed: boolean }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-[var(--line)] p-5 text-center">
      <motion.div
        className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)" }}
        animate={allowed ? { y: [0, -4, 0] } : { y: 0 }}
        transition={allowed ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }}
        aria-hidden
      >
        <svg width="22" height="22" viewBox="0 0 18 18">
          <path d="M4.5 3.5v11M13.5 3.5v11M4 6.5h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </motion.div>
      <p className="font-medium">Nothing to check yet</p>
      <p className="muted mt-1 text-sm">Pick a cart on the left and the six checks will tick here.</p>
    </div>
  );
}

function PulseLine({ text, allowed, className = "" }: { text: string; allowed: boolean; className?: string }) {
  return (
    <p className={`muted inline-flex items-center gap-2 text-sm ${className}`}>
      <motion.span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: "var(--accent)" }}
        animate={allowed ? { opacity: [0.35, 1, 0.35], scale: [0.85, 1, 0.85] } : { opacity: 1 }}
        transition={allowed ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }}
      />
      {text}
    </p>
  );
}

function CheckRow({
  check,
  visual,
  allowed,
}: {
  check: GateCheck | { id: string; label: string; status: CheckStatus; detail: string[] };
  visual: CheckStatus;
  allowed: boolean;
}) {
  const spoken = visual === "wait" ? "waiting" : visual === "pass" ? "passed" : `failed. ${check.detail.join(". ")}`;
  return (
    <motion.li
      className="flex items-start gap-3"
      aria-label={`${check.label}: ${spoken}`}
      initial={false}
      animate={visual === "wait" ? { opacity: 0.45 } : { opacity: 1 }}
      transition={{ duration: allowed ? 0.2 : 0 }}
    >
      <span className="check-mark mt-0.5" data-status={visual} aria-hidden>
        <Mark status={visual} allowed={allowed} />
      </span>
      <div className="min-w-0">
        <p>{check.label}</p>
        {visual === "fail" && check.detail.length > 0 && (
          <p className="muted mt-1 text-sm leading-relaxed">{check.detail.join(". ")}</p>
        )}
      </div>
    </motion.li>
  );
}

function Mark({ status, allowed }: { status: CheckStatus; allowed: boolean }) {
  if (status === "pass") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <motion.path
          d="M3.5 8.2 6.4 11.1 12.5 4.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={allowed ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: allowed ? 0.28 : 0, ease: EASE }}
        />
      </svg>
    );
  }
  if (status === "fail") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <path d="M3 3l6 6M9 3 3 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return <span className="block h-1.5 w-1.5 rounded-full bg-current opacity-40" />;
}
