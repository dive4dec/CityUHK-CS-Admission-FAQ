# Changelog

All notable changes to the CityUHK CS Admission FAQ site.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
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
