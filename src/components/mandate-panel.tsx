"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { gbp, mandateSentence } from "@/components/format";
import type { Mandate, MandateUpdateResponse } from "@/lib/types";

export function MandatePanel({
  mandate,
  spent,
  compact = false,
}: {
  mandate: Mandate;
  spent: number;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [weeklyBudget, setWeeklyBudget] = useState(String(mandate.weeklyBudget));
  const [perOrderCap, setPerOrderCap] = useState(String(mandate.perOrderCap));
  const [askAbove, setAskAbove] = useState(String(mandate.askAbove));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(mandate);

  const pct = Math.min(100, Math.round((spent / current.weeklyBudget) * 100));

  function syncFrom(next: Mandate) {
    setCurrent(next);
    setWeeklyBudget(String(next.weeklyBudget));
    setPerOrderCap(String(next.perOrderCap));
    setAskAbove(String(next.askAbove));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/mandate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mandateId: current.id,
          weeklyBudget: Number(weeklyBudget),
          perOrderCap: Number(perOrderCap),
          askAbove: Number(askAbove),
        }),
      });
      const data = (await res.json().catch(() => null)) as (MandateUpdateResponse & { error?: string }) | null;
      if (!res.ok || !data?.mandate) throw new Error(data?.error || "Could not save the limits.");
      syncFrom(data.mandate);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the limits.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className={`glass rounded-3xl ${compact ? "p-3 sm:p-4" : "p-4 sm:p-5"}`}>
      <p className={`leading-relaxed ${compact ? "text-sm" : ""}`}>{mandateSentence(current)}</p>
      <div className={compact ? "mt-3" : "mt-4"}>
        <div className="mb-2 flex justify-between gap-3 text-sm">
          <span className="muted">This week</span>
          <span className="num">
            {gbp(spent)} of {gbp(current.weeklyBudget)}
          </span>
        </div>
        <div
          className="spend-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Weekly spending"
        >
          <div className="spend-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <button
        type="button"
        className={`btn btn-ghost ${compact ? "mt-3 min-h-10 text-sm" : "mt-4"}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? "Cancel" : "Change limits"}
      </button>

      {open && (
        <form
          className="mt-4 space-y-3 border-t border-[var(--line)] pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field id="weekly" label="Weekly budget (£)" value={weeklyBudget} onChange={setWeeklyBudget} />
          <Field id="cap" label="Per order (£)" value={perOrderCap} onChange={setPerOrderCap} />
          <Field id="ask" label="Ask first above (£)" value={askAbove} onChange={setAskAbove} />
          {error && (
            <p className="text-sm" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-accent" disabled={saving}>
            {saving ? "Saving…" : "Save limits"}
          </button>
        </form>
      )}
    </aside>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="muted text-sm">{label}</span>
      <input
        id={id}
        className="field field-box mt-1 num"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </label>
  );
}
