# Workspace Auto-Join Fix — Testing Guide

## What was fixed

**Problem:** Users in a LINE group couldn't access workspace files in LIFF unless they had previously uploaded a file.

**Root cause:** Membership was only added on file upload, not on read/view operations.

**Solution (hybrid):**

1. **Webhook:** Auto-add members on ANY group activity (not just uploads)
   - Changed: `route.ts:1155` comment from "first upload" → "any group activity"
   - Effect: Active users (sending messages, using commands) now auto-added

2. **LIFF API:** Auto-join on workspace access attempts
   - New: `lib/workspace-access.ts` — `ensureWorkspaceMember()`
   - Applied to: `/api/files`, `/api/search`, `/api/folders`, `/api/upload`, `/api/ask`
   - Effect: Lurkers/readers clicking bubbles auto-added on first API call

## Files changed

```
lib/workspace-access.ts          ← new helper
app/api/line/webhook/route.ts    ← webhook auto-add (any activity)
app/api/files/route.ts            ← LIFF auto-join
app/api/search/route.ts           ← LIFF auto-join
app/api/folders/route.ts          ← LIFF auto-join
app/api/upload/route.ts           ← LIFF auto-join
app/api/ask/route.ts              ← LIFF auto-join
```

## Test cases

### Test 1: New member clicks bubble (lurker scenario)
1. Add bot to a LINE group
2. User A uploads a file → gets workspace created + bubble sent to group
3. User B (never sent anything in group) clicks the bubble
4. **Expected:** User B auto-added, sees files ✅
5. **Before fix:** 403 Forbidden ❌

### Test 2: New member sends message first
1. User C joins the group
2. User C sends any text message in the group
3. User C clicks a file bubble
4. **Expected:** User C auto-added on message, bubble works ✅

### Test 3: Non-group workspace (security check)
1. Create a manual workspace (not bound to LINE group)
2. User tries to access it via API
3. **Expected:** Still requires explicit invite, NO auto-join ✅
4. **Why:** `ensureWorkspaceMember` checks `meta.lineGroupId` — only group workspaces auto-join

### Test 4: Upload from LIFF web (not webhook)
1. User clicks bubble, opens LIFF
2. User uploads via the web FAB (not LINE message)
3. **Expected:** Works (user was auto-added on bubble click) ✅

## How to verify in production

```bash
# 1. Check workspace members before/after
curl -H "Authorization: Bearer $LIFF_TOKEN" \
  "https://your-domain/api/workspaces/ws_xxxxx/members"

# 2. Watch logs for auto-add events
vercel logs --follow

# 3. Test in a real LINE group
# - Create test group
# - Add bot
# - Upload file as User A
# - Click bubble as User B (fresh member)
# - Should work without 403
```

## Rollback (if needed)

```bash
git revert HEAD  # reverts all 7 files
npm run build
vercel --prod
```

## Technical notes

- `ensureWorkspaceMember()` is **idempotent** — safe to call multiple times
- `addMember()` already has `META_SKIP` — no-op if user already exists
- Zero new dependencies (stdlib only, ponytail-compliant)
- Works for Thai + English users (no i18n changes needed)
