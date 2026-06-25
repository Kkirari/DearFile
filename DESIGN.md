# DearFile LIFF Design System

**Version:** 2.0  
**Last updated:** 2026-06-24

DearFile's design language is warm, personal, and intentionally un-corporate. It feels like a handcrafted tool made for real people organizing their digital lives, not a SaaS dashboard. Think warm cream paper, soft shadows, and gentle animations that respect the user's attention.

---

## Design Principles

1. **Warm, not clinical** — Cream backgrounds and earthy tones over stark white and cold blue
2. **Calm, not frenetic** — Gentle animations, soft shadows, no unnecessary motion
3. **Personal, not generic** — Emoji folder icons, customizable colors, playful copy
4. **Thai-first, globally accessible** — Optimized for Thai script readability, works beautifully in English
5. **Touch-optimized** — 44px minimum tap targets, bottom-sheet UI, thumb-zone navigation

---

## Color System

### Light Mode (Default)

```css
/* Foundation */
--color-background: #f4f3ee   /* Warm cream page background */
--color-card:       #fbfaf6   /* Elevated surface (slightly lighter, warm-tinted) */
--color-foreground: #4a4036   /* Primary text (warm dark brown) */

/* Neutrals */
--text-primary:   #4a4036   /* Body text, headings */
--text-secondary: #b0a396   /* Captions, meta info, disabled states */
--border-default: #e0d8cc   /* Hairline borders, card outlines */

/* Semantic Colors */
--accent-primary: #9b869c   /* Brand purple (used for primary actions, pins) */
--accent-ai:      #d99c5b   /* AI-generated folder accent (warm gold) */
--error:          #dc2626   /* Destructive actions */
--success:        #16a34a   /* Success states */

/* Folder Color Palette (user-customizable) */
--folder-lavender:  #9b869c
--folder-coral:     #e57373
--folder-amber:     #f4a261
--folder-mint:      #81c784
--folder-sky:       #64b5f6
--folder-rose:      #f48fb1
--folder-sage:      #a5b899
--folder-peach:     #ffab91
```

### Dark Mode

```css
/* Foundation */
--color-background: #1c1a18   /* Deep warm brown */
--color-card:       #252220   /* Elevated surface */
--color-foreground: #e8ddd4   /* Warm off-white text */

/* Neutrals */
--text-primary:   #e8ddd4
--text-secondary: #6e6460
--border-default: #3a3430
```

**Dark mode activation:** Triggered by LINE app theme or system preference via `prefers-color-scheme`.

---

## Typography

### Font Stack

```css
--font-sans: 'Sarabun', ui-sans-serif, system-ui, sans-serif;
```

**Sarabun** (Google Fonts) — A humanist sans-serif designed for Thai script, with excellent Latin support. Chosen for:
- High legibility at small sizes in Thai
- Warm, friendly personality
- Seven weights (200–800)
- Free & open-source

### Type Scale

DearFile uses a **5-step scale** with ~1.25× ratios. Each level has a semantic name tied to its role:

| Class        | Size | Line Height | Weight | Use Case                                      |
|--------------|------|-------------|--------|-----------------------------------------------|
| `.t-caption` | 11px | 1.4         | 500    | Eyebrow labels, count badges, micro-meta      |
| `.t-body`    | 14px | 1.45        | 500    | Primary body, button labels, list items       |
| `.t-strong`  | 17px | 1.3         | 700    | Section titles, file/folder names, dialogs    |
| `.t-title`   | 22px | 1.15        | 700    | Screen titles, profile name, hero stats       |
| `.t-display` | 28px | 1.05        | 800    | DearFile wordmark only                        |

**Thai script adjustment:** `.t-caption` bumps to 12px for `:lang(th)` because Thai reads small below 11px on lower-DPI screens.

**Tabular numerals:** Add `.tnum` to any element containing numbers shown alongside text (file counts, sizes, dates).

```html
<!-- Example -->
<p class="t-body tnum">128 files · 2.4 GB</p>
```

---

## Spacing & Layout

### Base Unit: 4px Grid

All spacing uses multiples of 4px for vertical rhythm:

| Token    | Value | Use Case                          |
|----------|-------|-----------------------------------|
| `xs`     | 4px   | Icon padding, tight gaps          |
| `sm`     | 8px   | Between label and value           |
| `md`     | 12px  | Card internal padding             |
| `lg`     | 16px  | Section gaps                      |
| `xl`     | 24px  | Screen padding                    |
| `2xl`    | 32px  | Major section breaks              |

### Border Radius

```css
--radius-sm:  0.375rem  /* 6px  — Badges, pills */
--radius-md:  0.625rem  /* 10px — Buttons, inputs */
--radius-lg:  1rem      /* 16px — Small cards */
--radius-xl:  1.375rem  /* 22px — File/folder cards */
--radius-2xl: 1.75rem   /* 28px — Bottom sheets */
```

**Philosophy:** Generous rounding (16–28px) gives warmth and feels native to iOS/LINE design language.

---

## Components

### 1. File Card

**Structure:**
- 3.5px colored left tape (varies by file type)
- File icon (24px)
- Name + metadata (size, date)
- Three-dot menu

**Colors by file type:**
```javascript
const tapeColorMap = {
  image:   '#7C3AED',  // Purple
  video:   '#2563EB',  // Blue
  audio:   '#DB2777',  // Pink
  pdf:     '#DC2626',  // Red
  doc:     '#1D4ED8',  // Indigo
  sheet:   '#16A34A',  // Green
  archive: '#D97706',  // Amber
  file:    '#9b869c',  // Default (brand purple)
};
```

**States:**
- Default: `shadow-[0_1px_3px_rgba(74,64,54,0.08)]`
- Hover: `shadow-[0_4px_14px_rgba(74,64,54,0.12)]`
- Active: No scale (menu opens inline)

---

### 2. Folder Card

**Variants:**
- **User folder** — Border `#e0d8cc`, background `#fbfaf6`, customizable icon color
- **AI folder** — Border `#d99c5b/25`, background `#d99c5b/6%`, gold sparkle icon

**Structure:**
- Icon area (40×40px, rounded-xl, tinted background)
  - Emoji OR Folder icon (customizable color)
  - AI folders show Sparkles icon
- Pin badge (top-right, 20×20px circle)
- Name (t-strong, 2-line clamp)
- Metadata: file count + time ago + lock icon (if read-only)

**Customization:**
- Users can set: emoji, color (8 presets), pinned state
- AI folders: always gold, cannot customize

**States:**
- Active: `scale-95` on tap
- Hover: Subtle shadow lift (web only)

---

### 3. Bottom Sheet

**Animation:**
```css
.sheet-enter: slide-up 320ms cubic-bezier(0.32, 0.72, 0, 1)
.sheet-exit:  slide-down 260ms cubic-bezier(0.32, 0.72, 0, 1)
```

**Structure:**
- Backdrop: `rgba(28, 26, 24, 0.4)` with backdrop-blur
- Sheet: `rounded-t-2xl`, max-height 92vh
- Handle: 32×4px rounded pill, centered, 12px from top
- Content padding: 24px horizontal, 16px below handle

**Examples:** File detail, folder actions, share picker, settings

---

### 4. Floating Action Button (FAB)

**Position:** Fixed bottom-right, 16px from edge (or 80px from bottom if navigation bar present)

**Style:**
- 56×56px circle
- Background: `#9b869c` (brand purple)
- Icon: Plus or Upload, white
- Shadow: `0 4px 12px rgba(155, 134, 156, 0.3)`
- Active state: `scale-90`

**Tap target:** Full 56px circle (exceeds 44px minimum)

---

### 5. Navigation Bar (Bottom)

**Height:** 64px (safe area inset applied via `env(safe-area-inset-bottom)`)

**Structure:**
- 4 tabs: Home, Folders, Timeline, Profile
- Active state: Icon + label in `#9b869c`
- Inactive: Icon + label in `#b0a396`
- Background: `#fbfaf6` with `backdrop-blur-lg` and top border `#e0d8cc`

**Typography:**
- Labels: 11px, weight 600
- Active: weight 700

---

### 6. Empty State

**Structure:**
- Icon (48×48px, light gray)
- Title (t-strong)
- Description (t-body, secondary color)
- Optional CTA button

**Spacing:**
- Centered vertically in container
- Icon → title: 16px
- Title → description: 8px
- Description → button: 20px

---

### 7. Workspace Switcher

**Trigger:** Tap workspace name in header

**Display:**
- Current workspace: Name + member count + emoji/icon
- Other workspaces: Name + emoji
- "+ Create Workspace" action at bottom
- Checkmark on active workspace

**Max height:** 60vh, scrollable if many workspaces

---

## Animations

### Timing Functions

```javascript
const easings = {
  snappy:   'cubic-bezier(0.32, 0.72, 0, 1)',     // Bottom sheets, modals
  smooth:   'cubic-bezier(0.25, 0.46, 0.45, 0.94)', // Screen transitions
  elastic:  'cubic-bezier(0.68, -0.55, 0.265, 1.55)', // Unused (too bouncy for this UI)
};
```

### Animation Inventory

| Name             | Duration | Easing  | Use Case                              |
|------------------|----------|---------|---------------------------------------|
| `card-enter`     | 350ms    | ease-out | File/folder card stagger on load      |
| `sheet-enter`    | 320ms    | snappy   | Bottom sheet slide-up                 |
| `sheet-exit`     | 260ms    | snappy   | Bottom sheet slide-down               |
| `backdrop-in`    | 200ms    | ease-out | Modal backdrop fade-in                |
| `backdrop-out`   | 240ms    | ease-out | Modal backdrop fade-out               |
| `screen-enter`   | 280ms    | smooth   | Full-screen navigation (slide-right)  |
| `fade-up`        | 300ms    | ease-out | Subtle reveals (stats, toasts)        |
| `logo-ping`      | 1800ms   | ease-in-out | Loading state ring pulse           |

**Stagger pattern:**
```javascript
style={{ animationDelay: `${index * 40}ms` }}
```
Used on file/folder cards to create a cascading reveal (40ms between each item).

---

## Shadows

### Elevation Scale

```css
/* Level 1 — Default cards */
shadow-[0_1px_3px_rgba(74,64,54,0.08),0_1px_2px_rgba(74,64,54,0.05)]

/* Level 2 — Hover state */
shadow-[0_4px_14px_rgba(74,64,54,0.12)]

/* Level 3 — Floating elements (FAB, menus) */
shadow-[0_6px_20px_rgba(74,64,54,0.15)]

/* Level 4 — Bottom sheets, modals */
shadow-[0_10px_40px_rgba(74,64,54,0.2)]
```

**Dark mode:** Shadows reduced by 40% opacity.

---

## Iconography

### Source: Lucide React

All icons from [Lucide](https://lucide.dev) — a clean, consistent icon set with 1000+ icons.

**Size convention:**
- 16px: Inline with text, action buttons
- 18px: Tab bar icons
- 20–24px: File type icons, folder icons
- 48px: Empty state illustrations

**Stroke width:** 2px default, 2.5px for emphasis (pinned badge, locks)

---

## Accessibility

### Minimum Contrast Ratios (WCAG AA)

| Pairing                     | Ratio  | Pass |
|-----------------------------|--------|------|
| `#4a4036` on `#f4f3ee`      | 7.8:1  | ✓    |
| `#b0a396` on `#f4f3ee`      | 3.2:1  | ✓    |
| `#e8ddd4` on `#1c1a18`      | 9.1:1  | ✓    |
| `#9b869c` on `#fbfaf6`      | 3.5:1  | ✓    |

### Touch Targets

**Minimum:** 44×44px (Apple HIG, WCAG 2.5.5)

All interactive elements meet this:
- File card: Full card height (52px)
- Folder card: Full card area (120×108px)
- FAB: 56×56px
- Nav tabs: Full width × 64px
- Buttons: Minimum 44px height

### Keyboard Navigation

- All interactive elements have `tabIndex` and `onKeyDown` handlers
- Focus visible: 2px solid `#9b869c` ring with 2px offset
- Bottom sheets trap focus until dismissed

### Screen Readers

- Semantic HTML (`<button>`, `<a>`, `<nav>`)
- `aria-label` on icon-only buttons
- `role="button"` on clickable divs (folder cards)
- Status announcements via `role="status"` for toasts

---

## Responsive Behavior

### Breakpoints (Rare — LIFF is mobile-only)

```css
sm:  640px   /* Large phones landscape */
md:  768px   /* Tablets */
lg:  1024px  /* Desktop preview (rarely used) */
```

**Layout strategy:**
- Default: Single-column, 100% width with 16px side padding
- File/folder grids: Always 2 columns on phones, 3–4 on tablets
- Bottom sheets: Max 640px width when screen > 768px

---

## Dark Mode Implementation

### Detection

```javascript
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
```

**Note:** LINE LIFF inherits theme from LINE app settings. Respect user's choice.

### Color Mapping

| Light          | Dark          |
|----------------|---------------|
| `#f4f3ee`      | `#1c1a18`     |
| `#fbfaf6`      | `#252220`     |
| `#4a4036`      | `#e8ddd4`     |
| `#b0a396`      | `#6e6460`     |
| `#e0d8cc`      | `#3a3430`     |

Accent colors (`#9b869c`, `#d99c5b`) remain the same but backgrounds adjust opacity.

### Variant Syntax

```css
/* Tailwind CSS v4 custom variant */
@custom-variant dark (&:where(.dark, .dark *));
```

Applied via `.dark` class on `<html>` or `<body>`.

---

## Special Treatments

### AI-Generated Folders

**Visual cues:**
- Gold sparkle icon (`#d99c5b`)
- Subtle gold tint on card background
- Border: `#d99c5b/25`
- Cannot be customized (no emoji/color picker)

### Read-Only Folders (Group Workspaces)

**Indicator:** Lock icon (`<Lock size={10} />`) before file count

### Pinned Folders

**Badge:** 20×20px circle, top-right corner, filled pin icon

### Empty States

**Illustrations:**
- No files: Open folder icon
- No folders: Sparkles icon
- No search results: Magnifying glass icon

---

## Motion Design Philosophy

1. **Purposeful, not decorative** — Animation clarifies hierarchy (sheets over page) and state changes (loading → loaded)
2. **Fast enough to feel instant** — 200–350ms for most transitions
3. **Respects `prefers-reduced-motion`** — Not yet implemented (TODO: disable animations when user has motion sensitivity)

---

## File Type Color Coding

**Left tape on file cards:**

| Type       | Color     | Hex       |
|------------|-----------|-----------|
| Image      | Purple    | `#7C3AED` |
| Video      | Blue      | `#2563EB` |
| Audio      | Pink      | `#DB2777` |
| PDF        | Red       | `#DC2626` |
| Document   | Indigo    | `#1D4ED8` |
| Spreadsheet| Green     | `#16A34A` |
| Archive    | Amber     | `#D97706` |
| Other      | Default   | `#9b869c` |

**Rationale:** Instant visual scanning — users recognize file types without reading the name.

---

## Internationalization (i18n)

### Languages Supported

- **Thai** (primary) — Optimized font rendering, culturally appropriate copy
- **English** (secondary) — Fallback for non-Thai speakers

### Text Direction

LTR only (no RTL support needed).

### Date/Time Formatting

```javascript
// Relative time
"Just now" | "3m ago" | "2h ago" | "Yesterday" | "5d ago"

// Absolute (for older items)
"24 Jun 2026" (English)
"24 มิ.ย. 2569" (Thai)
```

---

## Brand Elements

### Logo

**Wordmark:** "DearFile" in Sarabun 800, 28px, `#4a4036` (light) / `#e8ddd4` (dark)

**Icon:** Folder with heart cutout (not yet designed — using text logo only)

### Voice & Tone

- **Warm, not corporate** — "Your space" not "Dashboard"
- **Thai-fluent** — Natural ครับ/ค่ะ particles, no machine translation feel
- **Encouraging** — "สร้างโฟลเดอร์แรกกันเถอะ!" not "No folders yet."

---

## Performance Budget

### Load Times (3G)

- First Contentful Paint: < 1.5s
- Time to Interactive: < 3s

### Asset Sizes

- Sarabun WOFF2: ~18KB (Latin + Thai subset)
- Lucide icons: Tree-shaken, ~2KB per icon
- CSS: < 20KB gzipped (Tailwind purged)

---

## Design Tools

- **Figma** (primary) — Component library, mockups
- **Tailwind CSS v4** — Utility-first styling
- **Lucide React** — Icon system
- **Google Fonts** — Sarabun web font

---

## Future Considerations

### Not Yet Implemented

- [ ] Drag-and-drop file upload
- [ ] Swipe gestures on file cards
- [ ] `prefers-reduced-motion` support
- [ ] Haptic feedback on iOS
- [ ] Custom folder cover images
- [ ] Gradient folder backgrounds
- [ ] Audio/video inline preview

### Under Review

- Should AI folders have a "Regenerate" action?
- Alternative dark mode (OLED black instead of warm brown)?
- Compact density mode for power users?

---

## References

- [LINE Design System](https://designsystem.line.me/)
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [WCAG 2.1 Success Criteria](https://www.w3.org/WAI/WCAG21/quickref/)
- [Tailwind CSS v4 Docs](https://tailwindcss.com/docs)

---

**Changelog:**

- **2026-06-24** — Initial design system documentation
- **2026-05** — Workspace switcher added
- **2026-04** — Dark mode shipped
- **2026-03** — Folder customization (emoji, colors, pinning)
- **2026-02** — AI folder accent redesign (switched to gold)
- **2026-01** — Foundation: color system, type scale, card components
