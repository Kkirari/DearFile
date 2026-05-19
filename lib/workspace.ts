/**
 * Shared workspaces — Phase 1 of Google-Drive-style sharing for DearFile.
 *
 * A workspace is a multi-member container for folders + files. Storage
 * lives under `workspaces/{workspaceId}/...` (see lib/s3.ts path helpers).
 * Membership is recorded in `_meta.json`; per-user denormalized list at
 * `users/{userId}/_workspaces.json` lets the LIFF app list "Shared with me"
 * without scanning the full workspace prefix.
 *
 * Roles for Phase 1:
 *   owner  — full CRUD, can invite/remove members, can delete the workspace
 *   member — upload + manage own files + create folders, no delete-others
 *
 * Concurrency: meta + per-user index writes go through small per-key
 * promise chains, same idea as lib/search-index.ts's withIndexLock. This
 * stops two simultaneous webhook events from clobbering each other when
 * adding members. Multi-instance races still exist; a real fix needs
 * ETag-conditional writes or a KV store.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import crypto from "crypto";
import {
  s3,
  BUCKET,
  isSafeWorkspaceId,
  userWorkspacesIndexKey,
  workspaceMetaKey,
} from "./s3";
import { AuthError } from "./auth";

export type WorkspaceRole = "owner" | "member";

export interface WorkspaceMember {
  userId: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface WorkspaceMeta {
  id: string;
  name: string;
  ownerId: string;
  members: WorkspaceMember[];
  lineGroupId: string | null;
  orphaned?: boolean;        // bot was removed from the bound LINE group
  createdAt: string;
  updatedAt: string;
}

/** Compact entry stored in users/{U}/_workspaces.json for fast listing. */
export interface UserWorkspaceEntry {
  id: string;
  role: WorkspaceRole;
  joinedAt: string;
}

// ── Locks ─────────────────────────────────────────────────────────────────

const metaLocks = new Map<string, Promise<unknown>>();
const userIndexLocks = new Map<string, Promise<unknown>>();

function withLock<T>(
  locks: Map<string, Promise<unknown>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => undefined));
  return next;
}

// ── ID generation ─────────────────────────────────────────────────────────

/**
 * Server-generated workspace id. Format `ws_<12-char-base36>` keeps URLs
 * short and survives the isSafeWorkspaceId regex.
 */
function newWorkspaceId(): string {
  return `ws_${crypto.randomBytes(8).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
}

// ── Meta read/write ───────────────────────────────────────────────────────

export async function loadWorkspaceMeta(workspaceId: string): Promise<WorkspaceMeta | null> {
  if (!isSafeWorkspaceId(workspaceId)) return null;
  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key:    workspaceMetaKey(workspaceId),
    }));
    const body = await res.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as WorkspaceMeta;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

async function saveWorkspaceMeta(meta: WorkspaceMeta): Promise<void> {
  meta.updatedAt = new Date().toISOString();
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         workspaceMetaKey(meta.id),
    Body:        JSON.stringify(meta),
    ContentType: "application/json",
  }));
}

// ── Per-user workspace index ──────────────────────────────────────────────

export async function listUserWorkspaces(userId: string): Promise<UserWorkspaceEntry[]> {
  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key:    userWorkspacesIndexKey(userId),
    }));
    const body = await res.Body?.transformToString();
    if (!body) return [];
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? (parsed as UserWorkspaceEntry[]) : [];
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "NoSuchKey") return [];
    throw err;
  }
}

function saveUserWorkspaces(userId: string, entries: UserWorkspaceEntry[]): Promise<unknown> {
  return s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         userWorkspacesIndexKey(userId),
    Body:        JSON.stringify(entries),
    ContentType: "application/json",
  }));
}

function addToUserIndex(userId: string, entry: UserWorkspaceEntry): Promise<void> {
  return withLock(userIndexLocks, userId, async () => {
    const list = await listUserWorkspaces(userId);
    const existing = list.findIndex((e) => e.id === entry.id);
    if (existing >= 0) list[existing] = entry;
    else list.push(entry);
    await saveUserWorkspaces(userId, list);
  });
}

function removeFromUserIndex(userId: string, workspaceId: string): Promise<void> {
  return withLock(userIndexLocks, userId, async () => {
    const list = await listUserWorkspaces(userId);
    const filtered = list.filter((e) => e.id !== workspaceId);
    if (filtered.length !== list.length) await saveUserWorkspaces(userId, filtered);
  });
}

// ── Workspace CRUD ────────────────────────────────────────────────────────

export interface CreateWorkspaceInput {
  name: string;
  ownerId: string;
  lineGroupId?: string | null;
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceMeta> {
  const id = newWorkspaceId();
  const now = new Date().toISOString();
  const meta: WorkspaceMeta = {
    id,
    name:        input.name.trim().slice(0, 80) || "Untitled Workspace",
    ownerId:     input.ownerId,
    members:     [{ userId: input.ownerId, role: "owner", joinedAt: now }],
    lineGroupId: input.lineGroupId ?? null,
    createdAt:   now,
    updatedAt:   now,
  };

  await saveWorkspaceMeta(meta);
  await addToUserIndex(input.ownerId, { id, role: "owner", joinedAt: now });
  return meta;
}

/**
 * Find a workspace by its bound LINE group id. Returns null if none.
 *
 * Implementation note: we scan the owner's user-index for any entry whose
 * meta carries the lineGroupId. That's an O(N) scan but N is small per
 * user. A reverse-index (`group-to-workspace/{groupId}.json`) would scale
 * but isn't worth it for Phase 1.
 *
 * Actually we can't scan "the owner's" index without knowing the owner.
 * Instead we use a tiny reverse-index at `group-bindings/{groupId}.json`
 * holding the workspaceId. Trivial extra file — much cheaper than scanning.
 */
const groupBindingKey = (lineGroupId: string) => `group-bindings/${lineGroupId}.json`;

export async function findWorkspaceByLineGroup(
  lineGroupId: string,
): Promise<WorkspaceMeta | null> {
  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key:    groupBindingKey(lineGroupId),
    }));
    const body = await res.Body?.transformToString();
    if (!body) return null;
    const parsed = JSON.parse(body) as { workspaceId?: string };
    if (!parsed.workspaceId) return null;
    return loadWorkspaceMeta(parsed.workspaceId);
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

async function setGroupBinding(lineGroupId: string, workspaceId: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         groupBindingKey(lineGroupId),
    Body:        JSON.stringify({ workspaceId }),
    ContentType: "application/json",
  }));
}

/**
 * Create a workspace bound to a LINE group, or return the existing one if
 * the binding already exists. Idempotent for webhook retries.
 */
export async function createGroupWorkspace(opts: {
  lineGroupId: string;
  ownerId: string;
  name?: string;
}): Promise<WorkspaceMeta> {
  const existing = await findWorkspaceByLineGroup(opts.lineGroupId);
  if (existing) return existing;

  const meta = await createWorkspace({
    name:        opts.name ?? "Untitled Workspace",
    ownerId:     opts.ownerId,
    lineGroupId: opts.lineGroupId,
  });
  await setGroupBinding(opts.lineGroupId, meta.id);
  return meta;
}

// ── Member management ─────────────────────────────────────────────────────

export function addMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole = "member",
): Promise<WorkspaceMeta> {
  return withLock(metaLocks, workspaceId, async () => {
    const meta = await loadWorkspaceMeta(workspaceId);
    if (!meta) throw new AuthError(404, "Workspace not found");

    const existing = meta.members.find((m) => m.userId === userId);
    if (existing) return meta;

    const now = new Date().toISOString();
    meta.members.push({ userId, role, joinedAt: now });
    await saveWorkspaceMeta(meta);
    await addToUserIndex(userId, { id: workspaceId, role, joinedAt: now });
    return meta;
  });
}

export function removeMember(workspaceId: string, userId: string): Promise<WorkspaceMeta> {
  return withLock(metaLocks, workspaceId, async () => {
    const meta = await loadWorkspaceMeta(workspaceId);
    if (!meta) throw new AuthError(404, "Workspace not found");

    if (meta.ownerId === userId) {
      throw new AuthError(400, "Cannot remove the workspace owner");
    }

    const before = meta.members.length;
    meta.members = meta.members.filter((m) => m.userId !== userId);
    if (meta.members.length === before) return meta;

    await saveWorkspaceMeta(meta);
    await removeFromUserIndex(userId, workspaceId);
    return meta;
  });
}

export function markOrphaned(workspaceId: string): Promise<WorkspaceMeta | null> {
  return withLock(metaLocks, workspaceId, async () => {
    const meta = await loadWorkspaceMeta(workspaceId);
    if (!meta) return null;
    meta.orphaned = true;
    await saveWorkspaceMeta(meta);
    return meta;
  });
}

// ── Auth gate ─────────────────────────────────────────────────────────────

/**
 * Throws AuthError unless `userId` is a member of the workspace with at
 * least `minRole`. Returns the member record for inspection. Every
 * workspace-aware API route MUST call this before any S3 mutation.
 */
export async function requireWorkspaceAccess(
  userId: string,
  workspaceId: string,
  minRole: WorkspaceRole = "member",
): Promise<WorkspaceMember> {
  if (!isSafeWorkspaceId(workspaceId)) {
    throw new AuthError(400, "Invalid workspaceId");
  }

  const meta = await loadWorkspaceMeta(workspaceId);
  if (!meta) throw new AuthError(404, "Workspace not found");

  const member = meta.members.find((m) => m.userId === userId);
  if (!member) throw new AuthError(403, "Not a member of this workspace");

  if (minRole === "owner" && member.role !== "owner") {
    throw new AuthError(403, "Owner-only action");
  }

  return member;
}
