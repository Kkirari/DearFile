"use client";

import { useMemo, useState } from "react";
import { Plug, Copy, Check, X } from "lucide-react";
import { useMcpTokens, type MintResult, type MaskedMcpToken } from "@/hooks/use-mcp-tokens";
import { useLanguage } from "@/providers/language-provider";

function relativeTime(iso: string | null | undefined, lang: "en" | "th"): string {
  if (!iso) return lang === "th" ? "ยังไม่เคยใช้" : "never used";
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

function configSnippet(origin: string, plaintext: string): string {
  return JSON.stringify({
    mcpServers: {
      dearfile: {
        type: "http",
        url:  `${origin}/api/mcp`,
        headers: { Authorization: `Bearer ${plaintext}` },
      },
    },
  }, null, 2);
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); } catch { return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 rounded-full border border-[#e0d8cc] dark:border-[#3a3430] px-2 py-0.5 t-caption text-[#9b869c] active:opacity-60"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function MintFlow({
  onDone,
  onMint,
  tr,
}: {
  onDone: () => void;
  onMint: (label: string) => Promise<{ ok: boolean; result?: MintResult; error?: string }>;
  tr: ReturnType<typeof useLanguage>["tr"];
}) {
  const [label, setLabel]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [minted, setMinted]   = useState<MintResult | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://<your-domain>";
  const snippet = useMemo(() => minted ? configSnippet(origin, minted.plaintext) : "", [minted, origin]);

  async function handleMint() {
    setBusy(true);
    setError(null);
    const r = await onMint(label.trim() || "Claude Desktop");
    setBusy(false);
    if (!r.ok || !r.result) {
      setError(r.error || tr.mcpMintFailed);
      return;
    }
    setMinted(r.result);
  }

  if (minted) {
    return (
      <div className="rounded-2xl border border-[#9b869c]/40 bg-[#fbfaf6] dark:bg-[#252220] p-4 mt-3 space-y-3">
        <p className="t-caption text-[#4a4036] dark:text-[#e8ddd4]">{tr.mcpOneTimeReveal}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-[#f4f3ee] dark:bg-[#2a2724] px-3 py-2 t-caption font-mono text-[#4a4036] dark:text-[#e8ddd4]">
            {minted.plaintext}
          </code>
          <CopyButton value={minted.plaintext} />
        </div>
        <p className="t-caption font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.mcpConfigSnippet}</p>
        <div className="flex items-start gap-2">
          <pre className="flex-1 overflow-x-auto rounded-lg bg-[#f4f3ee] dark:bg-[#2a2724] px-3 py-2 t-caption font-mono text-[#4a4036] dark:text-[#e8ddd4]">{snippet}</pre>
          <CopyButton value={snippet} />
        </div>
        <button
          onClick={onDone}
          className="t-caption font-medium text-[#9b869c] active:opacity-60"
        >
          {tr.mcpDone}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 mt-3">
      <input
        type="text"
        autoComplete="off"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={tr.mcpLabelPlaceholder}
        disabled={busy}
        className="w-full rounded-xl border border-[#e0d8cc] dark:border-[#3a3430] bg-white dark:bg-[#1c1a18] px-3 py-2 t-body text-[#4a4036] dark:text-[#e8ddd4] outline-none focus:border-[#9b869c]/60"
      />
      {error && <p className="t-caption text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={handleMint}
          disabled={busy}
          className="rounded-full bg-[#9b869c] px-4 py-1 t-caption font-bold text-white active:opacity-80 disabled:opacity-50"
        >
          {busy ? tr.mcpMinting : tr.mcpGenerate}
        </button>
        <button
          onClick={onDone}
          disabled={busy}
          className="t-caption font-medium text-[#b0a396] dark:text-[#6e6460] active:opacity-60"
        >
          {tr.byokCancel}
        </button>
      </div>
    </div>
  );
}

function TokenRow({
  token,
  tr,
  lang,
  onRevoke,
}: {
  token: MaskedMcpToken;
  tr: ReturnType<typeof useLanguage>["tr"];
  lang: "en" | "th";
  onRevoke: (hash: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  async function handleRevoke() {
    if (!confirm) { setConfirm(true); return; }
    await onRevoke(token.tokenHash);
  }
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="t-body truncate text-[#4a4036] dark:text-[#e8ddd4]">
          {token.label ?? tr.mcpUnlabeled}
        </p>
        <p className="t-caption truncate text-[#b0a396] dark:text-[#6e6460]">
          {token.masked} · {relativeTime(token.lastUsedAt, lang)}
        </p>
      </div>
      <button
        onClick={handleRevoke}
        className={`inline-flex items-center gap-1 t-caption font-medium active:opacity-60 ${
          confirm ? "text-red-500" : "text-[#b0a396] dark:text-[#6e6460]"
        }`}
      >
        <X size={12} />
        {confirm ? tr.mcpConfirmRevoke : tr.mcpRevoke}
      </button>
    </div>
  );
}

export function McpTokensCard() {
  const { tr, lang }        = useLanguage();
  const { tokens, loading, mint, revoke } = useMcpTokens();
  const [creating, setCreating] = useState(false);

  if (loading) return null;

  return (
    <section className="px-5 mt-5">
      <div className="mb-3 flex items-center gap-1.5">
        <Plug size={13} className="text-[#9b869c]" />
        <p className="t-body font-bold text-[#4a4036] dark:text-[#e8ddd4]">{tr.mcpTitle}</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] shadow-[0_1px_3px_rgba(74,64,54,0.06)] divide-y divide-[#e0d8cc]/60 dark:divide-[#3a3430]/60">
        {tokens.length === 0 ? (
          <div className="px-4 py-3.5 t-body text-[#b0a396] dark:text-[#6e6460]">
            {tr.mcpEmpty}
          </div>
        ) : (
          tokens.map((t) => (
            <TokenRow key={t.tokenHash} token={t} tr={tr} lang={lang} onRevoke={revoke} />
          ))
        )}
        <div className="px-4 py-3">
          {creating ? (
            <MintFlow
              onDone={() => setCreating(false)}
              onMint={(label) => mint(label)}
              tr={tr}
            />
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="t-caption font-medium text-[#9b869c] active:opacity-60"
            >
              {tr.mcpGenerate}
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 t-caption text-[#b0a396] dark:text-[#6e6460]">{tr.mcpHelp}</p>
    </section>
  );
}
