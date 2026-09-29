# Changelog

All notable changes to the CityUHK CS Admission FAQ site.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
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
