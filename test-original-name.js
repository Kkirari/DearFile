/**
 * Standalone check for the auto-rename "keep a good original name" logic.
 *   node test-original-name.js
 *
 * Same style as test-folder-commands.js: the functions under test are pasted
 * from lib/analyzer.ts so this runs with no build and no imports. If you change
 * them there, change them here.
 */

// ── Under test (mirrors lib/analyzer.ts) ─────────────────────────────────────

const MEANINGLESS_EXIF_PATTERNS = [
  /^(img|dsc|dcim|mvimg|pano|scan|photo|camera|image|untitled|capture|snapshot)[\s_\-.]*\d*$/i,
  /^[\s\d_\-.]+$/,
  /^.{0,2}$/,
];

function isMeaningfulExifDescription(s) {
  const trimmed = s.trim();
  return trimmed.length >= 3 && !MEANINGLESS_EXIF_PATTERNS.some((re) => re.test(trimmed));
}

function originalNameFromKey(s3Key) {
  return (s3Key.split("/").pop() ?? "").replace(/^\d{10,}-/, "");
}

function looksMeaningfulFilename(name) {
  const base = (name ?? "").trim().replace(/\.[^.]+$/, "").trim();
  return isMeaningfulExifDescription(base);
}

// ── Cases ────────────────────────────────────────────────────────────────────

const keyCases = [
  ["users/U1/uploads/1755648000000-image_1755648000000.jpg", "image_1755648000000.jpg"],
  ["workspaces/ws_abc/inbox/1755648000000-ใบเสร็จค่าน้ำ-มกราคม.pdf", "ใบเสร็จค่าน้ำ-มกราคม.pdf"],
  // A real name that starts with a year must survive — hence \d{10,}, not \d+
  ["users/U1/uploads/1755648000000-2026-q2-report.pdf", "2026-q2-report.pdf"],
  ["users/U1/uploads/no-timestamp.pdf", "no-timestamp.pdf"],
];

const nameCases = [
  // Camera / app / bot noise → must be renamed by the AI
  ["image_1755648000000.jpg", false], // ← LINE's deriveFilename output; the .jpg-strip trap
  ["IMG_4821.jpg", false],
  ["IMG_0001.jpg", false],
  ["DCIM0032.jpg", false],
  ["Scan_001.pdf", false],
  ["20260820_143022.jpg", false],
  ["1755678901234.png", false],
  ["photo.png", false],
  ["image.png", false],
  ["untitled.docx", false],
  ["", false],
  // Human-typed → keep
  ["ใบเสร็จค่าน้ำ-มกราคม.pdf", true],
  ["สัญญาเช่าบ้าน-2569.pdf", true],
  ["Q2-sales-report-final.docx", true],
  ["โจทย์เลข-บทที่3.pdf", true],
  ["2026-q2-report.pdf", true],
];

// ── Run ──────────────────────────────────────────────────────────────────────

let failed = 0;

for (const [key, expected] of keyCases) {
  const got = originalNameFromKey(key);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} originalNameFromKey(${key})\n    → ${got}${ok ? "" : `  (expected ${expected})`}`);
}

for (const [name, expected] of nameCases) {
  const got = looksMeaningfulFilename(name);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} looksMeaningfulFilename(${JSON.stringify(name)}) → ${got}${ok ? "" : `  (expected ${expected})`}`);
}

console.log(failed === 0 ? "\nAll passed." : `\n${failed} FAILED.`);
process.exit(failed === 0 ? 0 : 1);
