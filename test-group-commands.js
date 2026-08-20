/**
 * Standalone check for the group command router.
 *   node test-group-commands.js
 *
 * Same style as test-folder-commands.js: parseAskCommand + parseGroupCommand are
 * pasted from the webhook route / lib/group-commands.ts so this runs with no
 * build and no imports. If you change them there, change them here.
 */

// ── Under test ───────────────────────────────────────────────────────────────

const ASK_SIGILS = ["/", "!", "@"];
const ASK_TRIGGERS = ["dearfile", "น้องกวาง"];

function parseAskCommand(text) {
  const t = (text ?? "").trimStart();
  for (const sigil of ASK_SIGILS) {
    if (!t.startsWith(sigil)) continue;
    const rest = t.slice(sigil.length).trimStart();
    const lower = rest.toLowerCase();
    for (const trig of ASK_TRIGGERS) {
      if (lower.startsWith(trig.toLowerCase())) return rest.slice(trig.length).trim();
    }
  }
  return null;
}

const EXACT = [
  [["ช่วยเหลือ", "คำสั่ง", "help", "commands", "?"], { kind: "help" }],
  [["สถานะ", "ตั้งค่า", "status", "settings"], { kind: "status" }],
  [["ตั้งค่า ปิดการตอบกลับ", "ปิดการตอบกลับ", "ปิดตอบกลับ", "เงียบ", "quiet on", "mute"],
   { kind: "quiet", on: true }],
  [["ตั้งค่า เปิดการตอบกลับ", "เปิดการตอบกลับ", "เปิดตอบกลับ", "quiet off", "unmute"],
   { kind: "quiet", on: false }],
];
const SEARCH_PREFIXES = ["ค้นหา", "search", "find"];

function parseGroupCommand(rest) {
  const t = (rest ?? "").trim();
  if (!t) return null;
  const normalized = t.replace(/\s+/g, " ").toLowerCase();
  for (const [aliases, cmd] of EXACT) {
    if (aliases.some((a) => a.toLowerCase() === normalized)) return cmd;
  }
  for (const prefix of SEARCH_PREFIXES) {
    const p = prefix.toLowerCase();
    if (normalized.startsWith(p + " ")) {
      const query = t.slice(t.toLowerCase().indexOf(p) + p.length).trim();
      if (query) return { kind: "search", query };
    }
  }
  return null;
}

/** What the webhook group branch actually does with a message. */
function route(text) {
  const question = parseAskCommand(text);
  if (question !== null) {
    const cmd = parseGroupCommand(question);
    if (cmd) return { to: "command", cmd };
  }
  if (question === null) return { to: "silence" };
  if (question.length === 0) return { to: "hint" };
  return { to: "ask", question };
}

const CALENDAR_TRIGGERS = [
  "เพิ่มปฎิทิน", "เพิ่มปฏิทิน", "ตั้งเตือน", "เตือนวันที่", "นัดวันที่", "บันทึกปฏิทิน",
  "add calendar", "add to calendar", "remind me on", "set reminder", "schedule",
];
function looksLikeCalendarCommand(text) {
  const t = (text ?? "").toLowerCase();
  return CALENDAR_TRIGGERS.some((p) => t.includes(p.toLowerCase()));
}

// ── Cases ────────────────────────────────────────────────────────────────────

const cases = [
  // The headline command, in every sigil the bot accepts
  ["!น้องกวาง ตั้งค่า ปิดการตอบกลับ", { to: "command", cmd: { kind: "quiet", on: true } }],
  ["/น้องกวาง ตั้งค่า ปิดการตอบกลับ", { to: "command", cmd: { kind: "quiet", on: true } }],
  ["@น้องกวาง ปิดการตอบกลับ",        { to: "command", cmd: { kind: "quiet", on: true } }],
  ["/dearfile quiet on",              { to: "command", cmd: { kind: "quiet", on: true } }],
  ["!น้องกวาง เปิดการตอบกลับ",       { to: "command", cmd: { kind: "quiet", on: false } }],
  ["!DearFile Quiet Off",             { to: "command", cmd: { kind: "quiet", on: false } }],
  // Whitespace shouldn't matter
  ["!น้องกวาง   ตั้งค่า    ปิดการตอบกลับ", { to: "command", cmd: { kind: "quiet", on: true } }],

  ["!น้องกวาง ช่วยเหลือ", { to: "command", cmd: { kind: "help" } }],
  ["!น้องกวาง help",      { to: "command", cmd: { kind: "help" } }],
  ["!น้องกวาง สถานะ",     { to: "command", cmd: { kind: "status" } }],
  ["!น้องกวาง ตั้งค่า",   { to: "command", cmd: { kind: "status" } }],

  ["!น้องกวาง ค้นหา ใบเสร็จ",  { to: "command", cmd: { kind: "search", query: "ใบเสร็จ" } }],
  ["!น้องกวาง search receipt", { to: "command", cmd: { kind: "search", query: "receipt" } }],
  ["!น้องกวาง ค้นหา ใบเสร็จ ค่าน้ำ เดือนมกราคม",
    { to: "command", cmd: { kind: "search", query: "ใบเสร็จ ค่าน้ำ เดือนมกราคม" } }],
  // Verb with no argument is not a search
  ["!น้องกวาง ค้นหา", { to: "ask", question: "ค้นหา" }],

  // The regression that matters: the bot's own canonical Ask phrasing must
  // still reach Ask, not the keyword search.
  ["!น้องกวาง หาใบเสร็จเดือนที่แล้ว", { to: "ask", question: "หาใบเสร็จเดือนที่แล้ว" }],
  ["!น้องกวาง หา ใบเสร็จ",            { to: "ask", question: "หา ใบเสร็จ" }],
  ["!น้องกวาง สรุปสัญญาให้หน่อย",     { to: "ask", question: "สรุปสัญญาให้หน่อย" }],

  // Folder creation stays with its own handler (parseGroupCommand declines)
  ["!น้องกวาง สร้างโฟลเดอร์ งานกลุ่ม", { to: "ask", question: "สร้างโฟลเดอร์ งานกลุ่ม" }],

  // Bare trigger → hint
  ["!น้องกวาง", { to: "hint" }],

  // Never hijack ordinary group chatter
  ["ตั้งค่า ปิดการตอบกลับ", { to: "silence" }],
  ["ช่วยเหลือ",             { to: "silence" }],
  ["ค้นหา ร้านอาหารอร่อยๆ", { to: "silence" }],
  ["วันนี้กินอะไรดี",       { to: "silence" }],
];

const calendarCases = [
  ["เพิ่มปฏิทินวันที่ 6 ว่าประชุม", true],
  ["วันที่ 6 เพิ่มปฏิทินว่าประชุม", true],  // date-first phrasing → needs .includes()
  ["ตั้งเตือนพรุ่งนี้",             true],
  ["remind me on July 6",           true],
  ["หาใบเสร็จเดือนที่แล้ว",         false],
  ["ตั้งค่า ปิดการตอบกลับ",         false],
  ["ค้นหา ใบเสร็จ",                 false],
];

// ── Run ──────────────────────────────────────────────────────────────────────

let failed = 0;
const j = (v) => JSON.stringify(v);

for (const [text, expected] of cases) {
  const got = route(text);
  const ok = j(got) === j(expected);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${text}\n    → ${j(got)}${ok ? "" : `\n    expected ${j(expected)}`}`);
}

for (const [text, expected] of calendarCases) {
  const got = looksLikeCalendarCommand(text);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} calendar? ${text} → ${got}${ok ? "" : `  (expected ${expected})`}`);
}

console.log(failed === 0 ? "\nAll passed." : `\n${failed} FAILED.`);
process.exit(failed === 0 ? 0 : 1);
