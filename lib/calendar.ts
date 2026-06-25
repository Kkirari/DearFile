/**
 * Calendar event parsing — natural language → structured event via Claude.
 *
 * Accepts flexible Thai/English commands like:
 *   "เพิ่มปฎิทินวันที่ 6 เดือน7ว่า เดทไลน์อาจารย์โอม"
 *   "add calendar July 6 deadline for Prof. Om"
 *   "นัดหมอ 15 ก.ค. เวลา 14:30"
 *
 * Uses Claude Haiku with structured output for fast, cheap parsing.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "./ask";
import { getUserKeys } from "./byok";

const DEFAULT_CALENDAR_MODEL = "anthropic/claude-haiku-4-5";

export interface CalendarEventParsed {
  title: string;
  description: string | null;
  date: string;      // YYYY-MM-DD
  time: string | null; // HH:MM
}

const CalendarParseSchema = z.object({
  isCalendarCommand: z.boolean(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  date: z.string().nullable(),  // YYYY-MM-DD
  time: z.string().nullable(),  // HH:MM
});

/**
 * ICT (Asia/Bangkok) date string in YYYY-MM-DD format for "today".
 */
function todayICT(): string {
  const now = new Date();
  // Convert to ICT (UTC+7)
  const ict = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return ict.toISOString().split("T")[0];
}

/**
 * Parse a LINE message into a calendar event. Returns null if not a calendar
 * command, or if parsing fails.
 */
export async function parseCalendarCommand(
  text: string,
  userId?: string,
): Promise<CalendarEventParsed | null> {
  const today = todayICT();
  const currentYear = new Date().getFullYear();

  const systemPrompt = `You are a calendar event parser for a Thai/English LINE bot.

Current date: ${today}
Current year: ${currentYear}
User timezone: Asia/Bangkok (ICT, UTC+7)

Parse the user's message into a calendar event. Return isCalendarCommand=false if it's not a calendar/reminder request.

**Trigger phrases:**
Thai: เพิ่มปฎิทิน, เพิ่มปฏิทิน, ตั้งเตือน, เตือนวันที่, นัดวันที่, บันทึกปฏิทิน
English: add calendar, add to calendar, remind me on, set reminder, schedule

**Date formats to recognize:**
- "วันที่ 6 เดือน7" → 2026-07-06
- "15 ก.ค." → 2026-07-15
- "July 6" → 2026-07-06
- "6/7" → 2026-07-06
- "พรุ่งนี้" → (today + 1 day)
- "วันเสาร์หน้า" → (next Saturday)

**Time formats:**
- "เวลา 14:30" → "14:30"
- "2:30pm" → "14:30"
- "บ่ายสอง" → "14:00"
- If no time specified → return null

**Title extraction:**
Everything after "ว่า" / "that" / "for" becomes the title.

**Examples:**
Input: "เพิ่มปฎิทินวันที่ 6 เดือน7ว่า เดทไลน์อาจารย์โอม"
Output: {isCalendarCommand: true, title: "เดทไลน์อาจารย์โอม", date: "2026-07-06", time: null, description: null}

Input: "นัดหมอ 15 ก.ค. เวลา 14:30"
Output: {isCalendarCommand: true, title: "นัดหมอ", date: "2026-07-15", time: "14:30", description: null}

Input: "add calendar July 10 at 3pm team meeting"
Output: {isCalendarCommand: true, title: "team meeting", date: "2026-07-10", time: "15:00", description: null}

Input: "หาไฟล์ใบเสร็จเดือนที่แล้ว"
Output: {isCalendarCommand: false, title: null, date: null, time: null, description: null}

**Important:**
- If date is ambiguous or invalid, return null for date
- Always use 24-hour time format (HH:MM)
- If year is not specified, assume current year (${currentYear})`;

  try {
    const userKeys = userId ? await getUserKeys(userId) : {};
    const { object } = await generateObject({
      model: resolveModel(
        process.env.CALENDAR_MODEL_ID ?? DEFAULT_CALENDAR_MODEL,
        { anthropicApiKey: userKeys.anthropic },
      ),
      system: systemPrompt,
      prompt: text,
      schema: CalendarParseSchema,
    });

    if (!object.isCalendarCommand) return null;
    if (!object.title || !object.date) return null;

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(object.date)) return null;

    // Validate time format (HH:MM) if present
    if (object.time && !/^\d{2}:\d{2}$/.test(object.time)) return null;

    // Reject past dates
    if (object.date < today) return null;

    return {
      title: object.title.slice(0, 100), // truncate
      description: object.description,
      date: object.date,
      time: object.time,
    };
  } catch (err) {
    console.error("[calendar] parse failed:", err);
    return null;
  }
}

/**
 * Calculate when to send the LINE push reminder.
 * - If time specified: remind at that exact time on the event date
 * - If no time (all-day): remind at 9:00 AM ICT on the event date
 *
 * Returns a UTC Date object.
 */
export function calculateRemindAt(
  eventDate: string, // YYYY-MM-DD
  eventTime: string | null, // HH:MM or null
): Date {
  const [year, month, day] = eventDate.split("-").map(Number);
  const [hour, minute] = eventTime
    ? eventTime.split(":").map(Number)
    : [9, 0]; // default to 9am

  // Create date in ICT timezone (UTC+7)
  const ictDate = new Date(
    Date.UTC(year, month - 1, day, hour - 7, minute),
  );

  return ictDate;
}

/**
 * Format date for Thai display: "6 ก.ค. 2026"
 */
export function formatDateThai(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const thaiMonths = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ];
  return `${day} ${thaiMonths[month - 1]} ${year}`;
}

/**
 * Format time for Thai display: "14:30 น."
 */
export function formatTimeThai(timeStr: string | null): string | null {
  if (!timeStr) return null;
  return `${timeStr} น.`;
}
