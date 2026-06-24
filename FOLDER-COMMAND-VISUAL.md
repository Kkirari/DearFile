# 📁 Folder Creation Command – Visual Examples

## What Users See in LINE

### Example 1: Thai Command in Group Chat

**User sends:**
```
!น้องกวาง สร้างโฟลเดอร์ รูปเดินทาง
```

**Bot replies with Flex bubble:**
```
╔═══════════════════════════════════╗
║                                   ║
║   ✓  สร้างโฟลเดอร์แล้ว            ║  <- Purple check + bold
║                                   ║
║   📁 รูปเดินทาง                    ║  <- Folder name (bold)
║   ใน My Workspace                 ║  <- Workspace name (muted)
║                                   ║
║  ┌─────────────────────────────┐  ║
║  │ เปิดโฟลเดอร์ / Open Folders │  ║  <- Purple button
║  └─────────────────────────────┘  ║
║                                   ║
╚═══════════════════════════════════╝
```

### Example 2: English Command

**User sends:**
```
!dearfile create folder ProjectDocs
```

**Bot replies with same bubble:**
```
╔═══════════════════════════════════╗
║                                   ║
║   ✓  สร้างโฟลเดอร์แล้ว            ║
║                                   ║
║   📁 ProjectDocs                  ║
║   ใน Team Workspace               ║
║                                   ║
║  ┌─────────────────────────────┐  ║
║  │ เปิดโฟลเดอร์ / Open Folders │  ║
║  └─────────────────────────────┘  ║
║                                   ║
╚═══════════════════════════════════╝
```

### Example 3: Non-Owner Tries to Create

**Non-owner user sends:**
```
!น้องกวาง สร้างโฟลเดอร์ TestFolder
```

**Bot replies with plain text:**
```
🔒 เฉพาะเจ้าของพื้นที่เท่านั้นที่สร้างโฟลเดอร์ได้
Only the workspace owner can create folders.
```

## Bubble Color Palette

The bubble follows DearFile's warm, earthy design system:

- **Background**: Cream `#fbfaf6` (warm near-white)
- **Check mark**: Mauve `#9b869c` (brand purple)
- **Primary text**: Dark warm brown `#4a4036`
- **Secondary text**: Taupe `#b0a396` (muted)
- **Button**: Mauve `#9b869c` with white text

## Button Behavior

Tapping "เปิดโฟลเดอร์ / Open Folders" opens the LIFF app with:
```
https://liff.line.me/{LIFF_ID}?ws={workspaceId}&tab=folders
```

This deep-links directly to the Folders tab in the correct workspace.

## Real LINE Comparison

This bubble is styled identically to the existing `uploadSuccessBubble`:

**Upload Success:**
```
╔═══════════════════════════════════╗
║   ✓  invoice.pdf                  ║
║   📁 ใบเสร็จ                       ║
║  ┌─────────────────────────────┐  ║
║  │ เปิด / Open                  │  ║
║  └─────────────────────────────┘  ║
╚═══════════════════════════════════╝
```

**Folder Created (NEW):**
```
╔═══════════════════════════════════╗
║   ✓  สร้างโฟลเดอร์แล้ว            ║
║   📁 ใบเสร็จ                       ║
║   ใน My Workspace                 ║
║  ┌─────────────────────────────┐  ║
║  │ เปิดโฟลเดอร์ / Open Folders │  ║
║  └─────────────────────────────┘  ║
╚═══════════════════════════════════╝
```

Both use the same layout, colors, and interaction pattern for consistency.

## Mobile LINE App Preview

On iOS/Android LINE app, the bubble appears as a card that:
- Takes ~80% of chat width
- Has soft rounded corners
- Has subtle drop shadow
- Button is tappable with native haptic feedback
- Scrolls smoothly with chat history

## Testing in LINE

1. Add DearFile bot to a LINE group
2. Send: `!น้องกวาง สร้างโฟลเดอร์ TestFolder`
3. Verify bubble appears (not plain text)
4. Tap button → LIFF opens to Folders tab
5. See new folder in the list

## Alternative Command Examples

All these work identically:

```
!น้องกวาง สร้างโฟลเดอร์ รูปแมว
@น้องกวาง สร้างโฟเดอ เอกสาร
/น้องกวาง โฟลเดอร์ การบ้าน
!dearfile create folder Photos
/folder Documents
```

They all produce the same beautiful Flex bubble! 🎉
