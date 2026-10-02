# Changelog

All notable changes to the CityUHK CS Admission FAQ site.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Admission-talk cover page (index.md) reorganised** to talk order with a
  "three majors first" table, then Q1–Q10 as talk prompts: (Q1) what makes the
  majors attractive, (Q2) the mandatory 9-month internship, (Q3) main courses
  & arrangement, (Q4) JUPAS best-5 score calculation, (Q5) 🆕 the 1.5× subject
  weighting policy (emphasised as NEW), (Q6) band competitiveness (Band A
  most, D/E no chance), (Q7) no JUPAS interview, (Q8) non-JUPAS routes (Yr 1
  IB/GCE A-Level; ASI/ASII for CS **and** Cyber next year), (Q9) double
  degrees (5-yr, Math L4, self-financed final yr, JUPAS only), (Q10)
  scholarships. Each question links to its source note(s); each source note
  carries a "⬅ back to cover page" callout so the talk can move back and forth
  without scrolling.
- **"🤖 Ask the AI" section** on the cover page: a tap-to-ask list of
  general questions the site notes don't answer (9-month vs summer internship
  benefit, CS/cyber job market in HK, Cyber vs CS, CS vs IT, CS-major/IT-job,
  will-AI-replace-jobs). Tapping a question opens the AI chat and sends it
  immediately (no retyping); the tapped row flashes "Sent ✓".
- **`{#id}` heading-anchor plugin** (local Quartz transformer, order 51): turns
  `{#id}` markers in headings into real short anchor ids AND rewrites the
  sidebar TOC to match, so `#q1`–`#q10` / `#ask-ai` are stable short anchors
  for the back-links (previously the marker rendered as literal text and the
  auto-slugger produced long, mismatched ids).

### Fixed
- Cover-page section anchors were broken (the `{#qN}` marker rendered as
  literal text; back-links pointed at non-existent ids). Now resolved.
- Note "back to cover page" links previously 404'd / no-anchored; they now
  jump to the correct cover-page section.

### Fixed
- **Score checker showed an empty input box when opened from the cover
  page** (worked only after a refresh). The SPA router morphs the page body
  on link clicks without re-running the calculator's inline script, which
  builds the whole UI. All cover-page calculator links now carry
  `data-router-ignore`, so the browser does a normal full page load and the
  subject input rows always render.

### Changed
- Cover page: removed the "admission talk" framing (intro line,
  "Key points to say" labels, "(introduce first)"); majors-table column
  "One line" → "Summary"; "Browse all topics" → "See also"; added the
  What's My Score? calculator link under Q4 (score calculation).

- **JS1063 LLB + BSc Computer Science (AI) double degree** note
  (05_Programmes). JS1063 is a brand-new 5-year double degree (first
  intake 2027/28, 8 local JUPAS places) jointly run by the School of
  Law and the Department of Computer Science: qualifying LLB + BScCS
  (AI stream), 158 CU, JUPAS minimums English 5 / Math 3 / Chinese 3 /
  CSD + L3 science-ICT elective + second L3 elective, HK$49,500
  first-year fee, self-financing beyond 144 CU / year 5, PCLL route for
  law, HKIE-accredited CS. Also enriched the existing "Minor in
  Artificial Intelligence" curriculum note with the full 15-CU
  structure and CGPA 3.0 declaration rules. "Double Degree
  Requirements and Structure", JS1221 Overview, JS1204 Overview,
  index.md and the vault map updated to cover both double degrees.
- **Free (no-setup) mode now runs the full agent.** The free endpoint
  (Socrates via litellm) is probed at startup for tool-calling support;
  when present, free mode uses the same multi-round agent loop as
  external mode (all 62 tools: search/lookup/compute/page). If the
  endpoint rejects tools it degrades gracefully to the grounded RAG-only
  path. Also fixed the tool-result delivery that made the agent say
  "not in the notes": `search_notes` snippets are now anchored at the
  note's `## Answer` section (amounts/tables live there, not in the
  tip-callout the old leading slice re-served), the tool-result budget
  is 4200 chars (was 2600, which cut the JSON mid-object and dropped
  the lowest-ranked but on-topic note), and `retrieve()` gained a
  2x title-topic boost so on-topic notes aren't crowded out by
  generic ones.
- **`08_Scholarships` folder (23 new notes).** Full coverage of the
  [CityUHK scholarships page](https://www.cityu.edu.hk/scholarship/)
  (retrieved 25 September 2026): CityUHK Scholarships for Hong Kong Talents
  (Flagship incl. ACT JS1070 / Institutional / Dean's tiers for local JUPAS
  and non-JUPAS entrants, with 2027-entry amounts and thresholds), the
  scholarship HKDSE scoring scale (5** = 8.5...), no-application process and
  2027 timeline, renewal/CGPA conditions, no-concurrent-awards rule,
  recipient benefits (hall berth, exchanges, Golden Key), international
  Entrance Scholarship Scheme (Top HK$210k / Full / Half tuition), Diversity
  Grant, HKSAR Government Scholarship Fund, Chinese Mainland student
  scholarships, Outstanding Athletes awards, 120+ donor scholarships, and a
  "which CS programme to choose by scholarship value" comparison (ACT vs
  JS1204 vs JS1221). Index, vault map, JS1204/JS1218/JS1221/JS1070 overview
  and tuition notes cross-linked.
- **"What's My Score?" calculator now computes the 1.5× weighting version too.**
  Besides the published best-5 weight-1 score, each of your five subjects is
  now tagged as English / Mathematics / ICT / M1 / M2 / Physics / Chemistry /
  Biology (×1.5) or an other elective (×1), so the page shows your **exact**
  1.5× score. It also gives a **plain-English recommendation** (STRONG /
  CONTESTED / BELOW RANGE) against the published 2026 medians, with concrete
  next steps (e.g. flexible admission arrangement, non-JUPAS 1561A). A callout
  makes clear the 1.5× figure **cannot be compared with past weight-1
  admission stats** — only the weight-1 number is.
### Removed
- **09_Score-Lookup folder (334 notes).** One near-identical note per grade
  combination was redundant now that the calculator returns the score, the
  1.5× version and a recommendation directly. All references (index home
  page, README, vault map) updated. The notes remain in git history
  (`git log -- 09_Score-Lookup`) if a curated subset is ever wanted back.
### Changed
- **Chat close button moved into the panel header.** The big floating action
  button no longer doubles as the close control: while the chat is open it
  now disappears, and a small close (X) icon sits in the top-right corner of
  the panel header (beside the settings / clear / dock buttons). The FAB
  stays in the bottom-right purely to *open* the chat again. Escape also
  closes the panel, and closing while docked undocks (clearing the bottom
  bar and the page padding it added).
### Fixed
- **"Share this page" QR missing after some navigations (needed a refresh).**
  On an in-app navigation Quartz re-renders the page in several DOM batches
  and can briefly keep the previous page's sidebar alive next to the fresh
  one. The re-injection logic could "succeed" by re-using the card in the
  stale sidebar, which was then torn down — leaving no QR until a manual
  refresh. Re-injection is now live-DOM-driven (it only trusts the card if it
  is in the sidebar actually being rendered, sweeps stale duplicates, and
  rebuilds otherwise) and runs from three independent layers: a persistent
  MutationObserver (fires on DOM mutation even in a background tab, unlike
  timers), a per-navigation frame poll, and a 500 ms self-heal.
- **Docked chat now floats at the bottom of the SCREEN and covers nothing.**
  Docking pins the panel as a `position: fixed` bar at the bottom of the
  viewport — it stays in view while the page scrolls (it can no longer scroll
  out of sight at the bottom of the document). The bar is sized to span only
  the center article column, so it never overlaps the sticky left/right side
  panels, and the page gains matching bottom padding so the article/footer
  bottom sits above the bar. The bar re-lays out after each in-app
  navigation (Quartz replaces `<body>`, which used to wipe that padding) and
  on window resize. The "undock" button was invisible when active (it turned
  the same accent colour as its own header background); it now shows as a
  light chip with the accent-coloured icon.
- **All four edges resize correctly.** Added right + bottom edge handles to
  the existing left/top ones. The resize math seeds from
  `getBoundingClientRect()` *before* changing the fixed insets (with all
  insets auto a fixed element jumps to its static position, corrupting the
  seed) and tracks the rendered size, so at the max-height/width caps the
  anchored edge simply stops instead of dragging the whole panel off-screen.
- **"Share this page" QR could get stuck hidden.** The show/hide toggle
  lived inside the part that hid, so once collapsed there was no way back.
  The card header (title + eye toggle) is now always visible; only the QR
  body collapses. (The card is in the right sidebar below Graph / TOC /
  Backlinks.)
- **Chat panel open/close + stuck-minimized state.** The separate minimise and
  close buttons (which could leave the panel with no way to bring it back)
  are removed. The chat FAB is now the single open/close toggle: always
  visible, above the panel in z-order, its icon swaps between a chat bubble
  (closed) and an X (open), and it relocates to the top-right while open so
  it never sits under the panel.
- **Inverted panel resize.** Dragging the left edge left was widening the
  *right* side (and the top edge up was growing the *bottom*). Cause: the
  panel is `position: fixed` anchored by `right`/`bottom`, so
  `offsetLeft`/`offsetTop` read 0; the resize math now seeds from
  `getBoundingClientRect()` and moves the anchored edge together with the
  size (drag left → left edge + width grow, right edge stays; drag up → top
  edge + height grow, bottom edge stays). Also removed a `max-height: 600px`
  cap that was silently limiting vertical resizing on short viewports.

### Added
- **More, linkable sources on every answer.** Retrieval now pulls the top 8
  relevant notes (was 5) and the answer's source footer is a clickable list of
  up to 6 links (full published URLs, open in a new tab) with "+N more notes
  retrieved" when more were used — each also gets the hover-QR tooltip. The
  fast-mode prompt now asks the model to cite every relevant note so users can
  open and verify each one.
- **Draggable + resizable chat panel.** Grab the header to move the panel
  anywhere; drag its left edge to resize the width and its top edge to resize
  the height (min 300×360). Position and size are remembered per visitor,
  clamped so the panel can't be dragged off-screen, and ignored on phones
  (where the panel is full-screen). A **dock** button in the header pins the
  panel as a bottom bar and adds matching page padding so the docked chat
  covers no content.
- **Input stays focused after each reply.** The textarea is no longer disabled
  while the model is generating (a "Thinking…" placeholder indicates the
  state), and focus is restored when the answer lands — so a follow-up can be
  typed immediately. Tabbing into the input while the panel is miniaturised
  re-opens the panel.
- **"Share this page" QR now lives in the right sidebar** as a normal, in-flow
  card (page-associated, not a floating overlay) with a show/hide toggle that
  persists, a copy-link button, and a live URL caption. It re-targets to the
  current page on every in-app navigation and is re-injected whenever Quartz
  re-renders the page body, so it never covers content and always matches the
  page being viewed. (Replaces the earlier floating chat-header QR button.)
- **Collapsible side panels.** Two chevron buttons (left/right edges) collapse
  the site's left explorer and right related-pages rail, giving the article
  the freed width (verified: 630 → 955 → 1280 px). The preference persists and
  survives in-app SPA navigation (the widget re-applies it whenever Quartz
  re-renders the page body).
- **Mobile-friendliness.** On phones the chat panel is full-screen, the left
  explorer can be hidden with a bottom-left toggle (clearing the space it used
  to take above the article), and the right rail toggle is hidden (that panel
  stacks below the article, so it never blocks reading).
- **"Free" site-provided AI provider (time-limited special event).** A
  no-setup provider backed by a site-hosted LiteLLM endpoint
  (`https://socratic.cs.cityu.edu.hk/litellm/v1`, model `Socrates`). On page
  load the widget reads the free-service config from a **single public gist**
  (`FREE_CONFIG_URL`) that is the **source of truth for the endpoint, API key,
  and model** — so the owner can **rotate the key, change the endpoint, or
  switch it off instantly by editing the gist: no repo push, no rebuild, no
  Pages redeploy**. The gist content may be plain JSON or an **opaque
  one-line base64 string** (recommended, so it isn't human-readable when the
  gist is opened); both decode to
  `{"enabled":true,"baseUrl":"…","key":"sk-…","model":"Socrates"}`. A
  **trust guard** honours the gist's `baseUrl` only if it is `https` and its
  host is in `FREE_TRUSTED_HOSTS` (a public gist is editable by anyone, so this
  stops a tampered gist from redirecting the site's traffic and key to an
  attacker's server); `enabled:false` (or an untrusted endpoint) switches free
  OFF even if an embedded key is still valid. If the gist is absent/unreachable
  (e.g. a 404 after a delete), an embedded short-lived key is used as a
  fallback so the service stays up until the owner repoints it. If the config
  is disabled/missing, the key is rejected (401/403) or the server is down, the
  free option simply does not exist and the normal "open ⚙ settings and
  configure a model/server" prompt appears instead. A visitor's explicit
  choice (in-browser model or own server) always wins over the free
  provider. The key is not visible by casual search in the bundle — but on any
  static site a determined visitor can read it from the network tab, so the
  real protection is a **short-lived, revocable key** plus server-side
  spend/expiry limits on LiteLLM. The `Socrates` model is a reasoning model
  with no tool-calling (verified: it ignores tools and hallucinates without
  grounding), so the free provider always uses the grounded RAG path
  (retrieve from the 1035-note index, `max_tokens` 2048 for its thinking
  budget) — verified end-to-end: "What is 1561A?" returns the correct, cited
  answer in ~6s.
- **"Share this page" QR button (always visible).** A round button sits above the
  chat FAB. Click it to pop open a card showing a **QR code of the current page's
  full published URL** (e.g. `https://dive4dec.github.io/CityUHK-CS-Admission-FAQ/03_nonjupas/bsc-cs-non-jupas-code-1561a`) plus the URL, and a **Copy link**
  button (clipboard). Click again to hide. The QR is generated lazily in the
  browser with the same pure-JS encoder and **re-targets automatically on every
  in-app (SPA) navigation** and back/forward, so it always encodes the page you're
  actually on — not a fixed homepage. This gives a reliable way to get a scannable
  link to any published page (the chat works on note slugs, so it can't hand out
  full URLs by itself).
- **AI answers now cite full published URLs (not bare slugs).** The chat
  worked on note slugs, so it couldn't hand out a real link. Now: citation
  footers (`📖 Sources:`) and inline markdown links in answers resolve to the
  **full published URL** (e.g.
  `https://dive4dec.github.io/CityUHK-CS-Admission-FAQ/03_nonjupas/bsc-cs-non-jupas-code-1561a`),
  `navigate_to_page` returns the URL in its result, and both prompts (in-browser
  + external endpoint) tell the model the published base so "what's the link for
  page X?" yields a copyable/scannable markdown link. Also fixed inline links with
  a leading-slash path rendering as broken protocol-relative `//…` URLs.
- **Image + math rendering in chat answers.** Assistant messages now render
  pictures and equations inline:
  - Images: `![alt](url)`, raw `<img>` tags, and bare `data:image/...;base64,`
    strings (e.g. a QR code generated with `run_python`) all become an inline
    `<img class="ai-chat-image">`. Sources are sanitized (only `data:image`
    base64 or `http(s)` allowed) and attributes are escaped, so model output
    can't inject markup.
  - Math: `$...$` and `$$...$$` are typeset by **MathJax v3** (tex-svg, loaded
    lazily from the CDN on first use, no font files). Answers are only typeset
    on their final (non-streaming) render, via a small queue that flushes as
    soon as MathJax is ready (covers the case where the answer lands before the
    CDN resolves).
  - `run_python`'s description now tells the model it can generate images (QR
    codes with `qrcode`, charts with matplotlib) by printing a base64 PNG data
    URL.
- **Hover QR codes on link icons (fully client-side, no server).** Hovering
  any link in an assistant message (citations or inline) shows a small tooltip
  with a QR code of that link's absolute URL, so the page can be scanned on a
  phone. The QR is generated **live in the browser** with a vendored pure-JS
  encoder (`qrcode-generator`, MIT, ~56 KB) — no Pyodide/Python, no network,
  no server: it renders in ~10 ms and is memoized per URL (cached re-hover is
  sub-millisecond). Relative/anchor links are resolved to absolute URLs first
  so the code always scans off-device. The SVG is drawn at an exact multiple of
  the module count (crisp) with a 4-module quiet zone (scannable).

### Fixed
- **`hidePageQr is not defined` (console error when opening the chat panel).**
  The QR-button commit called `hidePageQr()` from `togglePanel` without ever
  defining it; the function now exists and closes the share-QR popover.
- **Status line lost "Free server ready" (and the reverse).** Two components
  (provider state, 2 MB knowledge-index load) both wrote the same status line
  and clobbered each other depending on timing. The line now composes both:
  `Free server ready: Socrates · Index 1035 notes`.
- **Knowledge-index 404 noise.** The fallback candidate list no longer
  duplicates URLs, so the console shows at most one benign probe 404 instead
  of repeated `/static/knowledge-index.json` 404s (the index itself loads
  fine from the right candidate).
- **Could not switch back to the free provider.** Settings now has a third
  provider option — "Free site AI" — that appears checked when the free
  service is active, says "Available now / Not currently available" with a
  reason, and (via "Use free AI") clears the visitor's own server/model
  choice and re-probes, so free can be re-selected at any time.
- **404 on `/static/knowledge-index.json` + stale-service-worker "no-op fetch
  handler" warning.** The site registers no service worker, but a stale SW left
  on the origin by an earlier deployment was intercepting fetches in some
  browsers. On load the widget now **unregisters any service worker present**
  (self-heal, logged to console), and the knowledge-index fetch tries several
  candidate URLs (repo-prefixed and root) so it loads no matter which path the
  page is served from.
- **Orphaned build file.** Removed the untracked, unreferenced
  `.site/quartz/plugins/emitters/knowledgeIndex.ts` (a dead earlier draft of the
  RAG emitter; the real one is wired via `./quartz/plugins/local/ai-chat`).

### Fixed (earlier)
- **`[]` shown as the answer with `Hermes-3-Llama-3.1-8B-q4f16_1-MLC`.** The
  in-browser agent path is grammar-locked (WebLLM forces a tool call). That 8B
  model sometimes emits a degenerate **empty tool-call array** (`[]`) — or the
  structured `delta.tool_calls` chunk arrives empty — and the raw JSON text was
  being rendered verbatim as the final answer. Now: (1) tool calls are recovered
  from the streamed JSON text when `delta.tool_calls` is missing/empty, (2)
  JSON-shaped Phase-1 output is never shown as the answer, and (3) the current
  page is fed into the Phase-2 answer round so the no-tool fallback still
  produces a real answer instead of `[]` or nothing.
- **In-browser model "Prompt tokens exceed context window size" (6623 > 4096).**
  WebLLM serializes every tool schema into the prompt, so the new 62-tool suite
  (~6,300 tokens) overflowed the Hermes-3-8B in-browser model's 4,096-token
  window and every agent request failed. The WebLLM path now exposes a curated
  14-tool subset with short descriptions (~1,100 tokens of schema; ~1,450 for
  the whole Phase-1 prompt, verified with a WebLLM-faithful fake engine that
  enforces the 4,096 limit). Any registered tool still executes if named.
  External OpenAI-compatible endpoints (models with large contexts) keep the
  full 62-tool suite.

### Added
- **Expanded agent tool suite (62 tools) + in-browser Python (Pyodide).** The
  agent previously had 3 tools and often re-searched in a loop without
  answering. It now has **62 purpose-specific tools** (new `tools.js`) that map
  common question intents directly to structured lookups, so it returns concrete
  answers instead of re-searching:
  - *Discovery:* `search_notes`, `search_exact`, `find_notes_mentioning`,
    `list_folders`, `list_notes`, `list_all_notes`, `read_note`,
    `get_related_notes`.
  - *Programmes & codes:* `get_jupas_code`, `get_nonjupas_code`,
    `get_programme_info`, `list_all_programmes`, `compare_programmes`,
    `get_programme_streams`, `get_double_degree_info`, `get_cs_department`.
  - *Scores:* `get_cityu_score`, `get_rival_score`, `get_all_cityu_scores`,
    `score_history`, `lookup_grade_score`, `get_subject_weights`,
    `get_hkdse_best5`.
  - *Courses & curriculum:* `get_course_info`, `list_courses`,
    `get_course_prerequisites`, `get_course_units`, `get_core_courses`,
    `list_stream_courses`, `get_elective_list`, `get_curriculum_overview`,
    `get_graduation_requirements`.
  - *Practical:* `get_tuition_fees`, `get_application_fee`,
    `get_jupas_key_dates`, `get_entry_requirements`, `get_language_requirement`,
    `get_programme_duration`, `get_application_routes`, `get_scholarships`,
    `get_rankings`, `get_employment_outcomes`, `get_placement_career`,
    `get_campus_location`, `get_accommodation`, `get_finance_loan`,
    `get_medium_of_instruction`, `get_contact_info`, plus policy tools
    (`get_admission_process`, `get_flexible_admission`, `get_international_admission`,
    `get_advancement_transfer`, `get_jupas_choices`, `get_admission_rounds`,
    `get_1_5x_weighting`, `get_oae_info`, `get_deferred_admission`).
  - *Python:* **`run_python`** runs real Python via Pyodide (WebAssembly, in the
    browser). The full 1035-note knowledge index is exposed as a Python
    variable `knowledge`; built-in packages (numpy, pandas, scipy, sympy,
    matplotlib, …) load on demand and any other PyPI package installs at runtime
    via micropip. First use downloads the ~10 MB runtime once, then caches it.
    `python_packages_available` lists what's preinstalled.
- **Fixed the "re-searches and stops" loop.** The agent loops now steer the model
  to the single most specific tool and tell it to answer from the returned data
  (max 2 tool calls). When the external (OpenAI-compatible) loop exhausts its
  step budget, it now **forces a final plain-text answer** assembled from the
  tool results it already gathered — instead of the old dead-end
  "Stopped after 4 steps". Verified headlessly: a model that re-calls the same
  tool every round now still ends with a correct answer.
- **Tools return real structured data** (not thin snippets): score lookups parse
  published median/lower-quartile by year; grade lookup computes the weighted
  score and compares it to the quartile; code lookups read the programme-code
  table; `short_answer` extracts each note's tip callout. `read_note(id)` returns
  full note text when a snippet is insufficient.

### Added (earlier, same release)
- **OpenAI-compatible server as an alternative model backend** (⚙️ settings):
  pick *In-browser model* (WebGPU, default) or *OpenAI-compatible server* and
  enter Base URL + API key + model name (works with OpenRouter, Groq, OpenAI,
  Azure, vLLM, Ollama, local llama.cpp `llama-server`). Requests stream over
  SSE in standard OpenAI `/chat/completions` format; the API key is stored only
  in this browser's `localStorage` and sent as a Bearer token. External models
  use a standard OpenAI tool loop (no grammar lock, so the two-phase WebLLM
  workaround is not needed). The welcome text now states clearly that in
  server mode the conversation is sent to that server.
- **In-browser AI chat widget** (Quartz local plugin, `.site/quartz/plugins/local/ai-chat/`):
  - Runs a fully **client-side LLM via WebLLM (WebGPU)** — no data leaves the browser;
    the model is downloaded on first use and cached locally.
  - **Keyword-RAG** over the FAQ: a build-time emitter writes
    `static/knowledge-index.json` (1,035 notes) that the widget searches locally.
  - **Tool-calling agent** mode (agent models): the assistant can
    `search_knowledge_base` (search the 1,035 notes), `read_current_page`
    (read the page you're on), and `navigate_to_page` (open a related note).
  - Mounts on `<html>` so it survives the Quartz SPA router's `body` morphs;
    all colors bound to Quartz theme variables so the widget matches light **and**
    dark mode.
- Wiring in `.site/quartz.config.yaml` (emitter + `AIChat` component, order 950).
- `.gitignore`: ignore the Quartz local-plugin loader cache (`.site/.quartz/`) and
  local tooling state (`.dsh/`).

### Fixed
- **Clear-chat button glyph** kept rendering as a missing-glyph box (🗗):
  the parallel session that built the agent loop rewrote `chat.js` and
  dropped the earlier U+1F5D7 → U+1F5D1 fix, re-introducing the obscure
  "tear-off calendar" emoji. Emoji rendering is OS-font-dependent, so the
  icon is now an **inline SVG trash can** (4 paths, `currentColor`) — it
  renders identically on every OS/browser with no emoji font involved.
- **Tool-calling loop / "stopped after 4 steps".** Root cause: WebLLM 0.2.85
  grammar-locks *every* response to the tool-call JSON schema whenever `tools`
  is present, so the model could never emit a plain-text final answer while
  `tools` was in the request — it re-called tools indefinitely. Replaced the
  single multi-round loop with a **two-phase request**: Phase 1 (with `tools`)
  selects and runs the tool; Phase 2 (no `tools`, plain completion with a custom
  system prompt) writes the answer. Tool results are passed as text (not a
  `role:"tool"` message) since the Hermes-3 chat template defines no `tool` role.
- **`CustomSystemPromptError` on the tool-call continuation.** WebLLM's
  `postInitAndCheckFields` injects its system prompt *in place* on the messages
  array it's given. The old loop reused one array across rounds, so round 1 saw
  the system message it had injected in round 0 and threw. Each request now
  sends a fresh defensive copy.
- **Dark mode unreadable.** The widget's CSS used a hardcoded light palette; all
  surfaces/text are now bound to Quartz theme variables (`--light`, `--dark`,
  `--secondary`, `--gray`, `--darkgray`, `--lightgray`, `--highlight`) with
  light-mode fallbacks. WCAG AA contrast verified in both themes.
- **Clear-chat button glyph** rendered as a missing-glyph box on some systems;
  replaced the obscure U+1F5D7 (🗗) with the standard trash can U+1F5D1 (🗑).

### Notes
- `.site/quartz/plugins/emitters/knowledgeIndex.ts` is **dead code** left from an
  earlier approach (not referenced by the config; the live plugin emits the index
  itself). It is intentionally not committed and can be deleted.
- The widget requires a WebGPU-capable browser (Chrome/Edge 113+ with GPU). Agent
  models (Hermes family, tool calling) download ~5 GB on first load; RAG-only
  models ~2 GB.
