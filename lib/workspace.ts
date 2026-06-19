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
 * Concurrency model:
 *   - `_meta.json` writes go through ETag-based optimistic concurrency
 *     (compare-and-swap via S3 `If-Match`). Stale writes get a 412 and
 *     retry with backoff.
 *   - `group-bindings/{groupId}.json` writes use `If-None-Match: "*"`
 *     atomic claim so two simultaneous webhooks on a fresh group can't
 *     each create a workspace and clobber each other's binding.
 *   - In-process `withLock` is kept as a contention reducer — it stops
 *     same-instance burst traffic from beating up the CAS retry loop.
 *     Cross-instance races are handled by the S3 conditionals above.
 *   - The per-user index (`users/{U}/_workspaces.json`) still uses the
 *     in-process lock only. It's a denormalization for fast listing; can
 *     lag the workspace meta by a few ms (eventual consistency is fine
 *     for the LIFF "Shared with me" view).
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import crypto from "crypto";
import {
  s3,
  BUCKET,
  isSafeWorkspaceId,
  isSafeFolderId,
  userWorkspacesIndexKey,
  workspaceMetaKey,
  workspaceFolderMetaKey,
  workspacePrefix,
  workspaceInvitesPrefix,
  inviteBindingKey,
} from "./s3";
import { AuthError } from "./auth";
import {
  type FolderMode,
  DEFAULT_FOLDER_MODE,
  isFolderMode,
} from "./folder-permissions";

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

// ── In-process contention reducers ────────────────────────────────────────

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

// ── S3 conditional-write helpers ──────────────────────────────────────────

/**
 * AWS S3 returns 412 PreconditionFailed when an `If-Match` or
 * `If-None-Match` constraint isn't satisfied. The SDK surfaces this as
 * either `err.name === "PreconditionFailed"` or via the HTTP metadata.
 */
function isPreconditionFailed(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "PreconditionFailed" || e.$metadata?.httpStatusCode === 412;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const loaded = await loadWorkspaceMetaWithEtag(workspaceId);
  return loaded?.meta ?? null;
}

interface MetaWithEtag {
  meta: WorkspaceMeta;
  etag: string;
}

async function loadWorkspaceMetaWithEtag(workspaceId: string): Promise<MetaWithEtag | null> {
  if (!isSafeWorkspaceId(workspaceId)) return null;
  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key:    workspaceMetaKey(workspaceId),
    }));
    const body = await res.Body?.transformToString();
    if (!body) return null;
    const meta = JSON.parse(body) as WorkspaceMeta;
    // S3 wraps the ETag in quotes; strip so we can pass it back verbatim
    // (the AWS SDK accepts either form on `IfMatch` but consistency helps).
    const etag = (res.ETag ?? "").replace(/^"|"$/g, "");
    if (!etag) return null;
    return { meta, etag };
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

/**
 * Sentinel returned from a `mutateMeta` mutator to indicate "the current
 * state is already what I want — skip the write entirely". Used so
 * idempotent ops (e.g. `addMember` when the user is already a member)
 * don't pay the cost of a no-op PUT.
 */
export const META_SKIP = Symbol("workspace.meta.skip");

type Mutator = (meta: WorkspaceMeta) => void | typeof META_SKIP;

const META_MAX_ATTEMPTS = 5;

/**
 * Compare-and-swap on a workspace's `_meta.json`. Loads → mutates → writes
 * with `If-Match: <etag>`. Retries with jittered backoff on 412 (concurrent
 * writer beat us). Throws after META_MAX_ATTEMPTS attempts.
 *
 * The mutator is called with the freshly loaded copy each attempt — it
 * must be idempotent and side-effect-free relative to its first call.
 */
async function mutateMeta(
  workspaceId: string,
  mutator: Mutator,
): Promise<WorkspaceMeta> {
  for (let attempt = 0; attempt < META_MAX_ATTEMPTS; attempt++) {
    const loaded = await loadWorkspaceMetaWithEtag(workspaceId);
    if (!loaded) throw new AuthError(404, "Workspace not found");

    const result = mutator(loaded.meta);
    if (result === META_SKIP) return loaded.meta;

    loaded.meta.updatedAt = new Date().toISOString();

    try {
      await s3.send(new PutObjectCommand({
        Bucket:      BUCKET,
        Key:         workspaceMetaKey(workspaceId),
        Body:        JSON.stringify(loaded.meta),
        ContentType: "application/json",
        IfMatch:     loaded.etag,
      }));
      return loaded.meta;
    } catch (err) {
      if (!isPreconditionFailed(err)) throw err;
      // Jittered backoff: 50ms, 100ms, 150ms, 200ms, 250ms (+0-50ms jitter)
      await sleep(50 * (attempt + 1) + Math.random() * 50);
    }
  }
  throw new Error(`Workspace meta CAS gave up after ${META_MAX_ATTEMPTS} attempts (workspace=${workspaceId})`);
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

  // Unconditional write — the workspace id is server-generated and unique,
  // so there's no contention here.
  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         workspaceMetaKey(meta.id),
    Body:        JSON.stringify(meta),
    ContentType: "application/json",
  }));

  await addToUserIndex(input.ownerId, { id, role: "owner", joinedAt: now });
  return meta;
}

// ── Group binding (LINE group ↔ workspace id) ────────────────────────────

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

/**
 * Atomically claim the binding for a LINE group → workspace id. Returns
 * true if our claim won; false if a concurrent write got there first.
 * Uses `If-None-Match: "*"` so two simultaneous webhook events on a fresh
 * group can't both succeed.
 */
async function tryClaimGroupBinding(
  lineGroupId: string,
  workspaceId: string,
): Promise<boolean> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket:       BUCKET,
      Key:          groupBindingKey(lineGroupId),
      Body:         JSON.stringify({ workspaceId }),
      ContentType:  "application/json",
      IfNoneMatch:  "*",
    }));
    return true;
  } catch (err) {
    if (isPreconditionFailed(err)) return false;
    throw err;
  }
}

/**
 * Create a workspace bound to a LINE group, or return the existing one if
 * one is already bound. Atomic: two simultaneous calls produce one
 * canonical workspace; the loser of the race leaks a `_meta.json` (and
 * one user-index entry) but its id never appears in any binding so no
 * file ever lands in it. Acceptable for Phase 1; a sweep script can
 * clean orphan workspaces later if rates warrant.
 */
export async function createGroupWorkspace(opts: {
  lineGroupId: string;
  ownerId: string;
  name?: string;
}): Promise<WorkspaceMeta> {
  // Fast path — cheap GET, avoids creating a workspace we'll throw away.
  const existing = await findWorkspaceByLineGroup(opts.lineGroupId);
  if (existing) return existing;

  // Create our candidate workspace, then race to claim the binding.
  const candidate = await createWorkspace({
    name:        opts.name ?? "Untitled Workspace",
    ownerId:     opts.ownerId,
    lineGroupId: opts.lineGroupId,
  });

  const won = await tryClaimGroupBinding(opts.lineGroupId, candidate.id);
  if (won) return candidate;

  // We lost the claim — re-read the canonical workspace and use it.
  console.warn(
    `[workspace] lost group-binding race for ${opts.lineGroupId}; ` +
    `our candidate ${candidate.id} is now orphaned`,
  );
  const canonical = await findWorkspaceByLineGroup(opts.lineGroupId);
  if (canonical) return canonical;

  // Pathological: we lost the claim but the canonical binding now fails
  // to resolve (deleted between our PUT and our re-read?). Return our
  // own candidate as a fallback rather than throwing — the user's
  // upload still has somewhere to land.
  return candidate;
}

// ── Member management (CAS-backed) ────────────────────────────────────────

export function addMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole = "member",
): Promise<WorkspaceMeta> {
  return withLock(metaLocks, workspaceId, async () => {
    const meta = await mutateMeta(workspaceId, (m) => {
      if (m.members.some((mem) => mem.userId === userId)) return META_SKIP;
      m.members.push({ userId, role, joinedAt: new Date().toISOString() });
    });
    // Side-channel — runs after the meta commit succeeds. Has its own
    // lock; can lag the meta by a few ms.
    const entry = meta.members.find((mem) => mem.userId === userId);
    if (entry) {
      await addToUserIndex(userId, { id: workspaceId, role: entry.role, joinedAt: entry.joinedAt });
    }
    return meta;
  });
}

export function removeMember(workspaceId: string, userId: string): Promise<WorkspaceMeta> {
  return withLock(metaLocks, workspaceId, async () => {
    const meta = await mutateMeta(workspaceId, (m) => {
      if (m.ownerId === userId) {
        throw new AuthError(400, "Cannot remove the workspace owner");
      }
      const before = m.members.length;
      m.members = m.members.filter((mem) => mem.userId !== userId);
      if (m.members.length === before) return META_SKIP;
    });
    await removeFromUserIndex(userId, workspaceId);
    return meta;
  });
}

export function renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceMeta> {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) throw new AuthError(400, "Workspace name cannot be empty");
  return withLock(metaLocks, workspaceId, () =>
    mutateMeta(workspaceId, (m) => {
      if (m.name === trimmed) return META_SKIP;
      m.name = trimmed;
    }),
  );
}

export function markOrphaned(workspaceId: string): Promise<WorkspaceMeta | null> {
  return withLock(metaLocks, workspaceId, async () => {
    try {
      return await mutateMeta(workspaceId, (m) => {
        if (m.orphaned) return META_SKIP;
        m.orphaned = true;
      });
    } catch (err) {
      // markOrphaned shouldn't fail loudly if the workspace is already
      // gone — we're trying to clean up state, not block.
      if (err instanceof AuthError && err.statusCode === 404) return null;
      throw err;
    }
  });
}

/**
 * Inverse of markOrphaned. Called when the bot is re-added to a group whose
 * workspace was previously marked orphaned (bot was kicked / self-left via
 * the kick command). Without this, every subsequent message in the group
 * trips the "workspace is no longer linked" warning at route.ts ~824.
 */
export function unmarkOrphaned(workspaceId: string): Promise<WorkspaceMeta | null> {
  return withLock(metaLocks, workspaceId, async () => {
    try {
      return await mutateMeta(workspaceId, (m) => {
        if (!m.orphaned) return META_SKIP;
        m.orphaned = false;
      });
    } catch (err) {
      if (err instanceof AuthError && err.statusCode === 404) return null;
      throw err;
    }
  });
}

// ── Folder permission lookup ──────────────────────────────────────────────

/**
 * Read a workspace folder's permission mode from its folder-meta JSON.
 * Returns `DEFAULT_FOLDER_MODE` ("upload") when:
 *   - the folder-meta file doesn't exist (legacy folder, missing key)
 *   - the JSON is malformed
 *   - the `permissions.mode` field is absent or an unrecognized value
 *
 * Workspace inbox files don't have a folder id — callers should treat them
 * as `upload` mode without calling this function.
 */
export async function getFolderPermission(
  workspaceId: string,
  folderId: string,
): Promise<FolderMode> {
  if (!isSafeWorkspaceId(workspaceId) || !isSafeFolderId(folderId)) {
    return DEFAULT_FOLDER_MODE;
  }
  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key:    workspaceFolderMetaKey(workspaceId, folderId),
    }));
    const body = await res.Body?.transformToString();
    if (!body) return DEFAULT_FOLDER_MODE;
    const meta = JSON.parse(body) as { permissions?: { mode?: unknown } };
    const mode = meta?.permissions?.mode;
    return isFolderMode(mode) ? mode : DEFAULT_FOLDER_MODE;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "NoSuchKey") return DEFAULT_FOLDER_MODE;
    // Anything else (network, transient S3) → fail closed-ish: return the
    // default. We never want a permission lookup to throw and break uploads.
    console.warn(`[workspace] getFolderPermission(${workspaceId}, ${folderId}) failed; defaulting:`, err);
    return DEFAULT_FOLDER_MODE;
  }
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

// ── Cascade delete ─────────────────────────────────────────────────────────

/**
 * Permanently delete an entire workspace and everything tied to it:
 *   - every object under `workspaces/{id}/` (files, folder-meta, search
 *     index, invite records, `_meta.json`)
 *   - the reverse invite bindings at `invite-bindings/{token}.json`
 *   - the `group-bindings/{lineGroupId}.json` binding (if group-bound)
 *   - the workspace entry in every member's `_workspaces.json`
 *
 * Caller MUST gate with `requireWorkspaceAccess(userId, id, "owner")` first.
 * Best-effort and idempotent — re-running on a half-deleted workspace is safe.
 */
export async function deleteWorkspaceCascade(
  workspaceId: string,
): Promise<{ deletedObjects: number }> {
  if (!isSafeWorkspaceId(workspaceId)) {
    throw new AuthError(400, "Invalid workspaceId");
  }

  // Load meta first to capture members + lineGroupId before we wipe it.
  const meta = await loadWorkspaceMeta(workspaceId);

  // 1. Delete reverse invite bindings (they live OUTSIDE the workspace prefix).
  try {
    const inviteTokens: string[] = [];
    let inviteCont: string | undefined;
    do {
      const list = await s3.send(new ListObjectsV2Command({
        Bucket:            BUCKET,
        Prefix:            workspaceInvitesPrefix(workspaceId),
        ContinuationToken: inviteCont,
      }));
      for (const o of list.Contents ?? []) {
        if (o.Key?.endsWith(".json")) {
          inviteTokens.push(o.Key.split("/").pop()!.replace(".json", ""));
        }
      }
      inviteCont = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (inviteCont);

    await Promise.all(inviteTokens.map((t) =>
      s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: inviteBindingKey(t) }))
        .catch(() => undefined),
    ));
  } catch (err) {
    console.warn(`[workspace] invite-binding cleanup failed for ${workspaceId}:`, err);
  }

  // 2. Delete the group binding (if any).
  if (meta?.lineGroupId) {
    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key:    groupBindingKey(meta.lineGroupId),
    })).catch(() => undefined);
  }

  // 3. Delete every object under workspaces/{id}/ in 1000-key batches.
  const objectKeys: { Key: string }[] = [];
  let cont: string | undefined;
  do {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket:            BUCKET,
      Prefix:            workspacePrefix(workspaceId),
      ContinuationToken: cont,
    }));
    for (const o of list.Contents ?? []) {
      if (o.Key) objectKeys.push({ Key: o.Key });
    }
    cont = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (cont);

  let deletedObjects = 0;
  for (let i = 0; i < objectKeys.length; i += 1000) {
    const batch = objectKeys.slice(i, i + 1000);
    const res = await s3.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: batch, Quiet: true },
    }));
    deletedObjects += batch.length - (res.Errors?.length ?? 0);
    if (res.Errors?.length) {
      console.warn(`[workspace] cascade delete batch errors for ${workspaceId}:`, res.Errors);
    }
  }

  // 4. Remove the workspace from each member's per-user index.
  if (meta) {
    await Promise.all(meta.members.map((m) =>
      removeFromUserIndex(m.userId, workspaceId).catch(() => undefined),
    ));
  }

  return { deletedObjects };
}
