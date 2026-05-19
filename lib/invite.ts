/**
 * Workspace invite tokens — Phase 2 magic-link sharing.
 *
 * One owner-generated token can be redeemed by many users (multi-use)
 * until it expires or gets revoked. Each token is stored two ways:
 *
 *   workspaces/{wsid}/invites/{token}.json   — canonical record
 *   invite-bindings/{token}.json             — reverse lookup
 *
 * The reverse-lookup lets the accept endpoint find the workspace from
 * just the token (the LIFF accept URL only carries the token; we don't
 * want the workspace id in the URL).
 *
 * Cross-instance safety:
 *   - Creation writes the binding first with `If-None-Match: "*"` so
 *     two simultaneous creates with the same token (vanishingly rare
 *     with 128 bits of entropy) can't clobber each other.
 *   - Revoke flips `revoked: true` in the invite record AND deletes the
 *     binding so future accepts get a clean 404. validateInvite re-reads
 *     the canonical record each call, so a concurrent revoke is seen by
 *     the next accept.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import crypto from "crypto";
import {
  s3,
  BUCKET,
  inviteBindingKey,
  isSafeInviteToken,
  workspaceInviteKey,
  workspaceInvitesPrefix,
} from "./s3";
import { AuthError } from "./auth";

const DEFAULT_TTL_DAYS = 7;
const MAX_TTL_DAYS = 90;

export interface InviteRecord {
  token: string;
  workspaceId: string;
  role: "member";       // future: viewer / owner-on-accept
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  revoked: boolean;
  useCount: number;
}

function newToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

function isPreconditionFailed(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "PreconditionFailed" || e.$metadata?.httpStatusCode === 412;
}

// ── Create ────────────────────────────────────────────────────────────────

export interface CreateInviteInput {
  workspaceId: string;
  createdBy: string;
  ttlDays?: number;     // null = honor default; numeric > 0 = explicit; 0 = no expiry
}

export async function createInvite(input: CreateInviteInput): Promise<InviteRecord> {
  const token = newToken();
  const now = new Date();
  const ttl =
    input.ttlDays === undefined ? DEFAULT_TTL_DAYS
    : input.ttlDays === 0 ? null
    : Math.min(Math.max(1, input.ttlDays), MAX_TTL_DAYS);

  const expiresAt = ttl === null
    ? null
    : new Date(now.getTime() + ttl * 24 * 60 * 60 * 1000).toISOString();

  const record: InviteRecord = {
    token,
    workspaceId: input.workspaceId,
    role:        "member",
    createdBy:   input.createdBy,
    createdAt:   now.toISOString(),
    expiresAt,
    revoked:     false,
    useCount:    0,
  };

  // Write the binding FIRST with If-None-Match — guards against the
  // (vanishingly rare) token collision. If that succeeds we can safely
  // write the canonical record.
  try {
    await s3.send(new PutObjectCommand({
      Bucket:       BUCKET,
      Key:          inviteBindingKey(token),
      Body:         JSON.stringify({ workspaceId: input.workspaceId }),
      ContentType:  "application/json",
      IfNoneMatch:  "*",
    }));
  } catch (err) {
    if (isPreconditionFailed(err)) {
      // Astronomically unlikely; surface as a 500 so the client can retry.
      throw new Error("Invite token collision — please retry");
    }
    throw err;
  }

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         workspaceInviteKey(input.workspaceId, token),
    Body:        JSON.stringify(record),
    ContentType: "application/json",
  }));

  return record;
}

// ── List (owner UI) ───────────────────────────────────────────────────────

export async function listInvites(workspaceId: string): Promise<InviteRecord[]> {
  const { Contents = [] } = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: workspaceInvitesPrefix(workspaceId),
  }));

  const records = await Promise.all(
    Contents
      .filter((obj) => obj.Key?.endsWith(".json"))
      .map(async (obj) => {
        try {
          const res  = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key! }));
          const body = await res.Body?.transformToString();
          if (!body) return null;
          return JSON.parse(body) as InviteRecord;
        } catch {
          return null;
        }
      }),
  );

  return records
    .filter((r): r is InviteRecord => r !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Revoke ────────────────────────────────────────────────────────────────

export async function revokeInvite(workspaceId: string, token: string): Promise<void> {
  if (!isSafeInviteToken(token)) throw new AuthError(400, "Invalid invite token");

  // Update the canonical record (set revoked) — defensive in case the
  // binding delete fails midway.
  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key:    workspaceInviteKey(workspaceId, token),
    }));
    const body = await res.Body?.transformToString();
    if (body) {
      const record = JSON.parse(body) as InviteRecord;
      record.revoked = true;
      await s3.send(new PutObjectCommand({
        Bucket:      BUCKET,
        Key:         workspaceInviteKey(workspaceId, token),
        Body:        JSON.stringify(record),
        ContentType: "application/json",
      }));
    }
  } catch (err: unknown) {
    if ((err as { name?: string }).name !== "NoSuchKey") throw err;
  }

  // Delete the binding so future accepts get a 404.
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key:    inviteBindingKey(token),
    }));
  } catch {
    // best-effort
  }
}

// ── Token resolution + validation ─────────────────────────────────────────

export interface ResolvedInvite {
  workspaceId: string;
  record: InviteRecord;
}

/**
 * Look up a token → workspace and load the canonical invite record.
 * Returns null if either side is missing.
 */
export async function resolveInviteToken(token: string): Promise<ResolvedInvite | null> {
  if (!isSafeInviteToken(token)) return null;

  let workspaceId: string;
  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key:    inviteBindingKey(token),
    }));
    const body = await res.Body?.transformToString();
    if (!body) return null;
    const parsed = JSON.parse(body) as { workspaceId?: string };
    if (!parsed.workspaceId) return null;
    workspaceId = parsed.workspaceId;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }

  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key:    workspaceInviteKey(workspaceId, token),
    }));
    const body = await res.Body?.transformToString();
    if (!body) return null;
    return { workspaceId, record: JSON.parse(body) as InviteRecord };
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

export type InviteValidationError = "revoked" | "expired";

/**
 * Pure validation — does NOT mutate. Returns an error code if the invite
 * is not acceptable, otherwise null.
 */
export function validateInvite(record: InviteRecord): InviteValidationError | null {
  if (record.revoked) return "revoked";
  if (record.expiresAt && record.expiresAt < new Date().toISOString()) return "expired";
  return null;
}

/**
 * Best-effort increment of useCount. Last-writer-wins is acceptable for
 * a stat that's not load-bearing for access decisions.
 */
export async function bumpInviteUseCount(workspaceId: string, token: string): Promise<void> {
  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key:    workspaceInviteKey(workspaceId, token),
    }));
    const body = await res.Body?.transformToString();
    if (!body) return;
    const record = JSON.parse(body) as InviteRecord;
    record.useCount = (record.useCount ?? 0) + 1;
    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         workspaceInviteKey(workspaceId, token),
      Body:        JSON.stringify(record),
      ContentType: "application/json",
    }));
  } catch {
    // best-effort
  }
}
