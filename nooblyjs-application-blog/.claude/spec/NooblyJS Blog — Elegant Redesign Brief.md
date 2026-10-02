# NooblyJS Blog — Elegant Redesign Brief

Sep 29, 2026 · @Stephen Booysen

## Goal

Restyle the NooblyJS blog and Author Hub from a default Bootstrap look into a calm, editorial publication called **Folio**, without changing features, routes or data.

Every screen keeps its current behaviour: search, trending, topics, featured post, latest list, reader view with claps, saves and comments, the posts table, the story editor and the Customise settings. Only markup structure, CSS and small UX fixes change.

**How to use this with Claude Code:** paste this whole brief into Claude Code from the root of the blog repo, or save it as `DESIGN_BRIEF.md` and say: *"Read DESIGN\_BRIEF.md, inspect the current front end, propose a file-by-file plan, then implement it phase by phase."* The companion Design canvas shows each screen as it should look.

## Design direction

Folio should feel like a well-set literary magazine: warm paper, dark ink, one quiet claret accent, and generous white space. The writing is the hero; the chrome recedes.

- **Paper, not screen.** A warm off-white page ground replaces pure white and the saturated blue header. Cards are replaced by hairline rules wherever a card adds nothing.
- **Serif for reading, sans for doing.** Headlines and article text use a serif; navigation, meta, buttons and forms use a clean sans.
- **One accent, used sparingly.** Claret marks the primary action, active navigation and link hover. Nothing else is coloured. No gradients, no blue.
- **Hierarchy by type, not boxes.** Size, weight, small caps and spacing do the work that borders, shadows and pill badges do today.
- **Calm density.** Fewer, larger elements per screen. Metadata is grouped on one muted line.
- **The Author Hub stays a tool.** Same palette and fonts, but tighter spacing, a clear table and a focused editor.

Avoid: Bootstrap default blue (#0d6efd), filled blue pill tags, heavy drop shadows, left-border accent cards, emoji and Inter, Roboto or Arial.

## Design tokens

Put every value below in one `tokens.css` as CSS custom properties on `:root`, and reference only the variables from components. The Customise screen's Primary and Background colours must write to `--accent` and `--paper` so authors can still re-theme.

### Colour

| Token | Hex | Use |
| --- | --- | --- |
| `--paper` | #F7F4EE | Page background |
| `--surface` | #FFFDF9 | Raised panels, inputs, reader comment box |
| `--ink` | #1D1B18 | Headlines, body text, Author Hub top bar |
| `--ink-2` | #57524A | Deks, secondary text |
| `--ink-3` | #6E685E | Meta lines, captions, placeholders (passes 4.5:1 on paper) |
| `--rule` | #E4DED3 | Hairline dividers and input borders |
| `--rule-strong` | #CFC7B9 | Hover borders, table header rule |
| `--accent` | #8A3324 | Primary button, active nav, link hover, clap active |
| `--accent-ink` | #6E2519 | Accent hover / pressed |
| `--accent-soft` | #F3E6E1 | Tag hover, selected row, focus halo |
| `--success` | #3F6B4E | Published status dot |
| `--warning` | #A0661A | Scheduled status dot |
| `--danger` | #A3312A | Delete actions |

### Typography

Load from Google Fonts: **Newsreader** (opsz 6–72; 400, 500, 600, italic 400) and **Instrument Sans** (400, 500, 600).

| Role | Font | Size / line-height | Weight | Notes |
| --- | --- | --- | --- | --- |
| Display (featured title) | Newsreader | 52 / 58px | 500 | letter-spacing -0.01em |
| H1 (article title) | Newsreader | 56 / 62px | 500 | centred in reader |
| H2 (section, post title in list) | Newsreader | 28 / 34px | 500 |  |
| H3 (sidebar titles) | Newsreader | 20 / 26px | 500 |  |
| Dek / subtitle | Newsreader italic | 20 / 30px | 400 | `--ink-2` |
| Article body | Newsreader | 20 / 34px | 400 | max 680px measure |
| UI body | Instrument Sans | 15 / 24px | 400 |  |
| Meta | Instrument Sans | 13 / 20px | 500 | `--ink-3` |
| Kicker / label | Instrument Sans | 12 / 16px | 600 | uppercase, letter-spacing 0.12em |

### Spacing, radii, elevation

- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 64, 96. Section gaps are 64 or 96.
- Layout: content max-width 1200px, 32px side gutters on desktop, 20px on mobile. Reading column 680px.
- Radii: 4px images, 6px buttons and inputs, 10px panels, 999px only for count badges.
- Elevation: none by default. Hover on a list row or panel: `0 1px 2px rgba(29,27,24,.04), 0 8px 24px rgba(29,27,24,.06)`.
- Focus ring on everything focusable: `0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent)`.

## Global components

| Component | Spec |
| --- | --- |
| Site header | 72px tall, `--paper` background, 1px `--rule` bottom border. Left: wordmark (site title in Newsreader 26px, weight 500). Centre: nav links Latest, Trending, Topics in Instrument Sans 14px; active link in `--ink` with a 2px `--accent` underline offset 6px, others `--ink-2`. Right: search field (280px, magnifier icon inside, `/` hint) and a "Write" secondary button that goes to the Author Hub. Sticky on scroll with a subtle backdrop blur. |
| Primary button | `--accent` fill, white text, Instrument Sans 14px 600, height 40px, padding 0 18px, radius 6px. Hover `--accent-ink`. |
| Secondary button | Transparent, 1px `--rule-strong` border, `--ink` text. Hover: border `--ink`. |
| Text link button | "Read the story →" in `--ink`, 600, underline on hover in `--accent`. Replaces the blue "Read story" buttons on the home page. |
| Icon button | 36 × 36px hit area (44px on touch), stroke icon 18px, `aria-label` required. |
| Tag | Plain text in Instrument Sans 12px 600 uppercase, `--ink-2`, separated by a middle dot. Hover: `--accent`. In the Topics panel tags become outlined chips (1px `--rule`, radius 999px) with the count in `--ink-3`. No filled blue pills anywhere. |
| Meta line | One line: Author · Date · N min read, Instrument Sans 13px `--ink-3`. Always this order. |
| Stats | Views, claps and saves as 14px stroke icons + numbers in `--ink-3`, 16px gap. Hide a stat when it is 0 on public pages. |
| Inputs | 44px tall, `--surface` fill, 1px `--rule` border, radius 6px, label above in Instrument Sans 13px 600 `--ink`. Focus: ring token. Placeholders `--ink-3`. |
| Panel | `--surface`, 1px `--rule`, radius 10px, padding 24px. Used in the Author Hub and the comment form only. |
| Footer | Hairline top rule, wordmark, short tagline slot, social icon links from Customise settings, © year. |

Icons: use one stroke icon set throughout (Lucide or Phosphor Regular, 1.5px stroke). Remove the current mix of Bootstrap Icons and filled glyphs.

## Page-by-page spec

### 1. Home

- **Featured story:** replace the full-width 900px-tall photo with a two-column hero inside the 1200px container: image left (7 of 12 columns, 3:2 ratio, radius 4px, `object-fit: cover`), text right (5 columns, vertically centred). Text stack: kicker "Featured · Inspire", display title, italic dek, meta line, "Read the story →" link. The whole hero is clickable; the title is the real link.
- **Latest:** section label "Latest" (kicker style) over a hairline rule. Each post is a row, not a card: left column 120px with the date ("Oct 16" over "2025"), then title (H2), dek in italic, a two-line excerpt clamped with ellipsis, then tags. Stats sit bottom-right of the row. Rows are separated by hairlines with 32px vertical padding. Remove the per-row "Read story" button; the title and row are the link.
- **Sidebar (4 columns, sticky at top 96px):** "Trending" with large Newsreader numerals 01–04 in `--ink-3`, title in 17px serif, meta beneath. Then "Topics" as outlined chips with counts. Optional "About the author" panel slot (name, one line, social links) fed from Customise settings.
- **Footer:** as in Global components.

### 2. Article reader

- Make it a full page at `/post/:slug` (keep the modal only if routing is hard; if kept, it must be full-viewport with the same layout).
- Top: "← All stories" back link. Centred header in 760px: kicker (first tag), H1, italic dek, meta line.
- Cover image 1040px wide, radius 4px, 64px below the header.
- Body in a 680px column, Newsreader 20/34. First paragraph gets a 3-line drop cap in `--accent`. Lists use custom hanging bullets in `--ink-3`.
- **Content fix:** "Key rituals he returns to:" is currently the first bullet. Render it as a lead-in paragraph followed by the three bullets.
- **Action bar** under the body, between hairlines: Clap button (icon + count, turns `--accent` when clapped), Save (icon + count), Share (copies link). **Bug fix:** the clap button currently renders as an empty blue pill with no icon or count.
- **Discussion:** H2 "Discussion" with count in `--ink-3`. Empty state in italic serif: "No comments yet. Be the first to respond." Form in a panel: Name input (pre-filled "Reader" as placeholder, not value) and Comment textarea (min 4 rows) stacked vertically at every width. Primary "Post comment" button right-aligned.
- Below: "More from Folio" with the next 3 posts as compact rows.

### 3. Author Hub — Posts

- Top bar 64px in `--ink` with white wordmark "Author Hub", links "View blog" and a primary "New draft" button.
- Tabs (Posts, Customise) as text with a 2px `--accent` underline on the active tab; no boxed tab styling.
- Layout: stories list 7 columns, editor 5 columns, both panels.
- **Stories table:** columns Title (title in 15px 600 + subtitle in `--ink-3`), Status (8px dot + word: Published green, Draft grey, Scheduled amber), Updated ("Sep 29, 2026 · 21:11"), Actions. Replace the unlabeled blue toggle / yellow eye / red bin cluster with three icon buttons: Edit, Hide/Show, Delete (Delete in `--danger` on hover, with a confirm dialog). Row hover `--accent-soft` tint; the selected row keeps it.
- Filter field in the panel header with a search icon; add a Status segmented filter (All, Published, Drafts).
- **Editor panel:** header "New story" or "Editing: \<title>" with a status chip. Fields: Title (serif 22px input), Subtitle, Author + Tags side by side, Status + Schedule side by side, Cover image URL with a 16:9 thumbnail preview once filled, Story textarea (min 12 rows, serif 17px, Markdown hint). Footer: "Reset" text button left, "Save draft" secondary and "Publish" primary right.

### 4. Author Hub — Customise

- Two columns: settings form 7 columns, live preview 5 columns (a scaled mini home page that updates as you type, sticky).
- Group settings into panels with H3 titles: **Identity** (Site title, Tagline, Banner image URL), **Colours** (Accent and Background, each a 40px swatch + hex input, plus four preset palettes: Folio Claret, Ink Blue, Forest, Graphite), **Social links** (Twitter/X, Instagram, TikTok, Custom link name + URL in a 2-column grid, each input with a leading icon).
- Validate hex values and URLs inline, with the message under the field in `--danger`.
- Sticky save bar at the bottom of the form: "Unsaved changes" hint on the left when dirty, "Reset" and "Save settings" on the right. The separate "Preview" button is no longer needed.

## Responsive, accessibility and motion

**Breakpoints:** mobile < 720px, tablet 720–1080px, desktop > 1080px.

- Mobile header: wordmark left, search and menu icon buttons right; nav moves into a slide-down sheet. Featured hero stacks (image on top). Latest rows drop the date column and show the date in the meta line. Sidebar moves below Latest.
- Reader on mobile: H1 36/42px, body 18/30px, 20px gutters, cover image full-bleed.
- Author Hub below 1080px: editor opens as a full-screen sheet from the table; Customise preview hides behind a "Preview" toggle.

**Accessibility:**

- Text contrast at least 4.5:1 (3:1 for 24px+). All tokens above pass on `--paper` and `--surface`.
- Real `<a>` and `<button>` elements only; every icon-only button has an `aria-label`. Visible focus ring on every interactive element.
- Touch targets at least 44 × 44px on touch devices.
- Every form field has a `<label>`; errors use `aria-describedby`.
- Images need `alt`; the editor asks for alt text under the cover image URL.
- Respect `prefers-reduced-motion`.

**Motion:** 150ms ease-out for colour and border changes; 200ms for hover lift (translateY -1px plus the hover shadow); no parallax, no animated gradients. Clap gives a single 1.15× scale pulse.

**Dark mode (phase 3, optional):** paper #161513, surface #1E1C1A, ink #EDE8DF, ink-2 #B9B2A6, ink-3 #948D82, rule #34302B, accent #D0765F.

## Implementation plan

Ship in three phases, each a separate commit that leaves the site working.

1. **Foundation:** add `tokens.css` and the Google Fonts link; set base element styles (body, headings, links, lists, form controls); override or remove Bootstrap's blue theme variables; add the shared icon set.
2. **Public blog:** header, footer, featured hero, Latest rows, sidebar, article reader, clap bug fix, bullet content fix, discussion form, responsive rules.
3. **Author Hub:** top bar, tabs, stories table with labelled actions, editor panel, Customise panels with live preview and sticky save bar; wire Customise colours to `--accent` and `--paper`. Optional dark mode.

**Constraints for Claude Code**

- Do not change the data model, API routes or storage; this is a presentation-layer change plus the two noted bug fixes.
- Keep Bootstrap only if removing it is risky; if kept, theme it through CSS variables rather than fighting its classes one by one.
- No new runtime dependencies other than the fonts and one icon set.
- Before editing, list the files you will change and why; after each phase, summarise what changed and how to check it.

**Acceptance checklist**

- [ ] No #0d6efd (Bootstrap blue) remains anywhere in the rendered UI
- [ ] Home shows the two-column featured hero, row-style Latest list and sticky sidebar at 1440px
- [ ] Home, reader and Author Hub work at 390px with no horizontal scroll
- [ ] Clap button shows an icon and count and toggles to the accent colour
- [ ] "Key rituals he returns to:" renders as a lead-in paragraph, not a bullet
- [ ] Every icon-only button has an `aria-label` and a visible focus ring
- [ ] Changing Accent and Background in Customise re-themes the blog after saving
- [ ] Lighthouse accessibility score of 95 or higher on home and reader

**Starter prompt**

> Read the design brief below and the current front-end code. Restyle the NooblyJS blog and Author Hub to the Folio design: create `tokens.css`, then implement phase 1, 2 and 3 in order, one commit per phase. Do not change data, routes or APIs. After each phase, tell me what changed and how to verify it against the acceptance checklist.
