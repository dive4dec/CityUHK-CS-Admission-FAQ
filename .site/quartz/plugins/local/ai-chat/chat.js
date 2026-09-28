/* ================================================================
   AI Chat Widget — CityUHK CS Admission FAQ
   In-browser LLM (WebLLM, WebGPU) + keyword RAG over a static
   knowledge index + a client-side AGENT LOOP with tool calling
   (search notes, open a page, read the current page).
   No data leaves the browser.

   WebLLM function-calling notes (verified against the 0.2.85
   bundle source):
   - Only the Hermes-2-Pro / Hermes-3 8B/7B family is in the
     bundle's functionCallingModelIds. For those models, passing
     `tools` makes WebLLM (a) forbid any custom `system` message
     (it injects its own Hermes tool-prompt), (b) force the output
     to the Hermes function-call JSON schema, and (c) return the
     parsed calls as `delta.tool_calls` on the last streaming
     chunk (finish_reason "tool_calls").
   - Tool results are fed back as { role: "tool", content: string }.
   - Non-Hermes small models get RAG-only answers (fast mode).
   Plain top-level script (no import/export): works both as an ES
   module (production build) and inside the IIFE-wrapped serve-mode
   bundle. Mounts into <html> (not document.body) so the SPA
   router, which morphs document.body, never destroys the widget.
   ================================================================ */
(function () {
  "use strict";

  if (window.__aiChatLoaded) return;
  window.__aiChatLoaded = true;

  // ---- Config ----
  // Agent models: the only family WebLLM 0.2.85 supports for
  // OpenAI-style `tools` (grammar-constrained tool calling).
  var AGENT_MODELS = [
    "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
    "Hermes-3-Llama-3.1-8B-q4f32_1-MLC",
    "Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC",
    "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC"
  ];
  // Fast models: smaller and quicker; answer from retrieved notes
  // only (WebLLM 0.2.85 has no `tools` support for them).
  var FAST_MODELS = [
    "Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
    "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    "Llama-3.2-1B-Instruct-q4f16_1-MLC"
  ];
  var MODELS = AGENT_MODELS.concat(FAST_MODELS);
  var DEFAULT_MODEL = AGENT_MODELS[0];
  var TOP_K = 5;
  var HISTORY_KEEP = 6; // plain-text messages kept for fast mode
  var AGENT_HISTORY = 4; // plain-text messages kept for agent mode
  var AGENT_TURN_TRIM = 400; // trim old assistant replies in agent history
  var MAX_AGENT_TURNS = 4; // max model calls per user query (agent)
  var TOOL_RESULT_MAX = 1500; // chars of a tool result fed back to the model
  var PAGE_READ_MAX = 1200; // default chars for read_current_page
  var STORAGE_MODEL = "cityu-ai-chat-model";
  // The page carries data-basepath from cfg.baseUrl even in local-serve mode,
  // where the site is served at the root. Only use the basepath when the
  // current URL actually lives under it (GitHub Pages); otherwise use root.
  var _bp = document.body.dataset.basepath || "";
  var BASE = _bp && location.pathname.indexOf(_bp) === 0 ? _bp : "";
  // NOTE: @mlc-ai/web-llm@0.2.85 ships lib/index.js; the
  // dist/webllm.min.js URL 404s on the CDN.
  var WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js";
  var WEBLLM_URL_FALLBACK = "https://esm.run/@mlc-ai/web-llm@0.2.85";

  function isAgentModel(modelId) {
    return !!modelId && AGENT_MODELS.indexOf(modelId) >= 0;
  }

  // ---- State ----
  var knowledgeIndex = null;
  var engine = null;
  var engineLoading = false;
  var isGenerating = false;
  var conversationHistory = [];
  var panelOpen = false;
  var webllmLib = null;
  var currentModelId = null;

  function storageGetModel() {
    try { return localStorage.getItem(STORAGE_MODEL); } catch (e) { return null; }
  }
  function storageSetModel(m) {
    try { localStorage.setItem(STORAGE_MODEL, m); } catch (e) {}
  }

  // ---- DOM helpers ----
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (k === "className") e.className = v;
        else if (k === "textContent") e.textContent = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function")
          e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v !== null && v !== undefined && v !== false)
          e.setAttribute(k, v === true ? "" : v);
      }
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Minimal markdown: bold, italic, inline code, links, bullet lists, paragraphs.
  function renderMarkdown(text) {
    var lines = String(text).split("\n");
    var html = "";
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = line.match(/^\s*[-*] (.+)$/);
      if (m) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += "<li>" + inline(m[1]) + "</li>";
        continue;
      }
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim() === "") continue;
      html += "<p>" + inline(line) + "</p>";
    }
    if (inList) html += "</ul>";
    return html;
  }
  function inline(s) {
    var out = esc(s);
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
      var href = u;
      if (!/^(https?:|mailto:|#)/i.test(u)) href = BASE + "/" + u;
      return '<a href="' + href + '">' + t + "</a>";
    });
    return out;
  }

  // ---- RAG keyword retrieval ----
  function retrieve(query, topK) {
    if (!knowledgeIndex || !knowledgeIndex.length) return [];
    var terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
    if (!terms.length) return [];
    var scored = [];
    for (var i = 0; i < knowledgeIndex.length; i++) {
      var entry = knowledgeIndex[i];
      var combined = (entry.title + " " + entry.text).toLowerCase();
      var titleLower = entry.title.toLowerCase();
      var score = 0;
      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        var idx = combined.indexOf(term);
        if (idx >= 0) {
          score += titleLower.indexOf(term) >= 0 ? 10 : 1;
          score += Math.max(0, 5 - idx / 100);
        }
      }
      if (score > 0) scored.push({ entry: entry, score: score });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, topK || TOP_K).map(function (s) { return s.entry; });
  }

  async function loadKnowledgeIndex() {
    try {
      var res = await fetch(BASE + "/static/knowledge-index.json", { cache: "force-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      knowledgeIndex = await res.json();
      setStatus("ready", "Knowledge index loaded (" + knowledgeIndex.length + " notes)");
    } catch (e) {
      knowledgeIndex = [];
      setStatus("error", "Knowledge index unavailable — retrieval off");
    }
  }

  function setStatus(state, msg) {
    var t = document.getElementById("ai-chat-status-text");
    var d = document.getElementById("ai-chat-status-dot");
    if (t) t.textContent = msg || "";
    if (d) d.className = "status-dot" + (state ? " " + state : "");
  }

  function messagesEl() { return document.getElementById("ai-chat-messages"); }

  function appendMessage(role, text, sources) {
    var box = messagesEl();
    if (!box) return null;
    var msg = el("div", { className: "ai-chat-message " + role });
    if (role === "assistant" && text) {
      msg.innerHTML = renderMarkdown(text);
      box.appendChild(msg);
      if (sources && sources.length) appendCitations(msg, sources);
    } else {
      msg.textContent = text || "";
      box.appendChild(msg);
    }
    box.scrollTop = box.scrollHeight;
    return msg;
  }

  // citations: array of {slug,title} OR map {slug: title}
  function appendCitations(msgEl, items) {
    var entries;
    if (Array.isArray(items)) {
      entries = items.map(function (x) { return { slug: x.slug, title: x.title }; });
    } else {
      entries = Object.keys(items || {}).map(function (s) { return { slug: s, title: items[s] }; });
    }
    var seen = {}, list = [];
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].slug || seen[entries[i].slug]) continue;
      seen[entries[i].slug] = true;
      list.push(entries[i]);
    }
    if (!list.length) return;
    var src = el("div", { className: "ai-chat-sources" });
    src.innerHTML =
      "\uD83D\uDCD6 Sources: " +
      list.slice(0, 4).map(function (s) {
        return '<a href="' + BASE + "/" + s.slug + '">' + esc(s.title || s.slug.split("/").pop()) + "</a>";
      }).join(", ");
    msgEl.appendChild(src);
  }

  function addSystemMessage(text) { appendMessage("system", text); }

  function scrollBottom() {
    var box = messagesEl();
    if (box) box.scrollTop = box.scrollHeight;
  }

  // A small pill shown in the transcript when the agent calls a tool.
  function addToolChip(name, argsObj) {
    var box = messagesEl();
    if (!box) return;
    var argStr = "";
    try {
      var parts = [];
      for (var k in argsObj) parts.push(k + "=" + JSON.stringify(argsObj[k]));
      argStr = parts.join(" ");
    } catch (e) { argStr = ""; }
    var chip = el("div", { className: "ai-chat-message tool" });
    chip.textContent = "\uD83D\uDD27 " + name + (argStr ? "(" + argStr + ")" : "");
    box.appendChild(chip);
    box.scrollTop = box.scrollHeight;
  }

  function showTyping(show) {
    var existing = document.getElementById("ai-chat-typing");
    if (show) {
      if (!existing) {
        var t = el("div", { id: "ai-chat-typing", className: "ai-chat-message assistant ai-chat-typing" });
        t.appendChild(el("span")); t.appendChild(el("span")); t.appendChild(el("span"));
        var box = messagesEl();
        if (box) { box.appendChild(t); box.scrollTop = box.scrollHeight; }
      }
    } else if (existing) {
      existing.remove();
    }
  }

  function showWelcome() {
    var box = messagesEl();
    if (!box) return;
    box.innerHTML = "";
    var w = el("div", { className: "ai-chat-welcome" });
    w.innerHTML =
      "<p><strong>\uD83C\uDF93 CityUHK CS Admission FAQ Assistant</strong></p>" +
      "<p>Ask about admission, JUPAS scores, programmes, curriculum or tuition fees.</p>" +
      "<p>I can <em>search the 1035 FAQ notes</em>, <em>open the source page</em> for you, and <em>read the page you are on</em> (with an agent model).</p>" +
      "<p>Everything runs <em>locally in your browser</em> — no data is sent to any server.</p>" +
      "<p>Open \u2699\uFE0F settings to load a model (first load downloads it, then cached).</p>";
    box.appendChild(w);
  }

  // ---- WebLLM engine ----
  async function loadWebllmLib() {
    try {
      return await import(WEBLLM_URL);
    } catch (e) {
      return await import(WEBLLM_URL_FALLBACK);
    }
  }

  function gpuAvailable() {
    return typeof navigator !== "undefined" && !!navigator.gpu;
  }

  async function loadEngine(modelId) {
    if (engineLoading) return;
    if (!gpuAvailable()) {
      setStatus("error", "WebGPU not available in this browser");
      addSystemMessage(
        "This browser has no WebGPU, so the in-browser model cannot run. " +
        "Try Chrome or Edge 113+ (or Firefox 141+ with WebGPU enabled)."
      );
      return;
    }
    engineLoading = true;
    try {
      if (!webllmLib) webllmLib = await loadWebllmLib();
      if (typeof webllmLib.CreateMLCEngine !== "function") {
        throw new Error("WebLLM library loaded but CreateMLCEngine is missing.");
      }
      setStatus("loading", "Loading " + modelId + " (first time downloads the model, then cached)...");
      engine = await webllmLib.CreateMLCEngine(modelId, {
        initProgressCallback: function (r) {
          var pct = r.progress != null ? " " + Math.round(r.progress * 100) + "%" : "";
          setStatus("loading", (r.title || "Loading") + (r.message ? ": " + r.message : "") + pct);
        }
      });
      currentModelId = modelId;
      var agent = isAgentModel(modelId);
      setStatus(
        "ready",
        "Model ready: " + modelId + (agent ? " (agent — tool calling on)" : " (fast — RAG only)")
      );
      addSystemMessage(
        agent
          ? "Model loaded — I can search the FAQ notes, open source pages and read your current page."
          : "Model loaded (fast mode) — I answer from the notes I retrieve; page tools are off."
      );
    } catch (e) {
      engine = null;
      currentModelId = null;
      setStatus("error", "Model failed to load");
      addSystemMessage("Model load error: " + (e && e.message ? e.message : e));
    } finally {
      engineLoading = false;
    }
  }

  // ---- Agent tools (executed client-side; nothing leaves the browser) ----
  var TOOLS = [
    {
      type: "function",
      function: {
        name: "search_knowledge_base",
        description:
          "Keyword-search the site's 1035 CityUHK CS admission FAQ notes. Use for factual admission questions (scores, fees, programmes, requirements). Do NOT use it to answer questions about the page the user is currently on — use read_current_page for those.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search keywords, e.g. \"JUPAS 2026 CS admission score\"" },
            limit: { type: "integer", description: "Max results to return (default 5, max 8)" }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "navigate_to_page",
        description:
          "Open a FAQ note page in the user's browser so they can read it. Use a slug returned by search_knowledge_base. The user sees the page change.",
        parameters: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Note slug exactly as returned by search_knowledge_base" }
          },
          required: ["slug"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "read_current_page",
        description:
          "Read the text of the page the user is currently viewing. This is the ONLY tool for questions about \"this page\", \"the current page\", \"summarize this page\", or anything the current page says. Call it first (NOT search_knowledge_base) for those, then answer directly from its returned text.",
        parameters: {
          type: "object",
          properties: {
            max_chars: { type: "integer", description: "Max characters to return (default 1200)" }
          },
          required: []
        }
      }
    }
  ];

  function findEntryBySlug(slug) {
    if (!knowledgeIndex) return null;
    for (var i = 0; i < knowledgeIndex.length; i++) {
      if (knowledgeIndex[i].slug === slug) return knowledgeIndex[i];
    }
    return null;
  }

  function currentPageMeta() {
    var slug =
      (document.body.dataset && document.body.dataset.slug) ||
      location.pathname.slice(BASE.length).replace(/^\//, "");
    return { title: document.title || "", slug: slug };
  }

  // A short window of the note text around the first matched keyword.
  function snippetFor(entry, query) {
    var text = (entry.text || "").replace(/\s+/g, " ");
    var terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
    var lower = text.toLowerCase();
    var pos = -1;
    for (var i = 0; i < terms.length; i++) {
      pos = lower.indexOf(terms[i]);
      if (pos >= 0) break;
    }
    if (pos < 0) return text.slice(0, 260);
    var start = Math.max(0, pos - 90);
    var end = Math.min(text.length, pos + 170);
    return (start > 0 ? "\u2026" : "") + text.slice(start, end) + (end < text.length ? "\u2026" : "");
  }

  function executeTool(name, args, cited) {
    if (name === "search_knowledge_base") {
      var q = String((args && args.query) || "").trim();
      if (!q) return { ok: false, error: "query is required" };
      var limit = Math.max(1, Math.min(parseInt(args.limit, 10) || 5, 8));
      var hits = retrieve(q, limit);
      if (!hits.length) {
        return { ok: true, count: 0, results: [], hint: "No matching notes; try fewer or different keywords." };
      }
      var results = [];
      for (var i = 0; i < hits.length; i++) {
        if (i < 3) cited[hits[i].slug] = hits[i].title;
        results.push({ slug: hits[i].slug, title: hits[i].title, snippet: snippetFor(hits[i], q) });
      }
      return { ok: true, count: hits.length, results: results };
    }
    if (name === "navigate_to_page") {
      var slug = String((args && args.slug) || "").trim();
      if (!slug) return { ok: false, error: "slug is required" };
      var entry = findEntryBySlug(slug);
      if (!entry) {
        return { ok: false, error: "No note with slug \"" + slug + "\". Call search_knowledge_base first and use one of the returned slugs." };
      }
      var url;
      try { url = new URL(BASE + "/" + slug, location.href); }
      catch (e) { return { ok: false, error: "Invalid slug: " + slug }; }
      try {
        if (typeof window.spaNavigate === "function") window.spaNavigate(url);
        else location.assign(url.href);
      } catch (e) {
        return { ok: false, error: "Navigation failed: " + (e && e.message ? e.message : e) };
      }
      return { ok: true, opened: entry.title, slug: slug, note: "The page in the user's browser changed to this note." };
    }
    if (name === "read_current_page") {
      var max = Math.min(parseInt((args && args.max_chars), 10) || PAGE_READ_MAX, 2000);
      var art = document.querySelector("article");
      var text = art ? art.textContent.replace(/\s+/g, " ").trim() : "";
      return {
        ok: true,
        title: document.title || "",
        slug: currentPageMeta().slug,
        text: text.slice(0, max)
      };
    }
    return { ok: false, error: "Unknown tool: " + name };
  }

  // ---- Agent loop (WebLLM OpenAI-style tool calling) ----
  //
  // WebLLM 0.2.85, for Hermes models with `tools` present:
  //   - rejects any custom system message (it injects its own)
  //   - forces the output to the Hermes tool-call JSON schema
  //   - streams the raw JSON as delta.content; the FINAL chunk carries
  //     delta.tool_calls and finish_reason "tool_calls"
  // So: buffer each turn; if it ends with tool_calls, replace the
  // (JSON) text with chips, execute the tools, push the assistant JSON
  // turn plus {role:"tool"} results, and loop. A turn that ends with
  // plain text is the final answer.
  function mergeToolCallsDelta(acc, deltaArr) {
    if (!deltaArr) return acc;
    var out = acc || [];
    for (var i = 0; i < deltaArr.length; i++) {
      var d = deltaArr[i];
      var idx = d.index != null ? d.index : i;
      if (!out[idx]) out[idx] = { name: "", arguments: "", id: "" };
      if (d.id) out[idx].id = d.id;
      if (d.function && d.function.name) out[idx].name += d.function.name;
      if (d.function && d.function.arguments != null) out[idx].arguments += d.function.arguments;
    }
    return out;
  }

  function safeParseArgs(s) {
    if (!s) return {};
    try {
      var v = JSON.parse(s);
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }

  function buildAgentUserTurn(query) {
    var page = currentPageMeta();
    var ctx =
      "You are the FAQ assistant for the CityUHK (City University of Hong Kong) " +
      "Computer Science undergraduate admission site (1035 notes). " +
      "Decision rule, follow it exactly:\n" +
      "- If the user refers to the current/this page (e.g. \"summarize this page\", " +
      "\"what does this page say\"): call read_current_page IMMEDIATELY and do NOT call " +
      "search_knowledge_base — the page IS the source.\n" +
      "- Any other question: call search_knowledge_base, then answer from the results; " +
      "call navigate_to_page only if the user wants the source note opened.\n" +
      "Be concise and factual. Answer only from what the notes and the page contain; " +
      "if they have no answer, say so.";
    if (page.title) ctx += " Current page: " + page.title + " (slug: " + page.slug + ").";
    return ctx + "\n\n" + query;
  }

  // System prompt for Phase 2 (the no-tools answer round). A custom system
  // prompt is only legal on a request WITHOUT tools (WebLLM rejects it when
  // tools are present), so this is where the model gets its answer instructions.
  function buildAnswerSystem() {
    return (
      "You are the FAQ assistant for the CityUHK (City University of Hong Kong) " +
      "Computer Science undergraduate admission site. The user asked a question " +
      "and one site tool has already been run for you; its result is provided " +
      "below. Write the final answer NOW in plain text (no JSON, no tool calls). " +
      "Be concise and factual, and answer only from the provided content — if it " +
      "does not contain the answer, say so. You may cite the note titles given."
    );
  }

  // User message for Phase 2: the original question plus the tool result as text.
  function buildAnswerTurn(query, toolNote) {
    var s = "User question: " + query + "\n\n";
    if (toolNote) {
      s += "Tool result from the site:\n" + toolNote + "\n";
    } else {
      s += "(No tool result was available.)\n\n";
    }
    s += "Answer the user question now in plain text.";
    return s;
  }

  async function runAgent(query) {
    // Recent plain exchanges (tool turns are not kept in history). The
    // current user query was already pushed by sendMessage — exclude it
    // here; Phase 1 appends the context-wrapped version.
    var history = [];
    var plain = conversationHistory.filter(function (m) {
      return (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
    });
    if (plain.length && plain[plain.length - 1].role === "user" && plain[plain.length - 1].content === query) {
      plain = plain.slice(0, -1);
    }
    plain.slice(-AGENT_HISTORY).forEach(function (m) {
      var c = m.content;
      if (m.role === "assistant" && c.length > AGENT_TURN_TRIM) c = c.slice(0, AGENT_TURN_TRIM) + "\u2026";
      history.push({ role: m.role, content: c });
    });

    var cited = {};

    // ------------------------------------------------------------------
    // PHASE 1 — tool selection (grammar-locked by WebLLM).
    //
    // When `tools` is present, WebLLM 0.2.85 forces
    //   request.response_format = { type:"json_object", schema:<tool-call
    //   array> }  and grammar-locks the output to that schema
    // (postInitAndCheckFields, lib/index.js ~12152). The model therefore
    // CANNOT emit a plain-text answer on a request that carries `tools` —
    // it is forced to emit a tool call. So this round only ever returns
    // tool call(s); we execute them and collect the result.
    // ------------------------------------------------------------------
    showTyping(true);
    var toolRequest = {
      messages: history.concat([{ role: "user", content: buildAgentUserTurn(query) }]),
      temperature: 0.3,
      max_tokens: 1024,
      stream: true,
      tool_choice: "auto",
      tools: TOOLS
    };
    if (window.__aiChatLog) console.log("[ai-chat] PHASE1 (tools) REQUEST", JSON.parse(JSON.stringify(toolRequest)));
    var stream1 = await engine.chat.completions.create(toolRequest);
    var content1 = "";
    var toolCalls = null;
    var liveEl = null;
    for await (var chunk of stream1) {
      var choice = chunk.choices && chunk.choices[0];
      if (!choice) continue;
      var delta = choice.delta;
      if (delta && delta.content) {
        content1 += delta.content;
        if (!liveEl) {
          showTyping(false);
          liveEl = appendMessage("assistant", "");
        }
        liveEl.innerHTML = renderMarkdown(content1);
        scrollBottom();
      }
      if (delta && delta.tool_calls) toolCalls = mergeToolCallsDelta(toolCalls, delta.tool_calls);
    }
    showTyping(false);
    if (window.__aiChatLog) console.log("[ai-chat] PHASE1 RESPONSE", JSON.stringify({ content: content1, toolCalls: toolCalls }));

    var toolNote = ""; // human-readable tool result, fed to Phase 2

    if (toolCalls && toolCalls.length) {
      // Tool-call turn: the streamed text is the raw JSON — swap it for chips.
      if (liveEl) liveEl.remove();
      for (var ti = 0; ti < toolCalls.length; ti++) {
        var tc = toolCalls[ti];
        var argsObj = safeParseArgs(tc.arguments);
        var t = { name: tc.name, arguments: argsObj };
        addToolChip(t.name, t.arguments);
        var result = executeTool(t.name, t.arguments, cited);
        toolNote +=
          "Tool " + t.name + "(" + JSON.stringify(t.arguments) + ") returned:\n" +
          JSON.stringify(result).slice(0, TOOL_RESULT_MAX) + "\n\n";
      }
    } else if (content1.trim()) {
      // Defensive: if the model emitted plain text instead of a tool call,
      // treat it as the final answer and stop.
      var el1 = liveEl;
      if (!el1 && content1) el1 = appendMessage("assistant", content1);
      if (el1 && content1) {
        el1.innerHTML = renderMarkdown(content1);
        appendCitations(el1, cited);
        scrollBottom();
      }
      conversationHistory.push({ role: "assistant", content: content1 });
      return;
    }

    // ------------------------------------------------------------------
    // PHASE 2 — plain-text answer (no tools).
    //
    // Because this request has NO `tools`, WebLLM does not grammar-lock the
    // output and does not inject/restrict the system prompt — the model can
    // freely write a normal answer. The tool result is passed as TEXT inside
    // the user message (not a role:"tool" message) so we do not depend on the
    // chat template defining a "tool" role.
    // ------------------------------------------------------------------
    showTyping(true);
    var answerRequest = {
      messages: [
        { role: "system", content: buildAnswerSystem() },
        { role: "user", content: buildAnswerTurn(query, toolNote) }
      ],
      temperature: 0.3,
      max_tokens: 1024,
      stream: true
    };
    if (window.__aiChatLog) console.log("[ai-chat] PHASE2 (answer) REQUEST", JSON.parse(JSON.stringify(answerRequest)));
    var stream2 = await engine.chat.completions.create(answerRequest);
    var reply = "";
    var msgEl = appendMessage("assistant", "");
    // Render markdown into an inner wrapper so the citations element (a
    // sibling) survives the per-delta innerHTML re-render.
    var inner = el("div", { className: "ai-chat-md" });
    if (msgEl) msgEl.appendChild(inner);
    var srcDone = false;
    for await (var chunk of stream2) {
      var d =
        (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || "";
      if (!d) continue;
      reply += d;
      if (msgEl) {
        inner.innerHTML = renderMarkdown(reply);
        if (!srcDone) {
          appendCitations(msgEl, cited);
          srcDone = true;
        }
        scrollBottom();
      }
    }
    showTyping(false);
    if (window.__aiChatLog) console.log("[ai-chat] PHASE2 RESPONSE", JSON.stringify(reply));
    conversationHistory.push({ role: "assistant", content: reply });
    if (!reply.trim()) addSystemMessage("(The model returned an empty answer)");
  }

  // ---- Fast path: RAG-only single completion (no tools) ----
  async function fastAnswer(query) {
    var sources = retrieve(query, TOP_K);
    var article = document.querySelector("article");
    var pageContext = article
      ? article.textContent.replace(/\s+/g, " ").trim().slice(0, 1200)
      : "";

    var context =
      "You are a helpful assistant for the CityUHK (City University of Hong Kong) " +
      "Computer Science undergraduate admission FAQ site (fast mode: no page tools). " +
      "Answer based on the retrieved notes below. Be concise and factual. " +
      "If the notes do not contain an answer, say you are unsure and suggest " +
      "searching the site. Cite source note names when referencing specific facts.\n\n";
    if (pageContext) {
      context += "=== Current page: " + (document.title || "") + " ===\n" + pageContext + "\n\n";
    }
    if (sources.length) {
      context += "=== Retrieved notes ===\n";
      for (var i = 0; i < sources.length; i++) {
        context += "--- " + sources[i].title + " (" + sources[i].slug + ") ---\n" + sources[i].text.slice(0, 800) + "\n\n";
      }
    } else {
      context += "=== No relevant notes found. Be cautious and say you are unsure if you do not know. ===\n";
    }

    var messages = [{ role: "system", content: context }].concat(
      conversationHistory.slice(-HISTORY_KEEP)
    );
    var stream = await engine.chat.completions.create({
      messages: messages,
      temperature: 0.3,
      max_tokens: 1024,
      stream: true
    });
    var msgEl = appendMessage("assistant", "");
    // Render markdown into an inner wrapper so the citations element (a
    // sibling) survives the per-delta innerHTML re-render.
    var inner = el("div", { className: "ai-chat-md" });
    if (msgEl) msgEl.appendChild(inner);
    var reply = "";
    var srcDone = !sources.length;
    for await (var chunk of stream) {
      var delta =
        (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || "";
      if (!delta) continue;
      reply += delta;
      if (msgEl) {
        inner.innerHTML = renderMarkdown(reply);
        if (!srcDone) {
          appendCitations(msgEl, sources);
          srcDone = true;
        }
        scrollBottom();
      }
    }
    conversationHistory.push({ role: "assistant", content: reply });
    if (!reply.trim()) addSystemMessage("(model returned an empty reply)");
  }

  function setBusy(on) {
    var ta = document.getElementById("ai-chat-input");
    var btn = document.getElementById("ai-chat-send");
    if (ta) ta.disabled = on;
    if (btn) btn.disabled = on;
  }

  // ---- Send message ----
  async function sendMessage() {
    var inputEl = document.getElementById("ai-chat-input");
    var sendBtn = document.getElementById("ai-chat-send");
    if (!inputEl || isGenerating) return;
    var query = inputEl.value.trim();
    if (!query) return;

    inputEl.value = "";
    if (inputEl.style.height) inputEl.style.height = "";

    if (!engine) {
      addSystemMessage(
        "No model loaded yet. Open \u2699\uFE0F settings and click \u201CLoad model\u201D, then try again."
      );
      openSettings();
      return;
    }

    isGenerating = true;
    setBusy(true);
    appendMessage("user", query);
    conversationHistory.push({ role: "user", content: query });
    showTyping(true);

    try {
      if (isAgentModel(currentModelId)) await runAgent(query);
      else await fastAnswer(query);
    } catch (e) {
      showTyping(false);
      addSystemMessage("Error: " + (e && e.message ? e.message : e));
    } finally {
      isGenerating = false;
      setBusy(false);
    }
  }

  // ---- Settings modal ----
  function openSettings() {
    var existing = document.getElementById("ai-chat-settings-overlay");
    if (existing) return;
    var overlay = el("div", {
      id: "ai-chat-settings-overlay",
      className: "ai-chat-settings-overlay",
      onclick: function (e) { if (e.target === overlay) overlay.remove(); }
    });
    var modal = el("div", { className: "ai-chat-settings" });
    modal.appendChild(el("h3", { textContent: "AI Chat Settings" }));

    var label = el("label", { textContent: "Model (runs in your browser via WebGPU)" });
    var select = el("select", { id: "ai-chat-setting-model" });
    var saved = storageGetModel() || DEFAULT_MODEL;
    if (MODELS.indexOf(saved) < 0) saved = DEFAULT_MODEL;
    var ogAgent = el("optgroup", {
      label: "Agent \u2014 tool calling: searches the notes, opens pages, reads your current page (larger, \u22485 GB first load)"
    });
    AGENT_MODELS.forEach(function (m) {
      var opt = el("option", { value: m, textContent: m });
      if (m === saved) opt.selected = true;
      ogAgent.appendChild(opt);
    });
    var ogFast = el("optgroup", {
      label: "Fast \u2014 retrieved-note answers only, no page tools (smaller, \u22482 GB first load)"
    });
    FAST_MODELS.forEach(function (m) {
      var opt = el("option", { value: m, textContent: m });
      if (m === saved) opt.selected = true;
      ogFast.appendChild(opt);
    });
    select.appendChild(ogAgent);
    select.appendChild(ogFast);
    modal.appendChild(label);
    modal.appendChild(select);

    var hint = el("p", { className: "settings-hint" });
    hint.textContent =
      "Agent models can call tools: search the 1035 FAQ notes, open the source page in your browser, and read the page you are viewing. " +
      "Fast models answer from the notes I retrieve for you. " +
      "The model downloads once and is cached in your browser. Nothing is sent to any server.";
    modal.appendChild(hint);

    var actions = el("div", { className: "settings-actions" });
    actions.appendChild(el("button", {
      textContent: "Cancel",
      onclick: function () { overlay.remove(); }
    }));
    actions.appendChild(el("button", {
      className: "primary",
      textContent: "Load model",
      onclick: function () {
        var chosen = select.value;
        storageSetModel(chosen);
        overlay.remove();
        addSystemMessage("Loading " + chosen + " \u2026 (first time takes a while)");
        loadEngine(chosen);
      }
    }));
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.documentElement.appendChild(overlay);
  }

  function clearChat() {
    conversationHistory = [];
    showWelcome();
  }

  function togglePanel() {
    var panel = document.getElementById("ai-chat-panel");
    var fab = document.getElementById("ai-chat-fab");
    if (!panel || !fab) return;
    panelOpen = !panelOpen;
    panel.classList.toggle("closed", !panelOpen);
    fab.classList.toggle("hidden", panelOpen);
    if (panelOpen) {
      var ta = document.getElementById("ai-chat-input");
      if (ta && !ta.disabled) ta.focus();
    }
  }

  // ---- Build UI (mount on <html> so SPA navigation keeps it) ----
  function buildUI() {
    if (document.getElementById("ai-chat-fab")) return;

    var fab = el("button", {
      id: "ai-chat-fab",
      className: "ai-chat-fab",
      title: "AI Chat Assistant",
      onclick: togglePanel,
      textContent: "\uD83D\uDCAC"
    });
    document.documentElement.appendChild(fab);

    var panel = el("div", { id: "ai-chat-panel", className: "ai-chat-panel closed" });

    var header = el("div", { className: "ai-chat-header" });
    header.appendChild(el("h3", { textContent: "CS Admission FAQ" }));
    var actions = el("div", { className: "ai-chat-header-actions" });
    actions.appendChild(el("button", { title: "Settings", textContent: "\u2699\uFE0F", onclick: openSettings }));
    actions.appendChild(el("button", { title: "Clear chat", textContent: "\uD83D\uDDD7\uFE0F", onclick: clearChat }));
    actions.appendChild(el("button", { title: "Close", textContent: "\u2715", onclick: togglePanel }));
    header.appendChild(actions);
    panel.appendChild(header);

    var status = el("div", { className: "ai-chat-status" });
    status.appendChild(el("span", { id: "ai-chat-status-dot", className: "status-dot" }));
    status.appendChild(el("span", { id: "ai-chat-status-text", textContent: "Starting\u2026" }));
    panel.appendChild(status);

    panel.appendChild(el("div", { id: "ai-chat-messages", className: "ai-chat-messages" }));

    var inputArea = el("div", { className: "ai-chat-input-area" });
    var textarea = el("textarea", {
      id: "ai-chat-input",
      placeholder: "Ask a question about CityUHK CS admission\u2026",
      rows: "1"
    });
    textarea.addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 120) + "px";
    });
    textarea.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    inputArea.appendChild(textarea);
    inputArea.appendChild(el("button", {
      id: "ai-chat-send",
      textContent: "\u27A4",
      onclick: sendMessage
    }));
    panel.appendChild(inputArea);

    document.documentElement.appendChild(panel);
  }

  // ---- Debug / test hook (harmless in production) ----
  window.__aiChatDebug = {
    setEngine: function (e, modelId) {
      engine = e;
      if (modelId) currentModelId = modelId;
    },
    getModel: function () { return currentModelId; },
    history: function () { return conversationHistory.slice(); },
    tools: TOOLS
  };

  // ---- Init ----
  function init() {
    buildUI();
    showWelcome();
    loadKnowledgeIndex();
    var saved = storageGetModel();
    if (saved) {
      loadEngine(saved);
    } else {
      setStatus("ready", "Open \u2699 settings to load a model (in-browser)");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
