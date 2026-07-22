# DearFile (น้องกวาง)

> A **LINE-native "second brain"** — save any file, photo, PDF, or link from a LINE chat and get it back later by just asking. Built mobile-first as a LINE LIFF app with a chat-bot companion.

Thai-first, AI-assisted file organizer. Upload from anywhere, let AI name and file it, then find it again in natural language.

---

## 📸 Screenshots

> **To fill:** drop images named `01.png` `02.png` `03.png` into [`docs/screenshots/`](./docs/screenshots) and they'll appear below. Rename the captions as you like. Delete rows you don't use.

| Home | Folders | Search |
|:---:|:---:|:---:|
| ![Home](docs/screenshots/01.png) | ![Folders](docs/screenshots/02.png) | ![Search](docs/screenshots/03.png) |

---

## What it does

| Feature | Description |
|---|---|
| 📎 **Capture anything** | Upload files/photos/PDFs in the app, or forward them to the LINE bot — stored in S3, indexed for search |
| 🤖 **AI auto-foldering** | Claude reads each file and suggests a name + folder, so nothing lands in an untitled pile |
| 🔎 **Ask, don't dig** | Natural-language search over your files ("หารูปใบเสร็จเดือนที่แล้ว") |
| 👥 **Shared workspaces** | Group workspaces with invites, members, and owner-only permissions |
| 💬 **Folder-by-chat** | Create folders straight from a LINE group chat in Thai or English (`!น้องกวาง สร้างโฟลเดอร์ งานเรียน`) |
| 📅 **Calendar & reminders** | Natural-language calendar entries that push a LINE reminder when due |
| 📰 **Daily summary** | A scheduled digest of what you saved |
| 🔌 **MCP server** | Exposes your library to MCP-compatible AI clients via scoped tokens |
| 🔑 **BYOK** | Bring-your-own Anthropic key, stored encrypted |

---

## Tech stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS v4 — custom warm, Thai-first design system (see [`DESIGN.md`](./DESIGN.md))
- **AI:** Anthropic Claude via `@anthropic-ai/sdk` + Vercel AI SDK; embeddings-based search
- **Data:** Neon serverless Postgres · AWS S3 (file bytes, presigned URLs)
- **Channels:** LINE LIFF (mobile web) + LINE Messaging API webhook (bot)
- **Platform:** Vercel (serverless routes + Cron)

---

## Architecture

<!-- Optional: add a diagram image here (e.g. docs/diagram.png) and uncomment:
![Architecture](docs/diagram.png)
-->

```
LINE app ──┐                          ┌── AWS S3 (file bytes)
           ├─▶ Next.js (App Router) ──┤
Web/LIFF ──┘        │                 └── Neon Postgres (metadata + search index)
                    │
          ┌─────────┴──────────┐
          │  lib/ services      │   ai-folders · file-search · calendar · workspace
          │  app/api routes     │   upload · search · folders · line/webhook · mcp
          │  app/api/cron/*     │   index-files · calendar-reminders · daily-summary
          └────────────────────┘
                    │
              Anthropic Claude
```

- **`app/api/*`** — REST route handlers (upload, search, folders, workspaces, MCP, LINE webhook)
- **`app/api/cron/*`** — scheduled jobs: file indexing, calendar reminders, daily summary, capture processing
- **`lib/*`** — feature logic kept out of the routes (AI foldering, search, auth, workspace access, encryption)
- **`db/migrations`** — SQL migrations, applied with `npm run db:migrate`

---

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the keys below
npm run db:migrate           # apply SQL migrations to Neon
npm run dev                  # http://localhost:8000
```

**Required env:** `DATABASE_URL` (Neon), `ANTHROPIC_API_KEY`, AWS S3 (`AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_BUCKET_NAME`), LINE (`LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` / `NEXT_PUBLIC_LIFF_ID`), and `CRON_SECRET`. Full list in [`.env.example`](./.env.example).

---

## Engineering highlights

- **Multi-channel, one backend** — the same Next.js app serves a LIFF mobile UI and a LINE bot webhook, sharing storage, search, and auth.
- **Flexible NL command parser** — folder commands tolerate Thai typos and multiple sigils (`!` `@` `/`), covered by parser unit tests.
- **Permission model** — namespaced identities and owner-only workspace mutations guard every query (IDOR-safe).
- **Encrypted BYOK** — user API keys stored encrypted at rest (`lib/crypto.ts`).

---

*A solo student project — designed, built, and shipped end to end. The AI-agent rewrite lives in [DearFile 2.0](https://github.com/Kkirari/DearFile2.0).*
