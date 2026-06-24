# Folder Creation Command – Testing Guide

## Feature Overview

Users can now create folders in DearFile directly from LINE chat (1-on-1 or group) using natural language commands. The bot replies with a styled Flex Message confirmation bubble.

## Supported Command Formats

### Thai Commands
```
!น้องกวาง สร้างโฟลเดอร์ โปรเจกต์A
!น้องกวาง โฟลเดอร์ รูปแมว
@น้องกวาง สร้างโฟเดอ การบ้าน
/น้องกวาง สร้างโฟลเด่อ ใบเสร็จ
```

### English Commands
```
!dearfile create folder ProjectA
@dearfile create folder Photos
/dearfile create folder Receipts
```

### Direct Commands (no sigil)
```
/folder MyFolder
/new folder Documents
```

## Command Parsing Features

1. **Flexible sigils**: Accepts `!`, `@`, `/` or none
2. **Bot trigger**: Recognizes both `น้องกวาง` (Thai) and `dearfile` (English)
3. **Thai typo tolerance**: Handles common Thai typos like:
   - `สร้างโฟเดอ` (missing ล/ร)
   - `สร้างโฟลเด่อ` (wrong tone mark)
   - `โฟลเดอร์` (direct folder word)
4. **80-char limit**: Folder names are auto-trimmed to 80 characters max

## Access Control

- **Owner-only**: Only the workspace owner can create folders
- **Auto-membership**: Users are automatically added to workspace on first message
- **Non-owner response**: Returns a friendly access-denied message in Thai + English

## User Experience Flow

### In LINE Group
1. User sends: `!น้องกวาง สร้างโฟลเดอร์ รูปแมว`
2. Bot checks:
   - Is workspace created? (auto-creates if needed)
   - Is sender a member? (auto-adds if needed)
   - Is sender the owner?
3. Bot creates folder in S3: `workspaces/{ws_id}/folder-meta/{uuid}.json`
4. Bot replies with Flex Message bubble:
   - ✓ Check icon in brand purple
   - Folder name + workspace name
   - "เปิดโฟลเดอร์ / Open Folders" button → LIFF

### In 1-on-1 Chat
Same commands work but won't create folders (1-on-1 = personal storage, folders are workspace-only).

## Response Bubble Design

Based on DearFile's existing bubble style (`uploadSuccessBubble`):

```
┌─────────────────────────┐
│ ✓  สร้างโฟลเดอร์แล้ว     │ (purple check + bold header)
│                         │
│ 📁 รูปแมว                │ (folder name)
│ ใน My Workspace         │ (workspace name, muted)
│                         │
│ ┌─────────────────────┐ │
│ │ เปิดโฟลเดอร์ / Open  │ │ (purple button)
│ └─────────────────────┘ │
└─────────────────────────┘
```

Colors match `lib/line.ts` constants:
- BRAND_MAUVE: `#9b869c` (buttons, check icon)
- CARD_CREAM: `#fbfaf6` (bubble background)
- TEXT_DARK_WARM: `#4a4036` (primary text)
- TEXT_TAUPE: `#b0a396` (secondary text)

## Testing Checklist

### LINE Group Testing
- [ ] Send `!น้องกวาง สร้างโฟลเดอร์ TestFolder`
- [ ] Verify Flex bubble appears (not plain text)
- [ ] Click "เปิดโฟลเดอร์" button → opens LIFF on Folders tab
- [ ] Check folder appears in LIFF app
- [ ] Try Thai typo: `!น้องกวาง สร้างโฟเดอ TestFolder2`
- [ ] Try English: `!dearfile create folder TestFolder3`
- [ ] Try as non-owner → verify access-denied message
- [ ] Try 100-char name → verify auto-trim to 80

### 1-on-1 Chat Testing
- [ ] Ensure commands don't crash (should ignore or handle gracefully)

### Edge Cases
- [ ] Empty folder name after command → no response (returns null)
- [ ] Command with only spaces → no response
- [ ] Very long Thai folder name → truncates in bubble display
- [ ] Concurrent folder creation → S3 meta handles via workspace.ts

## Files Modified

1. **`app/api/line/webhook/route.ts`**
   - Added `parseFolderCommand()` – flexible parser for all command formats
   - Updated `handleFolderCommand()` – now calls `folderCreatedBubble()`
   - Added import for `folderCreatedBubble`

2. **`lib/line.ts`**
   - Added `folderCreatedBubble()` – Flex Message factory
   - Updated `examplesBubble()` – cleaner folder creation example text

## Deployment Notes

- No env var changes needed
- No database migration needed (folders live in S3)
- No LINE Console changes needed (webhook already registered)
- Feature works immediately after deploy

## Example LINE Commands for Demo

```bash
# Basic Thai
!น้องกวาง สร้างโฟลเดอร์ รูปเดินทาง

# Typo variant
!น้องกวาง สร้างโฟเดอ เอกสารงาน

# English
!dearfile create folder ProjectDocs

# Direct (no bot name)
/folder Receipts

# With @ sigil
@น้องกวาง สร้างโฟลเดอร์ ใบเสร็จ
```

## Success Criteria

✅ All command formats create folders correctly  
✅ Flex bubble displays with correct styling  
✅ Button opens LIFF to Folders tab  
✅ Owner-only enforcement works  
✅ Thai + English both supported  
✅ No LINE webhook errors (check logs)  
✅ Folder appears in LIFF app immediately

## Rollback Plan

If issues arise, revert these two commits:
1. Restore `app/api/line/webhook/route.ts` to previous `handleFolderCommand()`
2. Remove `folderCreatedBubble()` from `lib/line.ts`

Previous behavior: plain text response for `/folder Name` only.
