"use client";

import { useState } from "react";
import { KeyRound, Sparkles } from "lucide-react";
import { useByokKeys, type ByokProvider, type KeyStatus } from "@/hooks/use-byok-keys";
import { useLanguage } from "@/providers/language-provider";

interface ProviderRow {
  id: ByokProvider;
  label: string;
  placeholder: string;
}

function relativeTime(iso: string | undefined, lang: "en" | "th"): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "";
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (lang === "th") {
    if (d >= 1) return `${d}d ที่แล้ว`;
    if (h >= 1) return `${h}h ที่แล้ว`;
    if (m >= 1) return `${m}m ที่แล้ว`;
    return "เมื่อสักครู่";
  }
  if (d >= 1) return `${d}d ago`;
  if (h >= 1) return `${h}h ago`;
  if (m >= 1) return `${m}m ago`;
  return "just now";
}

function StatusPill({ status, setLabel, notSetLabel, lang }: {
  status: KeyStatus;
  setLabel: string;
  notSetLabel: string;
  lang: "en" | "th";
}) {
  if (!status.set) {
    return (
      <span className="rounded-full bg-[#e0d8cc]/40 dark:bg-[#3a3430]/60 px-2 py-0.5 t-caption text-[#b0a396] dark:text-[#6e6460]">
        {notSetLabel}
      </span>
    );
  }
  const rel = relativeTime(status.updatedAt, lang);
  return (
    <span className="rounded-full bg-[#9b869c]/15 px-2 py-0.5 t-caption font-medium text-[#9b869c]">
      {setLabel} · ····{status.last4 ?? "····"}{rel ? ` · ${rel}` : ""}
    </span>
  );
}

function ProviderControl({ row, status, onSave, onRemove, tr, lang }: {
  row: ProviderRow;
  status: KeyStatus;
  onSave: (provider: ByokProvider, key: string) => Promise<{ ok: boolean; error?: string }>;
  onRemove: (provider: ByokProvider) => Promise<void>;
  tr: ReturnType<typeof useLanguage>["tr"];
  lang: "en" | "th";
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function handleSave() {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    const res = await onSave(row.id, value.trim());
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      setValue("");
    } else {
      setError(res.error || tr.byokSaveFailed);
    }
  }

  async function handleRemove() {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setBusy(true);
    await onRemove(row.id);
    setBusy(false);
    setConfirmRemove(false);
  }

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
          <Sparkles size={15} className="text-[#9b869c]" />
        </div>
        <span className="flex-1 t-body text-[#4a4036] dark:text-[#e8ddd4]">{row.label}</span>
        <StatusPill
          status={status}
          setLabel={tr.byokSet}
          notSetLabel={tr.byokNotSet}
          lang={lang}
        />
      </div>

      {!editing ? (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => { setEditing(true); setError(null); setConfirmRemove(false); }}
            className="t-caption font-medium text-[#9b869c] active:opacity-60"
          >
            {status.set ? tr.byokUpdateKey : tr.byokAddKey}
          </button>
          {status.set && (
            <button
              onClick={handleRemove}
              disabled={busy}
              className={`t-caption font-medium active:opacity-60 ${
                confirmRemove ? "text-red-500" : "text-[#b0a396] dark:text-[#6e6460]"
              }`}
            >
              {confirmRemove ? tr.byokConfirmRemove : tr.byokRemove}
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={row.placeholder}
            disabled={busy}
            className="w-full rounded-xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#1c1a18] px-3 py-2 t-body text-[#4a4036] dark:text-[#e8ddd4] outline-none focus:border-[#9b869c]/60"
          />
          {error && <p className="t-caption text-red-500">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={busy || !value.trim()}
              className="rounded-full bg-[#9b869c] px-4 py-1 t-caption font-bold text-white active:opacity-80 disabled:opacity-50"
            >
              {busy ? tr.byokSaving : tr.byokSave}
            </button>
            <button
              onClick={() => { setEditing(false); setValue(""); setError(null); }}
              disabled={busy}
              className="t-caption font-medium text-[#b0a396] dark:text-[#6e6460] active:opacity-60"
            >
              {tr.byokCancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ByokKeysCard() {
  const { tr, lang } = useLanguage();
  const { status, available, loading, save, remove } = useByokKeys();

  if (!available || loading) return null;

  const rows: ProviderRow[] = [
    { id: "anthropic", label: tr.byokAnthropic, placeholder: "sk-ant-…" },
    { id: "voyage",    label: tr.byokVoyage,    placeholder: "pa-…"     },
  ];

  return (
    <section className="px-5 mt-5">
      <div className="mb-3 flex items-center gap-1.5">
        <KeyRound size={13} className="text-[#9b869c]" />
        <p className="t-body font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.byokTitle}</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)] divide-y divide-[#e0d8cc]/60 dark:divide-[#3a3430]/60">
        {rows.map((row) => (
          <ProviderControl
            key={row.id}
            row={row}
            status={status[row.id]}
            onSave={save}
            onRemove={remove}
            tr={tr}
            lang={lang}
          />
        ))}
      </div>
      <p className="mt-2 t-caption text-[#b0a396] dark:text-[#6e6460]">{tr.byokHelp}</p>
    </section>
  );
}
