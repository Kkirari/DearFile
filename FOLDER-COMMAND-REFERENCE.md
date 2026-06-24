# 📁 Quick Reference: Create Folders in LINE

## For Users (Thai)

### คำสั่งสร้างโฟลเดอร์

ใช้คำสั่งนี้ในกลุ่ม LINE:

```
!น้องกวาง สร้างโฟลเดอร์ ชื่อโฟลเดอร์
```

**ตัวอย่าง:**
```
!น้องกวาง สร้างโฟลเดอร์ รูปเดินทาง
!น้องกวาง สร้างโฟเดอ เอกสารงาน
@น้องกวาง โฟลเดอร์ ใบเสร็จ
```

### หมายเหตุ
- ✅ ใช้ได้เฉพาะเจ้าของพื้นที่
- ✅ พิมพ์ผิดเล็กน้อยก็ใช้ได้
- ✅ กดปุ่มเพื่อเปิดโฟลเดอร์ใน DearFile

---

## For Users (English)

### Create Folder Command

Use this command in LINE group:

```
!dearfile create folder FolderName
```

**Examples:**
```
!dearfile create folder Travel Photos
@dearfile create folder Work Documents
/folder Receipts
```

### Notes
- ✅ Workspace owner only
- ✅ Works with Thai or English
- ✅ Tap button to open folder in DearFile

---

## For Developers

### Implementation
- **Parser:** `app/api/line/webhook/route.ts::parseFolderCommand()`
- **Handler:** `app/api/line/webhook/route.ts::handleFolderCommand()`
- **Bubble:** `lib/line.ts::folderCreatedBubble()`
- **Tests:** `test-folder-commands.js` (18 tests, all passing)

### Supported Formats
| Format | Example |
|--------|---------|
| Thai full | `!น้องกวาง สร้างโฟลเดอร์ XXX` |
| Thai short | `!น้องกวาง สร้างโฟเดอ XXX` |
| Thai typo | `!น้องกวาง โฟเดอ XXX` |
| English | `!dearfile create folder XXX` |
| Direct | `/folder XXX` |

### Access Control
```typescript
// Owner-only check in handleFolderCommand()
const isOwner = workspace.members.some(
  (m) => m.userId === uploaderId && m.role === "owner"
);
```

### Response
Returns `LineFlexMessage` via `folderCreatedBubble()`:
- Purple check icon + success header
- Folder name + workspace name
- Button → `liffUrl({ ws, tab: "folders" })`

---

## Quick Test

```bash
# Run parser tests
node test-folder-commands.js

# Expected output: 18/18 passed ✅
```

---

## Troubleshooting

**Q: Command doesn't work**
- Check you're the workspace owner
- Try a simpler format: `/folder TestFolder`
- Ensure bot is in the group

**Q: No bubble appears**
- Check LINE webhook logs
- Verify LIFF_ID environment variable
- Test with upload first (known working)

**Q: Button doesn't open LIFF**
- Check NEXT_PUBLIC_LIFF_ID is set
- Verify LIFF endpoint registered in LINE Console
- Try opening LIFF manually first

---

**Status:** ✅ Feature complete and tested  
**Build:** ✅ Compiles successfully  
**Tests:** ✅ 18/18 passing  
**Ready:** 🚀 Ready for production
