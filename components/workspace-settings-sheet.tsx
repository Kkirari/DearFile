"use client";

/**
 * Workspace settings — rename, member management, invite links, leave.
 *
 * Mounted from the workspace switcher's "⋯" button on the active chip.
 * Owners see all controls. Members see only the member list + leave.
 *
 * Member display names are not resolved in v1 (no LINE Profile API call) —
 * we show partial userIds. Phase 3 will pretty-print these.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Edit3,
  LogOut,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useWorkspace, type WorkspaceSummary } from "@/providers/workspace-provider";
import { useLiff } from "@/providers/liff-provider";

interface WorkspaceSettingsSheetProps {
  workspace: WorkspaceSummary;
  onClose: () => void;
}

interface MemberView {
  userId: string;
  role: "owner" | "member";
  joinedAt: string;
  displayName?: string;
  pictureUrl?: string;
}

interface InviteView {
  token: string;
  workspaceId: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
  useCount: number;
}

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID;

function shortUserId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

function inviteUrl(token: string): string {
  return LIFF_ID
    ? `https://liff.line.me/${LIFF_ID}/invite/${token}`
    : `${window.location.origin}/invite/${token}`;
}

export function WorkspaceSettingsSheet({ workspace, onClose }: WorkspaceSettingsSheetProps) {
  const { refresh, setCurrentWorkspace } = useWorkspace();
  const { profile } = useLiff();
  const myUserId = profile?.userId ?? null;
  const [isClosing, setIsClosing] = useState(false);
  const [members, setMembers]     = useState<MemberView[] | null>(null);
  const [invites, setInvites]     = useState<InviteView[] | null>(null);
  const [renaming, setRenaming]   = useState(false);
  const [nameDraft, setNameDraft] = useState(workspace.name);
  const [busy, setBusy]           = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [copied, setCopied]       = useState<string | null>(null);

  const isOwner = workspace.role === "owner";

  function close() {
    setIsClosing(true);
    setTimeout(() => { setIsClosing(false); onClose(); }, 260);
  }

  // ── Initial load ────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      // Members — resolved with LINE display names + avatars server-side.
      const memRes = await apiFetch(`/api/workspaces/${workspace.id}/members`);
      if (memRes.ok) {
        const data = await memRes.json() as { members?: MemberView[] };
        setMembers(data.members ?? []);
      } else {
        setMembers([]);
      }

      // Invites are owner-only.
      if (isOwner) {
        const res = await apiFetch(`/api/workspaces/${workspace.id}/invites`);
        if (res.ok) {
          const data = await res.json() as { invites?: InviteView[] };
          setInvites(data.invites ?? []);
        } else {
          setInvites([]);
        }
      } else {
        setInvites([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [workspace.id, isOwner]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Remove member (owner only) ───────────────────────────────────────

  async function removeMember(targetId: string) {
    setBusy(`remove-${targetId}`);
    setError(null);
    try {
      const res = await apiFetch(`/api/workspaces/${workspace.id}/members/${targetId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Remove failed (${res.status})`);
      }
      setMembers((prev) => prev?.filter((m) => m.userId !== targetId) ?? null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(null);
    }
  }

  // ── Rename ─────────────────────────────────────────────────────────

  async function commitRename() {
    const next = nameDraft.trim();
    if (!next || next === workspace.name) {
      setRenaming(false);
      setNameDraft(workspace.name);
      return;
    }
    setBusy("rename");
    setError(null);
    try {
      const res = await apiFetch(`/api/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Rename failed (${res.status})`);
      }
      await refresh();
      setRenaming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
      setNameDraft(workspace.name);
    } finally {
      setBusy(null);
    }
  }

  // ── Invites ─────────────────────────────────────────────────────────

  async function createInvite() {
    setBusy("create-invite");
    setError(null);
    try {
      const res = await apiFetch(`/api/workspaces/${workspace.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({})) as {
        invite?: InviteView;
        error?: string;
      };
      if (!res.ok || !data.invite) {
        throw new Error(data.error ?? `Failed to create invite (${res.status})`);
      }
      setInvites((prev) => [data.invite!, ...(prev ?? [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setBusy(null);
    }
  }

  async function revokeInvite(token: string) {
    setBusy(`revoke-${token}`);
    setError(null);
    try {
      const res = await apiFetch(`/api/workspaces/${workspace.id}/invites/${token}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Revoke failed (${res.status})`);
      }
      setInvites((prev) => prev?.filter((i) => i.token !== token) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revoke failed");
    } finally {
      setBusy(null);
    }
  }

  async function copyInvite(token: string) {
    const url = inviteUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1800);
    } catch {
      setError("Copy failed — link unavailable on this device");
    }
  }

  function shareInvite(token: string) {
    const url = inviteUrl(token);
    const text = `Join "${workspace.name}" on DearFile`;
    // LINE share URL works in-browser without LIFF SDK
    const shareUrl =
      `https://line.me/R/share?text=${encodeURIComponent(`${text}\n${url}`)}`;
    window.open(shareUrl, "_blank", "noopener");
  }

  // ── Leave ───────────────────────────────────────────────────────────

  async function leaveWorkspace() {
    if (isOwner) return;
    if (!window.confirm(`Leave "${workspace.name}"?`)) return;

    setBusy("leave");
    setError(null);
    try {
      // We need the caller's own userId. The server resolves it from the
      // bearer token, but the URL still needs a userId path segment. We
      // route through a "self" alias which the server resolves to the
      // caller — but to keep the route simple, the LIFF provider can
      // expose displayName/userId. For v1 we encode "self" sentinel and
      // the route resolves it.
      const meRes = await apiFetch("/api/workspaces");  // cheap auth probe
      if (!meRes.ok) throw new Error("Not authenticated");

      // Members endpoint expects an explicit userId. Use the userId
      // captured in the workspace.members list — we'd need a /me. For
      // simplicity in v1, we ask the user to confirm and hit DELETE
      // with the current LIFF user id which we don't have directly here.
      // Workaround: have the server accept "self" as a sentinel and use
      // the bearer-token user id.

      const res = await apiFetch(`/api/workspaces/${workspace.id}/members/self`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Leave failed (${res.status})`);
      }
      await refresh();
      setCurrentWorkspace(null);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Leave failed");
    } finally {
      setBusy(null);
    }
  }

  // ── Delete workspace (owner only, irreversible) ──────────────────────

  async function deleteWorkspace() {
    if (!isOwner) return;
    if (!window.confirm(
      `Delete "${workspace.name}" for everyone? All files in this workspace will be permanently removed. This cannot be undone.`,
    )) return;

    setBusy("delete");
    setError(null);
    try {
      const res = await apiFetch(`/api/workspaces/${workspace.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Delete failed (${res.status})`);
      }
      await refresh();
      setCurrentWorkspace(null);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-[70] bg-black/25 ${isClosing ? "backdrop-exit" : "backdrop-enter"}`}
        onClick={close}
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-[70] max-h-[88dvh] overflow-y-auto rounded-t-[28px] bg-[#fbfaf6] dark:bg-[#252220] px-5 pt-4 pb-[calc(32px+env(safe-area-inset-bottom,0px))] shadow-2xl ${isClosing ? "sheet-exit" : "sheet-enter"}`}
      >
        <div className="mx-auto mb-5 h-[5px] w-10 rounded-full bg-[#e0d8cc] dark:bg-[#3a3430]" />

        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#9b869c]/10">
              <Users size={18} className="text-[#9b869c]" />
            </div>
            {renaming ? (
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") { setRenaming(false); setNameDraft(workspace.name); }
                }}
                onBlur={commitRename}
                autoFocus
                maxLength={80}
                className="flex-1 min-w-0 rounded-lg border border-[#9b869c] bg-transparent px-2 py-1 text-[16px] font-bold text-[#4a4036] dark:text-[#e8ddd4] outline-none"
              />
            ) : (
              <button
                onClick={() => isOwner && setRenaming(true)}
                disabled={!isOwner}
                className="flex items-center gap-1.5 text-left min-w-0"
              >
                <span className="truncate text-[16px] font-bold text-[#4a4036] dark:text-[#e8ddd4]">
                  {workspace.name}
                </span>
                {isOwner && <Edit3 size={13} className="text-[#b0a396] flex-shrink-0" />}
              </button>
            )}
          </div>
          <button
            onClick={close}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#f4f3ee] dark:bg-[#2a2724] text-[#b0a396] dark:text-[#6e6460] transition-colors active:bg-[#e0d8cc] dark:active:bg-[#3a3430]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Meta line */}
        <div className="mb-5 flex items-center gap-3 text-[12px] text-[#b0a396] dark:text-[#6e6460]">
          <span>{workspace.memberCount} members</span>
          <span>·</span>
          <span className="font-medium text-[#9b869c]">{isOwner ? "You are owner" : "You are member"}</span>
          {workspace.lineGroupId && (
            <>
              <span>·</span>
              <span>LINE group</span>
            </>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900/40 px-3.5 py-2.5 text-[12px] text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Invites (owner only) */}
        {isOwner && (
          <section className="mb-5">
            <div className="mb-2.5 flex items-center justify-between">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
                Invite link
              </h4>
              <button
                onClick={createInvite}
                disabled={busy === "create-invite"}
                className="flex items-center gap-1 rounded-full bg-[#9b869c] px-3 py-1.5 text-[11.5px] font-bold text-white shadow-[0_2px_6px_rgba(155,134,156,0.3)] active:scale-[0.97] disabled:opacity-50"
              >
                <Plus size={11} strokeWidth={2.75} />
                {busy === "create-invite" ? "Creating…" : "New invite"}
              </button>
            </div>

            {invites === null ? (
              <p className="text-[12px] text-[#b0a396]">Loading…</p>
            ) : invites.length === 0 ? (
              <p className="text-[12px] text-[#b0a396] dark:text-[#6e6460] leading-relaxed">
                No active invites. Tap <span className="font-semibold">New invite</span> to generate a shareable link.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {invites.map((inv) => {
                  const url = inviteUrl(inv.token);
                  const wasCopied = copied === inv.token;
                  return (
                    <li
                      key={inv.token}
                      className="rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee]/50 dark:bg-[#2a2724]/50 p-3"
                    >
                      <p className="break-all text-[11.5px] font-mono text-[#4a4036] dark:text-[#e8ddd4] leading-snug">
                        {url}
                      </p>
                      <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-[#b0a396] dark:text-[#6e6460]">
                        <span>
                          {inv.useCount} {inv.useCount === 1 ? "join" : "joins"}
                          {inv.expiresAt && (
                            <> · expires {new Date(inv.expiresAt).toLocaleDateString()}</>
                          )}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          onClick={() => copyInvite(inv.token)}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#9b869c] py-2 text-[12px] font-bold text-white active:scale-[0.97]"
                        >
                          {wasCopied ? <Check size={13} strokeWidth={2.75} /> : <Copy size={13} strokeWidth={2.5} />}
                          {wasCopied ? "Copied" : "Copy"}
                        </button>
                        <button
                          onClick={() => shareInvite(inv.token)}
                          className="flex-1 rounded-xl border border-[#9b869c] py-2 text-[12px] font-bold text-[#9b869c] active:scale-[0.97]"
                        >
                          Share to LINE
                        </button>
                        <button
                          onClick={() => revokeInvite(inv.token)}
                          disabled={busy === `revoke-${inv.token}`}
                          aria-label="Revoke invite"
                          className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f4f3ee] dark:bg-[#2a2724] text-red-500 active:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {/* Members */}
        <section className="mb-5">
          <h4 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#b0a396] dark:text-[#6e6460]">
            Members ({members?.length ?? workspace.memberCount})
          </h4>
          {members === null ? (
            <p className="text-[12px] text-[#b0a396]">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-[12px] text-[#b0a396] dark:text-[#6e6460]">No members found.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {members.map((m) => {
                const isYou   = myUserId !== null && m.userId === myUserId;
                const name    = m.displayName ?? shortUserId(m.userId);
                const removing = busy === `remove-${m.userId}`;
                return (
                  <li
                    key={m.userId}
                    className="flex items-center gap-3 rounded-2xl border border-[#e0d8cc] dark:border-[#3a3430] bg-[#f4f3ee]/50 dark:bg-[#2a2724]/50 px-3 py-2.5"
                  >
                    {m.pictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.pictureUrl}
                        alt={name}
                        className="h-9 w-9 flex-shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#9b869c]/15 text-[13px] font-bold text-[#9b869c]">
                        {name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[#4a4036] dark:text-[#e8ddd4]">
                        {name}
                        {isYou && <span className="ml-1.5 text-[11px] font-medium text-[#9b869c]">(You)</span>}
                      </p>
                      <p className="text-[11px] text-[#b0a396] dark:text-[#6e6460]">
                        {m.role === "owner" ? "Owner" : "Member"}
                      </p>
                    </div>
                    {isOwner && m.role !== "owner" && (
                      <button
                        onClick={() => removeMember(m.userId)}
                        disabled={removing}
                        aria-label={`Remove ${name}`}
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[#f4f3ee] dark:bg-[#2a2724] text-red-500 active:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Leave (member) / Delete (owner) */}
        {isOwner ? (
          <button
            onClick={deleteWorkspace}
            disabled={busy === "delete"}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 py-3 text-[13px] font-bold text-red-600 dark:text-red-400 active:bg-red-100 dark:active:bg-red-950/40 disabled:opacity-50"
          >
            <Trash2 size={14} strokeWidth={2.25} />
            {busy === "delete" ? "Deleting…" : "Delete workspace"}
          </button>
        ) : (
          <button
            onClick={leaveWorkspace}
            disabled={busy === "leave"}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 py-3 text-[13px] font-bold text-red-600 dark:text-red-400 active:bg-red-100 dark:active:bg-red-950/40 disabled:opacity-50"
          >
            <LogOut size={14} strokeWidth={2.25} />
            {busy === "leave" ? "Leaving…" : "Leave workspace"}
          </button>
        )}
      </div>
    </>
  );
}
