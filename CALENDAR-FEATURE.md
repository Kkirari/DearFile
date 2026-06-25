# Calendar Feature - Testing Guide

## ✅ Completed: Phase 1 - LINE Reminder System

### What Was Built

1. **Natural Language Parsing** (`lib/calendar.ts`)
   - Claude Haiku parses Thai/English calendar commands
   - Flexible formats: "เพิ่มปฎิทินวันที่ 6 เดือน7ว่า เดทไลน์อาจารย์โอม"
   - Extracts: title, date, time, description
   - Default: 9:00 AM ICT if no time specified

2. **Database** (`db/migrations/0007_calendar_events.sql`)
   - Table: `calendar_events`
   - Fields: title, description, event_date, event_time, remind_at, status
   - Indexed for fast user/cron queries

3. **Cron Job** (`app/api/cron/calendar-reminders/route.ts`)
   - Runs every 10 minutes (`*/10 * * * *`)
   - Sends LINE push on reminder time
   - Marks events as 'sent' after delivery

4. **LINE Integration** (`app/api/line/webhook/route.ts`)
   - Parses calendar commands in DM only
   - Group chat: polite error message
   - Sends confirmation bubble with "เปิดปฏิทิน" button

5. **LIFF Calendar Tab** (`components/screens/calendar-tab.tsx`)
   - Simple list view grouped by "today", "tomorrow", "future"
   - Tap event → detail sheet with delete option
   - Empty state with helpful message

6. **LINE Flex Bubbles** (`lib/line.ts`)
   - `calendarEventCreatedBubble()` — green checkmark confirmation
   - `calendarReminderBubble()` — 🔔 bell emoji push notification

## Testing Steps

### 1. Run Migration

```bash
npm run db:migrate
```

Verify the `calendar_events` table exists in Neon.

### 2. Local Testing (Optional)

```bash
npm run dev
```

Use ngrok to expose webhook, update LINE Console webhook URL.

### 3. Deploy to Vercel

```bash
git push origin main
```

Wait for deployment to complete.

### 4. Test Commands in LINE DM

**Thai with date only:**
```
!น้องกวาง เพิ่มปฎิทินวันที่ 30 มิถุนายนว่า ทดสอบระบบ
```
Expected: Confirmation bubble, event saved with 9:00 AM default time.

**Thai with date and time:**
```
!น้องกวาง ตั้งเตือน 1 ก.ค. เวลา 14:30 ว่า ประชุมทีม
```
Expected: Confirmation bubble, event saved with 14:30 time.

**English:**
```
!dearfile add calendar July 6 at 3pm team meeting
```
Expected: Confirmation bubble.

### 5. Test Group Chat Protection

Send a calendar command in a LINE group:
```
!น้องกวาง เพิ่มปฎิทิน...
```
Expected: "📅 ปฏิทินใช้ได้เฉพาะแชทส่วนตัวนะ..."

### 6. Test LIFF Calendar Tab

1. Open DearFile LIFF
2. Tap Calendar tab (📅)
3. Verify events appear grouped by date
4. Tap an event → detail sheet opens
5. Try deleting an event

### 7. Test Cron Job

**Option A: Wait for natural trigger**
- Create event with remind_at = current time + 5 minutes
- Wait 10 minutes (next cron run)
- Check if LINE push arrives

**Option B: Manual trigger**
```bash
curl "https://your-domain.vercel.app/api/cron/calendar-reminders?token=YOUR_ADMIN_TOKEN"
```

Check Vercel logs for execution.

### 8. Verify Cron Registration

```bash
vercel cron ls
```

Should show:
- `/api/cron/daily-summary` — `0 13 * * *`
- `/api/cron/calendar-reminders` — `*/10 * * * *`

## Edge Cases to Test

1. **Past date** → Should be rejected (returns null from parser)
2. **Invalid date** (e.g., "วันที่ 32") → Parsing fails, no event created
3. **Very long title** → Truncated to 100 chars
4. **No title extracted** → Parser returns null, no event created
5. **Event already sent** → Status = 'sent', won't be picked up by cron again

## Known Limitations (Phase 1)

- ❌ No recurring events (one-time only)
- ❌ No Google Calendar sync
- ❌ No advance notice ("remind 1 day before")
- ❌ No edit functionality (delete + recreate only)
- ❌ Calendar command doesn't work in groups (by design)

## Environment Variables Needed

Already in your .env.local (no new vars needed):
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `DATABASE_URL` (Neon Postgres)
- `ANTHROPIC_API_KEY` or user BYOK
- `CRON_SECRET` (Vercel)
- `ADMIN_TOKEN` (for manual cron trigger)

## Debugging

### Check Database
```sql
SELECT * FROM calendar_events WHERE user_id = 'YOUR_USER_ID' ORDER BY created_at DESC;
```

### Check Cron Logs
Go to Vercel Dashboard → Logs → filter by `/api/cron/calendar-reminders`

### Check LINE Push
If reminder didn't arrive:
1. Check cron ran (Vercel logs)
2. Check event status changed to 'sent' (database)
3. Check LINE API errors in logs

## Next Steps: Phase 2 (Future)

- [ ] Google Calendar OAuth flow
- [ ] Token storage (encrypted)
- [ ] Sync to Google Calendar after creation
- [ ] Edit event functionality
- [ ] Recurring events support

---

**Commit:** `a94a16a`  
**Files changed:** 16  
**Lines added:** ~1,750
