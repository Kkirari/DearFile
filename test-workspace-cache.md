# Workspace Cache Fix - Manual Test Checklist

## Setup
You need:
- 2 LINE accounts (A & B)
- 2 LINE groups (Group 1 & Group 2)
- DearFile bot added to both groups

## Test 1: Workspace switching shows correct previews ✓

**Steps:**
1. As User A: Upload 3 images to Group 1
2. As User A: Upload 2 PDFs to Group 2
3. In LIFF: Open Group 1 workspace
   - **Expected:** See 3 thumbnails in Inbox preview
4. Switch to Group 2 workspace
   - **Expected:** See 2 thumbnails (PDFs or placeholder icons)
   - **Bug (before fix):** Would still show Group 1's 3 images ❌

**Pass criteria:** Thumbnails and counts update immediately on workspace switch

## Test 2: Upload updates count immediately ✓

**Steps:**
1. In LIFF: View Group 1 workspace home
2. Note the Inbox file count (e.g., "3 files")
3. Via LINE chat: Upload 1 more image to Group 1
4. Back in LIFF: Pull down to refresh home screen
   - **Expected:** Count now shows "4 files", new thumbnail visible
   - **Bug (before fix):** Count stays "3 files" until app restart ❌

**Pass criteria:** Count and thumbnails reflect new upload

## Test 3: Delete updates count immediately ✓

**Steps:**
1. In LIFF Group 1 workspace: Open Inbox
2. Delete 1 file
3. Go back to home screen
   - **Expected:** Count decreases by 1, deleted file's thumbnail gone
   - **Bug (before fix):** Count unchanged, deleted file still in preview ❌

**Pass criteria:** Preview updates after delete

## Test 4: Personal workspace unaffected ✓

**Steps:**
1. Switch to "Personal" (no workspace)
2. Upload 2 files to personal DM
3. Switch to Group 1
4. Switch back to Personal
   - **Expected:** See your 2 personal files
   - **Bug check:** Shouldn't see group files ✓

**Pass criteria:** Personal cache separate from workspace cache

## Test 5: Cache invalidation on folder operations ✓

**Steps:**
1. In Group 1: Create a new folder "Test Folder"
2. Move 2 files into it
3. Go to home screen
   - **Expected:** "Test Folder" shows "2" count badge
   - **Bug (before fix):** Shows "0" until refresh ❌

**Pass criteria:** Folder count updates immediately

## Quick smoke test (30 seconds)

```bash
# If you want to verify the fix is in the build:
grep -n "currentWorkspaceId" hooks/use-folder-previews.ts
# Should show line with: }, [fetchPreviews, refreshKey, currentWorkspaceId]);

grep -n "ws:\${" app/api/files/route.ts
# Should show multiple lines with: invalidatePreviews(... ? `ws:${...}` : userId)
```

## What to look for

✅ **Good signs:**
- Counts/thumbnails update within 1-2 seconds
- Switching workspaces shows correct data immediately
- No need to force-refresh or restart app

❌ **Bad signs:**
- Stale counts after operations
- Wrong workspace's thumbnails showing
- Need to close/reopen LIFF to see updates

## If test fails

Check browser console for errors:
```
[useFolderPreviews] ...  ← fetch errors
403 Forbidden            ← auth issue (separate bug)
```

Check Vercel logs:
```bash
vercel logs --follow | grep -E "(preview|invalidate)"
```
