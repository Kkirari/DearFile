/**
 * Tiny migration runner — applies db/migrations/*.sql to Neon over the
 * serverless HTTP driver. Idempotent (every statement uses IF [NOT] EXISTS).
 *
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs
 *   # or: npm run db:migrate   (loads .env.local)
 *
 * HTTP runs one statement per call, so we split each file on ";".
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

// Load .env.local / .env so `npm run db:migrate` works without exporting vars.
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* file may not exist — fine */
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Provision Neon, then set it in .env.local.");
  process.exit(1);
}

const sql = neon(url);
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  const raw = readFileSync(join(dir, file), "utf8");
  const statements = raw
    .replace(/--.*$/gm, "") // strip line comments first — they may contain ";"
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`\n▶ ${file} (${statements.length} statements)`);
  for (const stmt of statements) {
    try {
      await sql.query(stmt);
      console.log("  ✓", stmt.split("\n")[0].slice(0, 70));
    } catch (err) {
      console.error("  ✗", stmt.split("\n")[0].slice(0, 70));
      console.error("   ", err.message);
      process.exit(1);
    }
  }
}

console.log("\n✅ migrations applied");
