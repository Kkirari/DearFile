"use client";

/**
 * LIFF invite accept landing.
 *
 * URL shape: https://liff.line.me/{LIFF_ID}/invite/{token}
 *
 * LIFF auth must boot first (waited on inside apiFetch). Once authed we
 * call POST /api/workspaces/accept; on success switch to that workspace
 * and navigate home. Errors render a friendly message with a back button.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, Loader2, Users } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useWorkspace } from "@/providers/workspace-provider";

type State =
  | { kind: "loading" }
  | { kind: "ok"; workspaceId: string; name: string }
  | { kind: "error"; message: string; code?: string };

const ERROR_COPY: Record<string, string> = {
  not_found: "This invite no longer exists. Ask the workspace owner for a new link.",
  revoked:   "This invite has been revoked by the workspace owner.",
  expired:   "This invite has expired. Ask the owner for a new link.",
  invalid:   "This invite link is malformed.",
};

export default function AcceptInvitePage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const { setCurrentWorkspace, refresh } = useWorkspace();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const token = params?.token;
    if (typeof token !== "string" || token.length === 0) {
      setState({ kind: "error", message: ERROR_COPY.invalid, code: "invalid" });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch("/api/workspaces/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({})) as {
          workspaceId?: string;
          name?: string;
          error?: string;
          code?: string;
        };

        if (cancelled) return;

        if (!res.ok) {
          const code = data.code;
          setState({
            kind: "error",
            message: (code && ERROR_COPY[code]) || data.error || "Could not accept the invite.",
            code,
          });
          return;
        }

        if (!data.workspaceId) {
          setState({ kind: "error", message: "Unexpected response from server." });
          return;
        }

        setState({ kind: "ok", workspaceId: data.workspaceId, name: data.name ?? "Workspace" });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      }
    })();

    return () => { cancelled = true; };
  }, [params?.token]);

  async function openWorkspace() {
    if (state.kind !== "ok") return;
    await refresh();                          // ensure the new workspace shows in the switcher
    setCurrentWorkspace(state.workspaceId);
    router.replace("/");
  }

  function goHome() {
    router.replace("/");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f4f3ee] dark:bg-[#1c1a18] px-6">
      <div className="page-fade w-full max-w-sm rounded-3xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#fbfaf6] dark:bg-[#252220] p-7 text-center shadow-[0_8px_28px_rgba(74,64,54,0.08)]">

        {state.kind === "loading" && (
          <>
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#9b869c]/15">
              <Loader2 size={26} className="text-[#9b869c] animate-spin" strokeWidth={2.25} />
            </div>
            <h1 className="text-[18px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">
              Joining workspace…
            </h1>
            <p className="mt-1.5 text-[13px] text-[#b0a396] dark:text-[#6e6460]">
              Hang tight, this only takes a moment.
            </p>
          </>
        )}

        {state.kind === "ok" && (
          <>
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#9b869c] shadow-[0_6px_18px_rgba(155,134,156,0.35)]">
              <CheckCircle2 size={26} className="text-white" strokeWidth={2.4} />
            </div>
            <h1 className="text-[18px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">
              You&rsquo;ve joined
            </h1>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-[15px] font-semibold text-[#9b869c]">
              <Users size={14} strokeWidth={2.5} />
              {state.name}
            </p>
            <button
              onClick={openWorkspace}
              className="mt-6 w-full rounded-2xl bg-[#9b869c] py-3 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(155,134,156,0.3)] active:scale-[0.98] transition-transform"
            >
              Open workspace
            </button>
          </>
        )}

        {state.kind === "error" && (
          <>
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-950/40">
              <AlertTriangle size={26} className="text-amber-600 dark:text-amber-400" strokeWidth={2.25} />
            </div>
            <h1 className="text-[18px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">
              Couldn&rsquo;t accept invite
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-[#b0a396] dark:text-[#6e6460]">
              {state.message}
            </p>
            <button
              onClick={goHome}
              className="mt-6 w-full rounded-2xl bg-[#9b869c] py-3 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(155,134,156,0.3)] active:scale-[0.98] transition-transform"
            >
              Back to DearFile
            </button>
          </>
        )}

      </div>
    </div>
  );
}
