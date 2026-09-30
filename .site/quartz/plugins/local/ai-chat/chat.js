/* ================================================================
 AI Chat Widget — CityUHK CS Admission FAQ
 In-browser LLM (WebLLM, WebGPU) OR any OpenAI-compatible
 /chat/completions endpoint (OpenRouter, Groq, OpenAI, local
 llama.cpp/Ollama/llama-server, vLLM, ...) + keyword RAG over a
 static knowledge index + a client-side AGENT LOOP with tool calling
 (search notes, open a page, read the current page).
 In-browser mode: no data leaves the browser. External mode: your
 questions go to the endpoint you configure (key kept in this
 browser's localStorage).

 WebLLM function-calling notes (verified against the 0.2.85
 bundle source):
 - Only the Hermes-2-Pro / Hermes-3 8B/7B family is in the
   bundle's functionCallingModelIds. For those models, passing
   `tools` makes WebLLM (a) forbid any custom `system` message
   (it injects its own Hermes tool-prompt), (b) force the output
   to the Hermes function-call JSON schema, and (c) return the
   parsed calls as `delta.tool_calls` on the last streaming
   chunk (finish_reason "tool_calls").
 - Consequence: while `tools` is present the model CANNOT emit a
   plain-text answer (grammar lock). Hence the two-phase loop:
   Phase 1 (tools) selects/runs the tool, Phase 2 (no tools)
   writes the answer. External endpoints do NOT have this
   restriction, so a single request can answer with tools attached.
 - Non-Hermes small models get RAG-only answers (fast mode).
 Plain top-level script (no import/export): works both as an ES
 module (production build) and inside the IIFE-wrapped serve-mode
 bundle. Mounts into <html> (not document.body) so the SPA
 router, which morphs document.body, never destroys the widget.
 ================================================================ */
  // NOTE: this file is concatenated AFTER tools.js and wrapped in a SINGLE
  // IIFE by the plugin loader (index.js), so tools.js and this file share one
  // scope (tools.js reads knowledgeIndex/BASE defined here). Do NOT add an
  // outer function wrapper here.
  if (window.__aiChatLoaded) return;
  window.__aiChatLoaded = true;

  // This app registers NO service worker. But an earlier deployment left a
  // stale SW on the origin in some browsers, and it intercepts fetches (a
  // "no-op fetch handler") and 404s /static/knowledge-index.json. Unregister
  // any SW present so the page reclaims itself and fetches hit the network.
  (function clearStaleServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      navigator.serviceWorker
        .getRegistrations()
        .then(function (regs) {
          if (!regs.length) return;
          regs.forEach(function (r) { r.unregister(); });
          if (console && console.info) {
            console.info("[ai-chat] removed " + regs.length + " stale service worker(s) (this site uses none)");
          }
        })
        .catch(function () {});
    } catch (e) {}
  })();

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
  var TOP_K = 8; // notes retrieved for grounding (was 5)
  var CITE_SHOW = 6; // how many retrieved notes are shown as links
  var HISTORY_KEEP = 6; // plain-text messages kept for fast mode
  var AGENT_HISTORY = 4; // plain-text messages kept for agent mode
  var AGENT_TURN_TRIM = 400; // trim old assistant replies in agent history
  var MAX_AGENT_TURNS = 4; // max model calls per user query (agent)
  var TOOL_RESULT_MAX = 2600; // chars of a tool result fed back to the model
  var PAGE_READ_MAX = 1200; // default chars for read_current_page
  var STORAGE_MODEL = "cityu-ai-chat-model";
  var STORAGE_ENDPOINT = "cityu-ai-chat-endpoint"; // {kind,baseUrl,key,model}
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

  // ---- Provider config: "inbrowser" (WebLLM/WebGPU, default) or
  // "external" (any OpenAI-compatible /chat/completions endpoint, e.g.
  // OpenRouter, Groq, local llama.cpp/Ollama/OpenAI-compatible servers).
  // The API key is stored in localStorage of THIS browser only. ----
  function endpointCfg() {
    try {
      var o = JSON.parse(localStorage.getItem(STORAGE_ENDPOINT) || "null");
      if (!o || (o.kind !== "external" && o.kind !== "inbrowser")) return null;
      return o;
    } catch (e) { return null; }
  }
  function saveEndpointCfg(o) {
    try { localStorage.setItem(STORAGE_ENDPOINT, JSON.stringify(o)); } catch (e) {}
  }
  function clearEndpointCfg() {
    try { localStorage.removeItem(STORAGE_ENDPOINT); } catch (e) {}
  }
  function isExternal() { return !!(endpointCfg() && endpointCfg().kind === "external"); }
  function providerReady() {
    return !!(engine || isExternal() || isFree());
  }
  function providerStatusText() {
    if (isExternal()) return "Server ready: " + endpointModelName();
    if (isFree()) return "Free server ready: " + freeModelName();
    return engine ? "Model ready" : "No model loaded";
  }
  function endpointModelName() {
    var c = endpointCfg();
    return (c && c.model) ? String(c.model).trim() : "";
  }

  // ---- "Free" site-provided provider (time-limited special event) ----
  // A first-class, no-setup provider: on page load we fetch a small JSON
  // config (public gist) so the site owner can ROTATE THE KEY or switch it
  // off instantly — no repo push, no rebuild, no Pages redeploy:
  //   {"enabled": true, "baseUrl": "https://.../v1", "key": "sk-...", "model": "..."}
  // If enabled and the key passes a live probe (/models), visitors get
  // grounded (RAG) answers for free with zero configuration. If the config
  // is missing/disabled, the key is rejected (401/403), or the server is
  // down, the "free" option simply does not exist and visitors fall back to
  // the normal "open settings and configure a model/server" flow.
  //
  // Priority: an explicitly saved choice (in-browser model or a user-entered
  // external server) always wins over the free provider.
  //
  // SECURITY NOTE: on a static site the key must reach the browser, so a
  // determined visitor with DevTools can read the Authorization header. The
  // embedded fallback key below is split + base64-encoded so it is not
  // visible by casually searching the bundle — but the real protection is a
  // SHORT-LIVED, REVOCABLE key (revoking it disables "free" site-wide
  // instantly) plus server-side spend/expiry limits on LiteLLM.
  // Rotation without a rebuild: a small PUBLIC GIST (see FREE_CONFIG_URL)
  // is the single source of truth for the free service. Its content may be
  //   (a) an OPAQUE one-line base64 string (recommended — not human-readable)
  //       that decodes to JSON:
  //         {"enabled":true,"baseUrl":"https://…/v1","key":"sk-…","model":"Socrates"}
  //   or (b) the same JSON in plain text.
  // The ENDPOINT, KEY and MODEL all come from the gist. Guard: the gist's
  // baseUrl is honoured only if it is https AND its host is in
  // FREE_TRUSTED_HOSTS (a public gist is editable by anyone — this stops it
  // from redirecting the site's traffic and key to an untrusted server).
  // A parseable gist is FINAL: enabled:false (or an untrusted endpoint)
  // switches free OFF even if the embedded key below is still valid. The
  // embedded fallback is used only when the gist is absent/unreachable.
  var FREE_CONFIG_URL = "https://gist.githubusercontent.com/ccha23/ca77b49f347a40190eda640295dd67b5/raw/CityUHK_Admission_FAQ"; // gist raw URL (stable, no revision hash); empty -> embedded fallback only
  var FREE_TRUSTED_HOSTS = ["socratic.cs.cityu.edu.hk"]; // https hosts the gist may point to
  var FREE_FALLBACK_BASE = "https://socratic.cs.cityu.edu.hk/litellm/v1";
  var FREE_FALLBACK_KEY_PARTS = ["c2stMGlEUS1E", "RzZXNjVPWDhZ", "bHhFTXlTdw=="];
  var FREE_FALLBACK_MODEL = "Socrates";
  var FREE_MAX_TOKENS = 2048; // Socrates is a reasoning model (needs room)
  var freeCfg = null; // {baseUrl, key, model} — set only after a live probe
  var freeChecking = false;
  var freeNote = ""; // short owner note, e.g. gist key fell back to built-in
  // Status-line composition state (provider + knowledge index).
  var _lastProvStatus = null;
  var knowledgeStatusMsg = "";

  function freeFallbackKey() {
    try { return atob(FREE_FALLBACK_KEY_PARTS.join("")); } catch (e) { return ""; }
  }
  // Verify the key with a cheap GET /models before advertising "free".
  async function freeProbe(base, key, model) {
    var ctl = (window.AbortController ? new AbortController() : null);
    var to = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : null;
    try {
      var res = await fetch(String(base).replace(/\/+$/, "") + "/models", {
        headers: { "Authorization": "Bearer " + key },
        cache: "no-store",
        signal: ctl ? ctl.signal : undefined
      });
      if (!res.ok) return null;
      var data = await res.json();
      var id = (data && data.data && data.data.length) ? String(data.data[0].id) : "";
      return { baseUrl: String(base).replace(/\/+$/, ""), key: String(key), model: id || model || "model" };
    } catch (e) { return null; }
    finally { if (to) clearTimeout(to); }
  }
  // ---- Free-provider configuration ----------------------------------------
  // The gist is the single source of truth. Its file content is EITHER:
  //   (a) a plain JSON object, or
  //   (b) an OPAQUE one-line base64 string that DECODES to that JSON.
  // Either may carry: {"enabled":true,"baseUrl":"https://…/v1","key":"sk-…","model":"Socrates"}
  // A parseable gist is FINAL: it can enable, disable, or rotate — even an
  // enabled:false beats the embedded fallback. The embedded fallback is used
  // ONLY when the gist is absent or unreachable (fetch fails).
  // TRUST GUARD: the gist's baseUrl is honoured only if it is https AND its
  // host is in FREE_TRUSTED_HOSTS (a public gist is editable by anyone — this
  // stops a tampered gist from redirecting the site's traffic and key to an
  // attacker's endpoint). An untrusted baseUrl is treated as "disabled".
  function freeTrustedBase(url) {
    var u = String(url || "").trim();
    if (!/^https:\/\//i.test(u)) return null;
    var host = "";
    try { host = new URL(u).hostname.toLowerCase(); } catch (e) { return null; }
    for (var i = 0; i < FREE_TRUSTED_HOSTS.length; i++) {
      if (host === FREE_TRUSTED_HOSTS[i]) return u.replace(/\/+$/, "");
    }
    return null;
  }
  function freeDecodeConfig(text) {
    var t = String(text || "").trim();
    if (!t) return null;
    // (a) already JSON?
    if (t.charAt(0) === "{") { try { return JSON.parse(t); } catch (e) { return null; } }
    // (b) opaque base64 -> decode -> JSON
    try {
      var b64 = t.replace(/[\s\u0000-\u001f]/g, "");
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
      var decoded = new TextDecoder("utf-8").decode(bytes); // safe UTF-8
      return JSON.parse(decoded);
    } catch (e) { return null; }
  }
  // Fetch the gist, decode it, and set freeCfg (or clear it if disabled).
  // Returns {status: "on"|"off"|"unreachable"} so callers can tell the
  // embedded fallback apart from an explicit off-switch.
  async function loadFreeGist() {
    var status = "unreachable";
    if (!FREE_CONFIG_URL) return status;
    try {
      var r = await fetch(FREE_CONFIG_URL, { cache: "no-store" });
      if (!r.ok) return status; // 404 (deleted) / rate-limited -> fall through
      var cfg = freeDecodeConfig(await r.text());
      if (!cfg) return status;
      // Parseable gist is final.
      if (cfg.enabled === false) return "off";
      if (cfg.enabled !== true) return "off";
      var key = typeof cfg.key === "string" ? cfg.key.trim() : "";
      var base = freeTrustedBase(cfg.baseUrl || FREE_FALLBACK_BASE);
      if (!key || !base) return "off";
      freeCfg = await freeProbe(base, key, cfg.model || FREE_FALLBACK_MODEL);
      if (freeCfg) { freeNote = ""; return "on"; }
      // Gist key was rejected (typo, already rotated, ...) — keep the service
      // up with the embedded key instead of going dark, and tell the owner.
      var fk = freeFallbackKey();
      if (fk && fk !== key) {
        freeCfg = await freeProbe(base, fk, cfg.model || FREE_FALLBACK_MODEL);
        if (freeCfg) {
          freeNote = " (gist key rejected — using built-in fallback key; fix the gist)";
          return "on";
        }
      }
      return "off";
    } catch (e) { return status; }
  }
  // Load free config (gist first, else embedded fallback) and set freeCfg.
  async function loadFreeConfig() {
    if (freeChecking) return;
    freeChecking = true;
    try {
      var s = await loadFreeGist();
      if (s === "unreachable" && !freeCfg) {
        // No usable gist -> try the embedded key at the trusted base.
        var key = freeFallbackKey();
        if (key) freeCfg = await freeProbe(FREE_FALLBACK_BASE, key, FREE_FALLBACK_MODEL);
      }
    } finally { freeChecking = false; }
  }
  function isFree() { return !!freeCfg; }
  function freeModelName() { return freeCfg ? (freeCfg.model || "server") : ""; }
  // Silently drop the free provider (e.g. the visitor chose their own model
  // or server). No message.
  function clearFree() { freeCfg = null; }
  // Drop the free provider because it failed at runtime (key revoked, 401/403)
  // and tell the visitor to configure their own.
  function invalidateFree(reason) {
    if (!freeCfg) return;
    freeCfg = null;
    addSystemMessage(
      "The free AI service is no longer available" + (reason ? " (" + reason + ")" : "") +
      ". Open \u2699 settings to load a model in your browser or connect your own server."
    );
  }
  // Switch to the free provider (no model download, no user input).
  function activateFree() {
    if (!freeCfg) return;
    setStatus("ready", "Free server ready: " + freeModelName());
    var note = freeNote ? freeNote : "";
    addSystemMessage(
      "Free AI is available now \u2014 I answer from the 1035 FAQ notes I retrieve for you. No setup needed." + note
    );
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
  function storageClearModel() {
    try { localStorage.removeItem(STORAGE_MODEL); } catch (e) {}
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

  // ---- MathJax (lazy, tex-svg: no font files needed) ----
  // Assistant message content may contain $...$ / $$...$$ math. We typeset it
  // with MathJax v3 (loaded once, on demand). Because the model's answer may
  // arrive before MathJax has finished loading (first use), we QUEUE scopes
  // and flush them as soon as MathJax is ready (or via a fallback poll for
  // the first ~20s). Only FINAL (non-streaming) renders enqueue, so partial
  // math is never typeset.
  var mjxReady = false;
  var mjxPending = [];
  function mjxPump() {
    if (!mjxReady || !window.MathJax || !window.MathJax.typesetPromise) return;
    while (mjxPending.length) {
      var s = mjxPending.shift();
      try { window.MathJax.typesetPromise([s]).catch(function () {}); } catch (e) {}
    }
  }
  (function () {
    var cfg = {
      tex: { inlineMath: [["$", "$"]], displayMath: [["$$", "$$"]], processEscapes: true, processEnvironments: true },
      svg: { fontCache: "global" },
      options: { enableMenu: false }
    };
    if (window.MathJax) { for (var k in cfg) window.MathJax[k] = cfg[k]; }
    else { window.MathJax = cfg; }
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js";
    s.async = true;
    s.onload = function () { mjxReady = true; mjxPump(); };
    document.head.appendChild(s);
    // Fallback: flush pending scopes periodically while MathJax is loading
    // (covers the case where a final answer lands before the CDN resolves).
    var tries = 0;
    var iv = setInterval(function () { tries++; mjxPump(); if (tries > 20 || mjxReady && !mjxPending.length) clearInterval(iv); }, 1000);
  })();
  function typesetIfReady(el) {
    if (!el) return;
    var scope = el.querySelector("[data-math]") || (el.hasAttribute && el.hasAttribute("data-math") ? el : null);
    if (!scope) return;
    mjxPending.push(scope);
    mjxPump(); // flush now if MathJax is ready (else the interval will)
  }

  // ---- Live QR codes (pure JS, no server) ----
  // Vendored qrcode-generator (MIT) exposes a global `qrcode` in this scope
  // (see index.js). A QR for a URL renders in ~10 ms as a small inline SVG
  // data-URL — far faster than spinning up Pyodide (10 MB runtime) or a
  // server round-trip, and it works fully offline once the page is loaded.
  var qrCache = {};
  function qrSvgDataUrl(text) {
    var cached = qrCache[text];
    if (cached) return cached;
    var qr = qrcode(0, "M"); // auto-size, medium error correction
    qr.addData(String(text));
    qr.make();
    var n = qr.getModuleCount();
    // One explicit unit square per dark module: "M c r h1 v1 h-1 z" (move to
    // the cell's top-left, then relative steps). Using a fresh M per cell is
    // unambiguous — a single continuous path with per-cell Z would close every
    // cell back to the row's first point and render as garbage.
    var d = "";
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
      }
    }
    // Quiet zone: QR decoders (phone cameras and jsQR alike) need a white
    // margin of >=4 modules around the code, so pad the viewBox by 4 on each
    // side and shift the code path in by 4.
    var M = 4, N = n + M * 2;
    // Intrinsic pixel size that is an EXACT multiple of the (padded) module
    // count so each module maps to whole pixels (crisp + scannable).
    var cell = Math.max(4, Math.round(180 / N));
    var size = N * cell;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 ' + N + " " + N +
      '" shape-rendering="crispEdges"><rect width="' + N + '" height="' + N +
      '" fill="#fff"/><path transform="translate(' + M + "," + M + ')" d="' + d +
      '" fill="#111"/></svg>';
    var url = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    if (Object.keys(qrCache).length > 200) qrCache = {}; // bound the memo
    qrCache[text] = url;
    return url;
  }

  // Hover a link (citation or inline) in an assistant message -> a QR code
  // of that link's URL appears next to the cursor. One shared tooltip,
  // event-delegated on the messages box, positioned with viewport clamping.
  function attachLinkQrHover(box) {
    if (!box || box.__qrWired) return;
    box.__qrWired = true;
    var tip = el("div", { className: "ai-chat-qr-tip", id: "ai-chat-qr-tip" });
    var tipImg = el("img", { className: "ai-chat-qr-tip-img", alt: "QR code of the linked page" });
    var tipUrl = el("span", { className: "ai-chat-qr-tip-url" });
    tip.appendChild(tipImg);
    tip.appendChild(tipUrl);
    document.body.appendChild(tip);

    function show(link) {
      var href = link.getAttribute("href") || "";
      // Resolve to an absolute URL: a QR must encode something that scans to
      // the real page off-device, so relative/anchor links get the current
      // origin (or the current page URL for in-page anchors) prefixed.
      var abs;
      if (/^https?:/i.test(href)) abs = href;
      else if (href.charAt(0) === "#") abs = location.href.split("#")[0] + href;
      else abs = location.origin + (href.charAt(0) === "/" ? href : "/" + href);
      if (!/^https?:/i.test(abs)) return;
      tipImg.src = qrSvgDataUrl(abs);
      tipUrl.textContent = abs.replace(/^https?:\/\//, "").slice(0, 48);
      var r = link.getBoundingClientRect();
      var W = 168, H = 190;
      var x = r.left - W - 10; // prefer left of the cursor/link
      if (x < 8) x = r.right + 10;
      var y = r.top + r.height / 2 - H / 2;
      y = Math.max(8, Math.min(y, window.innerHeight - H - 8));
      x = Math.max(8, Math.min(x, window.innerWidth - W - 8));
      tip.style.left = x + "px";
      tip.style.top = y + "px";
      tip.style.display = "flex";
    }
    function hide() { tip.style.display = "none"; }

    box.addEventListener("mouseover", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (a) show(a);
    });
    box.addEventListener("mouseout", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (a && !(e.relatedTarget && a.contains(e.relatedTarget))) hide();
    });
    window.addEventListener("scroll", hide, { capture: true, passive: true });
  }

  // ---- Always-visible "share" button: QR of the CURRENT page (full URL) ----
  // The chat works on note slugs, so the model can't hand the user the
  // published URL. This button always shows a QR that scans to the current
  // page's full GitHub Pages URL. Click toggles it; "Copy link" copies the
  // URL. It re-targets on every in-app (SPA) navigation. The QR is generated
  // lazily (memoized by URL) so the initial page load is never blocked.
  var qrCard = null;
  function currentPageFullUrl() {
    // Full published URL (origin + path), no hash. Works on the hosted Pages
    // site and on the :8080 preview alike.
    return location.origin + location.pathname.replace(/\/$/, "");
  }
  // Full published URL for a note slug (used so the AI can hand out real
  // https:// links, not bare slugs). BASE already folds in the repo prefix on
  // GitHub Pages ("" on the :8080 preview), so this is correct in both.
  function pageUrlFor(slug) {
    var s = String(slug || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!s) return "";
    return location.origin + BASE + "/" + s;
  }
  function copyText(text) {
    var done = function () {
      var st = qrCard && qrCard.querySelector(".ai-qr-card-status");
      if (!st) return;
      st.textContent = "Copied!";
      clearTimeout(st._t);
      st._t = setTimeout(function () {
        var s = qrCard && qrCard.querySelector(".ai-qr-card-status");
        if (s) s.textContent = "Scan with your phone";
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    } catch (e) {}
  }
  function updatePageQr() {
    if (!qrCard) return;
    var url = currentPageFullUrl();
    // No-op if nothing changed — this runs on every nav AND on a periodic
    // self-heal tick, so avoid re-assigning img.src / textContent (which would
    // flicker the QR) when the card already points at the current page.
    if (qrCard.dataset.url === url) return;
    var img = qrCard.querySelector("img");
    var cap = qrCard.querySelector(".ai-qr-card-url");
    if (img) img.src = qrSvgDataUrl(url); // memoized: ~0 ms once generated
    if (cap) cap.textContent = url;
    qrCard.dataset.url = url;
  }
  // The "share this page" QR lives in the RIGHT SIDEBAR as a normal, flowing
  // card (page-associated, not a floating overlay). Quartz re-renders the
  // whole page body on every SPA navigation, so we re-inject the card each
  // time the sidebar element reappears. Its show/hide state is remembered.
  function buildSidebarQr() {
    // Re-injection. Quartz does unpredictable DOM surgery on an SPA nav: it
    // may REUSE the .sidebar.right node and just drop our card, or REPLACE the
    // whole sidebar (and its ancestors) with fresh nodes. A one-shot check can
    // therefore "succeed" while the card is still momentarily present, then
    // Quartz removes it a few ms later with nobody watching — which is why the
    // QR "sometimes" needs a manual refresh. Recovery is correct-by-construction
    // via three independent layers (injectOnce is idempotent, so redundancy is
    // cheap and safe):
    //   1. A persistent MutationObserver (PRIMARY). It fires on DOM mutation
    //      regardless of tab visibility — NOT throttled like timers/rAF — so
    //      the moment Quartz mutates the sidebar (adds related-links, drops the
    //      card, replaces the node) we re-inject.
    //   2. On each nav, a short poll that re-checks every frame (no early bail)
    //      — covers the beat before/after the observer fires.
    //   3. A 500ms self-heal interval as a last resort.
    // Find the right sidebar that is actually being rendered. During an SPA
    // re-render Quartz can briefly have MULTIPLE .sidebar.right nodes alive
    // (the previous page's stale node alongside the fresh one). Targeting the
    // wrong one is exactly what made the QR "disappear" — the card was re-used
    // in the stale node, then dropped when that node was torn down. So: scope
    // to the rendered #quartz-body, and when several candidates exist pick the
    // one that is actually laid out (has a layout box), preferring the newer.
    function currentSidebar() {
      var body = document.getElementById("quartz-body") || document;
      var c = body.querySelectorAll(".sidebar.right");
      if (!c.length) return null;
      if (c.length === 1) return c[0];
      for (var i = c.length - 1; i >= 0; i--)
        if (c[i].getClientRects().length) return c[i];
      return c[c.length - 1]; // nothing laid out yet — the newest render
    }
    function injectOnce() {
      var side = currentSidebar();
      if (!side) return false;
      // Trust the live DOM only: the card is fine iff it is a child of the
      // sidebar that is being rendered RIGHT NOW. A card left in a stale node
      // from the previous page does not count.
      var inSide = side.querySelectorAll("#ai-qr-card");
      if (inSide.length) {
        // Never allow stacked duplicates in the rendered sidebar.
        for (var d = inSide.length - 1; d > 0; d--) inSide[d].remove();
        qrCard = inSide[0];
        updatePageQr();
        return true;
      }
      // Not in the rendered sidebar: sweep stray copies out of any stale
      // nodes left behind by the re-render, then build a fresh card here.
      var all = document.querySelectorAll("#ai-qr-card");
      for (var s = all.length - 1; s >= 0; s--) all[s].remove();
      // (Re)build the card. The header (title + show/hide
      // toggle) is ALWAYS visible so the card can never get stuck hidden with
      // no way to bring it back; only the body collapses.
      var visible = localStorage.getItem("ai-qr-visible") !== "0";
      qrCard = el("div", { className: "ai-qr-card", id: "ai-qr-card" });
      var head = el("div", { className: "ai-qr-card-head" });
      head.appendChild(el("span", { className: "ai-qr-card-title", textContent: "Share this page" }));
      var body = el("div", { className: "ai-qr-card-body" + (visible ? "" : " hidden") });
      var showBtn = el("button", {
        className: "ai-qr-card-toggle",
        title: "Show / hide QR code",
        "aria-label": "Show or hide QR code",
        onclick: function () {
          var v = body.classList.toggle("hidden") === false; // true = now visible
          try { localStorage.setItem("ai-qr-visible", v ? "1" : "0"); } catch (e) {}
        }
      });
      showBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
      head.appendChild(showBtn);
      qrCard.appendChild(head);
      var img = el("img", { className: "ai-qr-card-img", alt: "QR code of the current page" });
      body.appendChild(img);
      body.appendChild(el("div", { className: "ai-qr-card-url" }));
      var copyBtn = el("button", {
        className: "ai-qr-card-copy",
        textContent: "Copy link",
        onclick: function () { copyText(qrCard.dataset.url || currentPageFullUrl()); }
      });
      body.appendChild(copyBtn);
      var st = el("div", { className: "ai-qr-card-status", textContent: "Scan with your phone" });
      body.appendChild(st);
      qrCard.appendChild(body);
      side.appendChild(qrCard);
      updatePageQr();
      return true;
    }
    // Nav-triggered poll: re-check every frame for ~1.5s (do NOT bail early, or
    // a card Quartz removes a few ms after the nav goes un-re-injected).
    function ensureInjected() {
      var tries = 0;
      (function poll() {
        injectOnce();
        if (tries++ < 90) requestAnimationFrame(poll);
      })();
    }
    // PRIMARY: a persistent MutationObserver on the (stable) document root.
    // Quartz re-renders the page on every SPA nav — adding related links,
    // removing our card, or replacing the whole sidebar. MutationObserver
    // delivers its callback as a microtask and is NOT throttled or paused like
    // setTimeout/rAF, so it catches the re-render even when the tab is in the
    // background (where timers fire ~1/s and rAF is suspended). injectOnce()
    // is idempotent — if the card is already correctly placed it just
    // re-targets the URL and does nothing — so firing on every nav mutation is
    // cheap. A reentrancy guard stops the observer from re-triggering on the
    // mutation our own re-injection produces.
    var qrObServing = false;
    new MutationObserver(function () {
      if (qrObServing) return;
      qrObServing = true;
      try { injectOnce(); } finally { qrObServing = false; }
    }).observe(document.documentElement, { childList: true, subtree: true });
    // Last-resort self-heal (covers any case the observer/poll miss).
    setInterval(function () { injectOnce(); }, 500);
    ensureInjected();
    // Re-inject + re-target the QR on every in-app (SPA) navigation.
    document.addEventListener("nav", ensureInjected);
    window.addEventListener("popstate", ensureInjected);
  }

  // Sanitize a model-supplied image src: strip trailing quotes/punctuation the
  // model sometimes leaves inside the tag, then require a data: or http(s) URL.
  function sanitizeImageSrc(src) {
    if (!src) return null;
    var v = String(src).trim();
    v = v.replace(/[\s",;:']+$/, "");
    var m = v.match(/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i);
    if (m) return m[0];
    if (/^https?:\/\/\S+$/i.test(v)) return v;
    m = v.match(/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i);
    return m ? m[0] : null;
  }

  // Minimal markdown: code fences + inline code, images, bold, italic, links,
  // bullet lists, paragraphs. Math ($...$ / $$...$$) is left for MathJax via
  // the data-math marker. Code regions are extracted FIRST and re-inserted
  // last, so link/bold/math processing never corrupts them.
  function renderMarkdown(text) {
    var source = String(text);
    var hasMath = /\$\$?/.test(source);
    var codeMap = [];
    source = source.replace(/^(?:[ \t]*```[^\n]*\n(?:(?:.*(?:\r\n?|\n)?)*)?[ \t]*```[ \t]*)/gm, function (m) {
      codeMap.push(m.replace(/^[\s\S]*?```[^\n]*\n?/, "").replace(/\n?[ \t]*```[ \t]*$/, ""));
      return "\u0001" + (codeMap.length - 1) + "a\u0001";
    });
    source = source.replace(/`([^`\n]+)`/g, function (m, inner) {
      codeMap.push(inner);
      return "\u0001" + (codeMap.length - 1) + "b\u0001";
    });

    function renderLine(rawLine) {
      // Extract ALL image forms BEFORE escaping, so escaping (and later
      // link/bold handling) can neither corrupt them nor cause double
      // wrapping: raw <img> tags, markdown ![](...), and bare data: URLs
      // (e.g. run_python output pasted verbatim).
      var imgs = [];
      var text = rawLine.replace(/<img\b[^>]*\/?>/gi, function (tag) {
        var srcM = tag.match(/\bsrc\s*=\s*"([^"]*)"/i) || tag.match(/\bsrc\s*=\s*'([^']*)'/i);
        var altM = tag.match(/\balt\s*=\s*"([^"]*)"/i) || tag.match(/\balt\s*=\s*'([^']*)'/i);
        imgs.push({ alt: (altM && altM[1]) || "image", src: srcM ? srcM[1] : null });
        return "\u0002" + (imgs.length - 1) + "\u0002";
      });
      text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, url) {
        imgs.push({ alt: alt, src: url });
        return "\u0002" + (imgs.length - 1) + "\u0002";
      });
      text = text.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{20,}/g, function (m) {
        imgs.push({ alt: "image", src: m });
        return "\u0002" + (imgs.length - 1) + "\u0002";
      });
      var out = esc(text);
      out = out.replace(/\u0002(\d+)\u0002/g, function (_, i) {
        var im = imgs[parseInt(i, 10)];
        return imageHtml(im ? im.alt : "image", im ? im.src : null);
      });
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
        var href;
        if (/^(https?:|mailto:|#)/i.test(u)) {
          href = u; // already absolute, mailto, or in-page anchor
        } else {
          // A site note (bare slug or /-prefixed path) -> full published URL,
          // so the link is directly scannable/copyable (no double-slash).
          var s = String(u).replace(/^\/+/, "").replace(/\/+$/, "");
          href = location.origin + BASE + "/" + s;
        }
        return '<a href="' + href + '">' + t + "</a>";
      });
      return out;
    }
    function imageHtml(alt, src) {
      var clean = sanitizeImageSrc(src);
      if (!clean) return "";
      var a = String(alt || "").replace(/["<>/]/g, " ").trim().slice(0, 140);
      return '<img class="ai-chat-image" src="' + esc(clean).replace(/"/g, "&quot;") + '" alt="' + esc(a) + '" loading="lazy" />';
    }

    // Interleave: odd segments (0-indexed even positions alternate) are plain
    // text; odd indices are extracted code regions.
    var segs = source.split(/\u0001(\d+)[ab]\u0001/);
    var html = "";
    var inList = false;
    for (var i = 0; i < segs.length; i++) {
      if (i % 2 === 1) {
        if (inList) { html += "</ul>"; inList = false; }
        html += "<pre class=\"ai-chat-code\"><code>" + esc(codeMap[parseInt(segs[i], 10)]) + "</code></pre>";
        continue;
      }
      var lines = segs[i].split("\n");
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        var m = line.match(/^\s*[-*] (.+)$/);
        if (m) {
          if (!inList) { html += "<ul>"; inList = true; }
          html += "<li>" + renderLine(m[1]) + "</li>";
          continue;
        }
        if (inList) { html += "</ul>"; inList = false; }
        if (line.trim() === "") continue;
        html += "<p>" + renderLine(line) + "</p>";
      }
    }
    if (inList) html += "</ul>";
    if (hasMath) html = '<span data-math="1" style="display:contents">' + html + "</span>";
    return html;
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
    // Try several candidate URLs. Normally BASE is correct, but a stale
    // service worker (left over from an earlier deployment on this origin)
    // can put the browser at a path where BASE is empty while the file lives
    // under the repo prefix — that produced a 404 on /static/knowledge-
    // index.json. Fall back to the data-basepath and the root so the index
    // loads regardless of which path the page is actually served from.
    var bp = (document.body.dataset && document.body.dataset.basepath) || "";
    // Candidates in priority order: the path the page is actually served
    // from (BASE), the data-basepath, then the root. No matter which one
    // works first wins, so a stale service worker (which can leave BASE
    // empty on the hosted site) can no longer 404 the index.
    var seen = {}, candidates = [];
    [BASE + "/static/knowledge-index.json",
     (bp ? bp : "") + "/static/knowledge-index.json",
     "/static/knowledge-index.json"
    ].forEach(function (c) { if (!seen[c]) { seen[c] = true; candidates.push(c); } });
    for (var i = 0; i < candidates.length; i++) {
      try {
        var res = await fetch(candidates[i], { cache: "force-cache" });
        if (!res.ok) continue;
        var data = await res.json();
        if (data && data.length) {
          knowledgeIndex = data;
          setKnowledgeStatus("Index " + data.length + " notes");
          return;
        }
      } catch (e) { /* try next candidate */ }
    }
    knowledgeIndex = [];
    setKnowledgeStatus("Index unavailable \u2014 retrieval off");
  }

  function setStatus(state, msg) {
    _lastProvStatus = { state: state, msg: msg || "" };
    renderStatusLine();
  }
  // The status line composes the provider state with the knowledge-index
  // state so they no longer overwrite each other (previously the 2 MB index
  // load could clobber "Free server ready" — or the reverse).
  function renderStatusLine() {
    var t = document.getElementById("ai-chat-status-text");
    var d = document.getElementById("ai-chat-status-dot");
    if (_lastProvStatus) {
      if (t) t.textContent = _lastProvStatus.msg + (knowledgeStatusMsg ? "  \u00B7  " + knowledgeStatusMsg : "");
    }
    if (d && _lastProvStatus) d.className = "status-dot" + (_lastProvStatus.state ? " " + _lastProvStatus.state : "");
  }
  function setKnowledgeStatus(msg) {
    knowledgeStatusMsg = msg;
    renderStatusLine();
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
      typesetIfReady(msg);
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
    var label = el("span", { className: "ai-chat-sources-label", textContent: "\uD83D\uDCD6 Sources" });
    src.appendChild(label);
    var ul = el("ul", { className: "ai-chat-sources-list" });
    // Show up to CITE_SHOW as clickable links; note how many more were used.
    var shown = list.slice(0, CITE_SHOW);
    for (var j = 0; j < shown.length; j++) {
      var s = shown[j];
      var href = pageUrlFor(s.slug) || (BASE + "/" + s.slug);
      var li = el("li");
      var a = el("a", { href: href, target: "_blank", rel: "noopener" });
      a.textContent = s.title || s.slug.split("/").pop();
      li.appendChild(a);
      ul.appendChild(li);
    }
    if (list.length > shown.length) {
      var more = el("li", { className: "ai-chat-sources-more" });
      more.textContent = "+ " + (list.length - shown.length) + " more note" + (list.length - shown.length === 1 ? "" : "s") + " retrieved";
      ul.appendChild(more);
    }
    src.appendChild(ul);
    msgEl.appendChild(src);
    // Hover-QR on each citation link (the shared hover-QR is event-delegated
    // on the messages box, so these anchors pick it up automatically).
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
      "<p>Retrieval runs <em>locally in your browser</em>. With the in-browser model nothing else leaves this machine; if you configure an OpenAI-compatible server in \u2699\uFE0F settings, the conversation is sent to that server.</p>" +
      "<p>Open \u2699\uFE0F settings to load a model or connect a server.</p>";
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

  // ---- OpenAI-compatible endpoint (external provider) ----
  // Streams a standard POST {base}/chat/completions (OpenAI format) and
  // yields OpenAI-format chunks, so the agent loop and streaming UI are
  // shared between the in-browser WebLLM engine and any remote endpoint
  // (OpenRouter, Groq, OpenAI, vLLM, Ollama/llama.cpp local servers).
  function endpointBase() {
    var c = endpointCfg();
    return (c && c.baseUrl) ? String(c.baseUrl).replace(/\/+$/, "") : "";
  }
  async function openaiStream(request) {
    var c = endpointCfg();
    var body = Object.assign({}, request, {
      model: endpointModelName(),
      stream: true
    });
    var headers = { "Content-Type": "application/json" };
    if (c && c.key) headers["Authorization"] = "Bearer " + c.key;
    var res = await fetch(endpointBase() + "/chat/completions", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch (e) {}
      throw new Error("Endpoint HTTP " + res.status + (detail ? ": " + detail : ""));
    }
    var ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.indexOf("text/event-stream") < 0) {
      // Non-stream JSON response: wrap it as a single chunk.
      var data = await res.json();
      return (async function* () { yield data; })();
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buf = "";
    return (async function* () {
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        buf += decoder.decode(part.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf("data:") !== 0) continue;
          var payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          try { yield JSON.parse(payload); } catch (e) { /* keep-alive or partial line */ }
        }
      }
    })();
  }
  // Streams a free-provider (site-provided) OpenAI-compatible request.
  // Unlike openaiStream it uses freeCfg (baseUrl/key/model) and a larger
  // max_tokens, because the Socrates model is a reasoning model.
  async function freeStream(request) {
    var c = freeCfg;
    if (!c) throw new Error("Free provider not available");
    var body = Object.assign({}, request, {
      model: c.model,
      stream: true,
      max_tokens: FREE_MAX_TOKENS
    });
    delete body.tools; // the free model ignores them (and would hallucinate)
    var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + c.key };
    var res = await fetch(String(c.baseUrl).replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch (e) {}
      // 401/403 = key revoked/expired -> invalidate the free provider.
      if (res.status === 401 || res.status === 403) {
        invalidateFree("key rejected");
      }
      throw new Error("Free endpoint HTTP " + res.status + (detail ? ": " + detail : ""));
    }
    var ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.indexOf("text/event-stream") < 0) {
      var data = await res.json();
      return (async function* () { yield data; })();
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buf = "";
    return (async function* () {
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        buf += decoder.decode(part.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf("data:") !== 0) continue;
          var payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          try { yield JSON.parse(payload); } catch (e) { /* keep-alive or partial line */ }
        }
      }
    })();
  }
  // Dispatch a completions request to the active provider. Both paths
  // return an async iterable of OpenAI-format chunks.
  function providerCreate(request) {
    if (isFree()) return freeStream(request);
    if (isExternal()) return openaiStream(request);
    return engine.chat.completions.create(request);
  }

  // ---- Agent tools ----
  // Most tools live in tools.js (same scope): TOOL_LIB (executors) and
  // TOOL_SCHEMAS (OpenAI function schemas). The two browser-bound tools
  // (navigate_to_page, read_current_page) need DOM access, so their
  // schemas are defined here and their execution handled in executeTool.
  // TOOLS = the FULL suite (62) — used by external endpoints, whose models
  // have big contexts.
  var TOOLS = TOOL_SCHEMAS.concat([
    {
      type: "function",
      function: {
        name: "navigate_to_page",
        description:
          "Open a FAQ note page in the user's browser so they can read it. Use ONLY when the user explicitly wants the page opened ('show me the page', 'open it'). Use a slug returned by a search/lookup tool. After opening, still write the answer.",
        parameters: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Note slug exactly as returned by a tool" }
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
          "Read the text of the page the user is currently viewing. This is the ONLY tool for questions about 'this page' / 'the current page' / 'summarize this page'. Call it first (NOT search_notes) for those, then answer directly from its returned text.",
        parameters: {
          type: "object",
          properties: {
            max_chars: { type: "integer", description: "Max characters to return (default 1200)" }
          },
          required: []
        }
      }
    }
  ]);

  // ---- In-browser (WebLLM) tool subset ----
  // The in-browser Hermes-3 8B model has a 4,096-token context window and
  // WebLLM serializes EVERY tool schema into the prompt. All 62 full schemas
  // (~5,000 tokens) blow past the window and every request fails with
  // "Prompt tokens exceed context window size". So for the WebLLM path we
  // expose a curated 14-tool subset with short descriptions (~2 KB total);
  // executeTool still runs ANY registered tool, so if the model names a
  // fuller-sibling (e.g. score_history) it works anyway. External endpoints
  // (big contexts) keep the full TOOLS.
  var WEBLLM_TOOLS = [
    { name: "search_notes", desc: "Keyword-search the 1035 FAQ notes. Returns results with a short_answer; use read_note(id) for full text.",
      params: { query: strParam("Search keywords"), limit: intParam("Max results (default 5, max 10)") }, req: ["query"] },
    { name: "read_note", desc: "Full text of one note by id (from search_notes/list_notes).",
      params: { id: intParam("Note id"), slug: strParam("Or note slug"), max_chars: intParam("Max chars (default 2200)") }, req: [] },
    { name: "list_folders", desc: "List the site's note sections with note counts.", params: {}, req: [] },
    { name: "get_jupas_code", desc: "JUPAS code(s) for a CS programme; empty name lists all CS JUPAS codes.",
      params: { programme: strParam("Programme name, e.g. 'Computer Science'") }, req: [] },
    { name: "get_nonjupas_code", desc: "Non-JUPAS admission code(s) for a CS programme (e.g. 1561A).",
      params: { programme: strParam("Programme name") }, req: [] },
    { name: "get_programme_info", desc: "One programme's profile (streams, duration, overview).",
      params: { code: strParam("Programme code, e.g. JS1204"), name: strParam("Or programme name") }, req: [] },
    { name: "get_cityu_score", desc: "CityU's published JUPAS score (median + lower quartile) for a code/year.",
      params: { code: strParam("Programme code, e.g. JS1204"), year: intParam("Year 2023-2026") }, req: ["code"] },
    { name: "get_all_cityu_scores", desc: "CityU scores for all CS programmes, optionally one year.",
      params: { year: intParam("Year"), limit: intParam("Max rows (default 20)") }, req: [] },
    { name: "lookup_grade_score", desc: "Convert DSE grades to the weighted JUPAS score and compare to CityU CS.",
      params: { grades: strParam("Up to 5 grades, e.g. '5,4,4,3,3'"), code: strParam("Programme code, default JS1204") }, req: ["grades"] },
    { name: "get_tuition_fees", desc: "Undergraduate tuition fees (local vs non-local).",
      params: { programme: strParam("Optional programme") }, req: [] },
    { name: "get_jupas_key_dates", desc: "JUPAS application key dates / deadlines for a cycle year.",
      params: { year: intParam("Cycle year, e.g. 2027") }, req: [] },
    { name: "get_entry_requirements", desc: "Minimum entrance requirements for a CS programme.",
      params: { code: strParam("Programme code"), name: strParam("Or programme name") }, req: [] },
    { name: "navigate_to_page", desc: "Open a note page in the browser (slug from a tool). Only when the user wants it opened; still write the answer.",
      params: { slug: strParam("Note slug from a tool result") }, req: ["slug"] },
    { name: "read_current_page", desc: "Read the text of the page the user is viewing. ONLY tool for 'this page'/'summarize this page'; then answer from its text.",
      params: { max_chars: intParam("Max chars (default 1200)") }, req: [] }
  ].map(function (t) {
    var props = {};
    (function () { for (var k in t.params) props[k] = t.params[k]; })();
    return {
      type: "function",
      function: {
        name: t.name,
        description: t.desc,
        parameters: { type: "object", properties: props, required: t.req }
      }
    };
  });

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
  // Visible article text of the current page (trimmed) — used as a context
  // fallback for the Phase-2 answer when no tool ran (e.g. the model emitted a
  // degenerate empty tool-call array).
  function currentPageText(maxChars) {
    var art = document.querySelector("article");
    var text = art ? art.textContent.replace(/\s+/g, " ").trim() : "";
    var n = maxChars || PAGE_READ_MAX;
    return text.slice(0, n);
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

  // Collect source slugs from a tool result (for the citations footer) so
  // we don't have to special-case every tool.
  function collectCited(result, cited) {
    if (!result || typeof result !== "object") return;
    var found = {};
    (function walk(o, depth) {
      if (!o || depth > 3 || foundCount(found) >= CITE_SHOW) return;
      if (typeof o === "object" && !Array.isArray(o)) {
        if (o.slug && o.title) found[o.slug] = o.title;
        for (var k in o) if (o[k] && typeof o[k] === "object") walk(o[k], depth + 1);
      } else if (Array.isArray(o)) {
        for (var i = 0; i < o.length && foundCount(found) < CITE_SHOW; i++) walk(o[i], depth + 1);
      }
    })(result, 0);
    var n = 0;
    for (var s in found) { if (!cited[s] && n < CITE_SHOW) { cited[s] = found[s]; n++; } }
  }
  function foundCount(found) { var c = 0; for (var k in found) c++; return c; }

  // Run a tool. Registry tools (tools.js) are async-aware; the two
  // browser-bound tools are handled inline. Always returns a plain object.
  async function executeTool(name, args, cited) {
    args = args || {};
    if (name === "navigate_to_page") {
      var slug = normStrLocal(args.slug);
      if (!slug) return { ok: false, error: "slug is required" };
      var entry = findEntryBySlug(slug);
      if (!entry) {
        return { ok: false, error: "No note with slug \"" + slug + "\". Use a slug returned by a search/lookup tool." };
      }
      var url;
      try { url = new URL(BASE + "/" + slug, location.href); }
      catch (e) { return { ok: false, error: "Invalid slug: " + slug }; }
      try {
        if (typeof window.spaNavigate === "function") window.spaNavigate(url);
        else location.assign(url.href);
      } catch (e) {
        return { ok: false, error: "Navigation failed: " + (e && e.message ? e.message : String(e)) };
      }
      return { ok: true, opened: entry.title, slug: slug, url: url.href, note: "The page in the user's browser changed to this note. Share the url value (the full published URL) if the user wants the link." };
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
    var fn = TOOL_LIB[name];
    if (!fn) return { ok: false, error: "Unknown tool: " + name };
    var result = await fn(args, {
      BASE: BASE,
      document: document,
      location: location
    });
    collectCited(result, cited);
    return result;
  }
  function normStrLocal(v) { return String(v == null ? "" : v).trim(); }

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

  // Lenient JSON parse (undefined on failure).
  function jsonParseLoose(text) {
    try { return JSON.parse(String(text).trim()); } catch (e) { return undefined; }
  }
  // Interpret a grammar-locked Phase-1 output (streamed as delta.content) as
  // tool calls. WebLLM usually also emits a structured delta.tool_calls in the
  // final chunk, but that chunk can be missing/empty — in which case the only
  // usable signal is the JSON text. Accepts: an array of tool calls, a single
  // tool-call object, or {tool_calls:[...]}. Entries may be OpenAI-style
  // {function:{name,arguments}} or flat {name,arguments}. Returns an array of
  // {name,arguments,id} or null (NOT a tool call — including the degenerate
  // empty array "[]" the model sometimes emits).
  function coerceToolCalls(v) {
    if (!v || typeof v !== "object") return null;
    if (!Array.isArray(v)) {
      if (v.tool_calls && typeof v.tool_calls === "object") v = v.tool_calls;
      else v = [v];
    }
    if (!Array.isArray(v) || !v.length) return null;
    var out = [];
    for (var i = 0; i < v.length; i++) {
      var e = v[i];
      if (!e || typeof e !== "object") continue;
      var name = e.name || (e.function && e.function.name) || "";
      var args = e.arguments != null ? e.arguments : (e.function && e.function.arguments != null ? e.function.arguments : "");
      if (typeof args === "object") { try { args = JSON.stringify(args); } catch (err) { args = ""; } }
      if (!name) continue;
      out.push({ name: String(name), arguments: String(args), id: e.id || ("t" + i) });
    }
    return out.length ? out : null;
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
      "How to use your tools:\n" +
      "- If the user refers to the current/this page (e.g. \"summarize this page\"): " +
      "call read_current_page IMMEDIATELY and do NOT call search_notes — the page IS the source.\n" +
      "- For any other question: pick the MOST SPECIFIC tool that matches the intent. " +
      "There are purpose-specific tools — for JUPAS codes use get_jupas_code, for non-JUPAS " +
      "codes get_nonjupas_code, for a score get_cityu_score (or get_rival_score), for grades " +
      "lookup_grade_score, for fees get_tuition_fees, for a programme get_programme_info, for a " +
      "course get_course_info, and so on. Only use the generic search_notes when no specific tool fits.\n" +
      "- After a tool returns data with ok=true, that data IS your source: answer from it. " +
      "Do NOT call the same or a similar tool again to \"double-check\". At most 2 tool calls " +
      "per question, then answer.\n" +
      "Be concise and factual. Answer only from what the tools and the page return; if they " +
      "have no answer, say so plainly. If the user asked you to open/show a page, call " +
      "navigate_to_page once AND still write the answer.\n" +
      "The site is published at " + location.origin + BASE + " — so a note's full public URL is " +
      location.origin + BASE + "/<slug> (e.g. " + location.origin + BASE + "/03_nonjupas/bsc-cs-non-jupas-code-1561a). " +
      "If the user asks for the link/URL of a page, give the full URL as a markdown link, e.g. [Title](" + location.origin + BASE + "/<slug>).\n";
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
      s += "(No tool result was available. Use the current page content below as " +
        "your source.)\n\n";
    }
    // When no tool ran, the model would otherwise have nothing to answer from.
    // Include the current page so it can still give a real answer (this is the
    // path taken when the Phase-1 model emitted a degenerate "[]" tool call).
    if (!toolNote) {
      var page = currentPageMeta();
      var pt = currentPageText(1500);
      if (page.title) s += "Current page title: " + page.title + "\n";
      if (pt) s += "Current page content:\n" + pt + "\n";
    }
    s += "Answer the user question now in plain text. Never output raw JSON, " +
      "tool calls, or empty answers.";
    return s;
  }

  // ---- Agent loop for EXTERNAL OpenAI-compatible endpoints.
  // Standard OpenAI tool-calling loop: no grammar lock, so the model can
  // answer directly or call tools; tool results go back as role:"tool".
  async function runAgentExternal(query) {
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
    var page = currentPageMeta();
    var systemPrompt =
      "You are the FAQ assistant for the CityUHK (City University of Hong Kong) " +
      "Computer Science undergraduate admission site. You have many purpose-specific " +
      "tools. Rules: (1) For questions about the current/this page, use read_current_page " +
      "and answer from its text. (2) For other questions, call the MOST SPECIFIC tool that " +
      "matches the intent (e.g. get_jupas_code, get_cityu_score, get_tuition_fees, " +
      "get_programme_info, lookup_grade_score, run_python for computation); use the generic " +
      "search_notes only when nothing specific fits. (3) Once a tool returns ok=true data, " +
      "answer from it — do NOT re-call a similar tool to double-check; at most 2 tool calls " +
      "per question, then answer. (4) Be concise and factual; if the tools have no answer, " +
      "say so. (5) If the user wants a page opened, call navigate_to_page once AND still " +
      "write the answer. (6) The site is published at " + location.origin + BASE + ", so a " +
      "note's full public URL is " + location.origin + BASE + "/<slug>; if the user asks for a " +
      "page's link/URL, give the full URL (the navigate_to_page result includes it as url)." +
      (page.title ? " Current page: " + page.title + " (slug: " + page.slug + ")." : "");
    var msgs = [{ role: "system", content: systemPrompt }]
      .concat(history)
      .concat([{ role: "user", content: buildAgentUserTurn(query) }]);

    for (var round = 0; round < MAX_AGENT_TURNS; round++) {
      showTyping(true);
      var req = {
        messages: msgs.slice(),
        temperature: 0.3,
        max_tokens: 1024,
        stream: true,
        tool_choice: "auto",
        tools: TOOLS
      };
      if (window.__aiChatLog) console.log("[ai-chat] EXT round " + round + " REQUEST", JSON.parse(JSON.stringify(req)));
      var stream = await providerCreate(req);
      var content = "";
      var toolCalls = null;
      var liveEl = null;
      for await (var chunk of stream) {
        var choice = chunk.choices && chunk.choices[0];
        if (!choice) continue;
        var delta = choice.delta;
        if (delta && delta.content) {
          content += delta.content;
          if (!liveEl) {
            showTyping(false);
            liveEl = appendMessage("assistant", "");
          }
          liveEl.innerHTML = renderMarkdown(content);
          scrollBottom();
        }
        if (delta && delta.tool_calls) toolCalls = mergeToolCallsDelta(toolCalls, delta.tool_calls);
      }
      showTyping(false);
      if (window.__aiChatLog) console.log("[ai-chat] EXT round " + round + " RESPONSE", JSON.stringify({ content: content, toolCalls: toolCalls }));

      if (!toolCalls || !toolCalls.length) {
        // Final answer.
        var finalEl = liveEl;
        if (!finalEl && content) finalEl = appendMessage("assistant", content);
        if (finalEl && content) {
          finalEl.innerHTML = renderMarkdown(content);
          appendCitations(finalEl, cited);
          typesetIfReady(finalEl);
          scrollBottom();
        }
        conversationHistory.push({ role: "assistant", content: content });
        if (!content.trim()) addSystemMessage("(The model returned an empty answer)");
        return;
      }

      // Tool-call turn: raw JSON text streamed — swap it for chips.
      if (liveEl) liveEl.remove();
      var tcArr = [];
      for (var ti = 0; ti < toolCalls.length; ti++) {
        var tc = toolCalls[ti];
        var argsObj = safeParseArgs(tc.arguments);
        var t = { name: tc.name, arguments: argsObj, id: tc.id || ("call_" + ti) };
        addToolChip(t.name, t.arguments);
        tcArr.push({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: JSON.stringify(t.arguments) }
        });
      }
      msgs.push({ role: "assistant", content: content || null, tool_calls: tcArr });
      for (var k = 0; k < tcArr.length; k++) {
        var result = await executeTool(tcArr[k].function.name, safeParseArgs(tcArr[k].function.arguments), cited);
        msgs.push({ role: "tool", tool_call_id: tcArr[k].id, content: JSON.stringify(result).slice(0, TOOL_RESULT_MAX) });
      }
    }
    // Loop exhausted without a plain answer: force a final answer round with
    // NO tools (mirrors the WebLLM two-phase pattern) so the user still gets
    // an answer assembled from the tool results gathered so far.
    if (window.__aiChatLog) console.log("[ai-chat] EXT: forcing final answer (no tools)");
    showTyping(true);
    var forcedReq = {
      messages: msgs.slice().concat([{
        role: "user",
        content: "You have already gathered the tool results above. Now write the final answer to the user's question in plain text (no JSON, no more tool calls). Be concise and factual; if the results don't contain the answer, say so."
      }]),
      temperature: 0.3,
      max_tokens: 1024,
      stream: true
    };
    var fStream = await providerCreate(forcedReq);
    var fReply = "";
    var fEl = appendMessage("assistant", "");
    var fInner = el("div", { className: "ai-chat-md" });
    if (fEl) fEl.appendChild(fInner);
    var fSrcDone = false;
    for await (var fChunk of fStream) {
      var fd = (fChunk.choices && fChunk.choices[0] && fChunk.choices[0].delta && fChunk.choices[0].delta.content) || "";
      if (!fd) continue;
      fReply += fd;
      if (fEl) {
        fInner.innerHTML = renderMarkdown(fReply);
        if (!fSrcDone) { appendCitations(fEl, cited); fSrcDone = true; }
        scrollBottom();
      }
    }
    showTyping(false);
    typesetIfReady(fEl);
    if (window.__aiChatLog) console.log("[ai-chat] EXT forced RESPONSE", JSON.stringify(fReply));
    conversationHistory.push({ role: "assistant", content: fReply });
    if (!fReply.trim()) addSystemMessage("I ran out of steps and could not assemble an answer — please rephrase or split the question.");
  }

  async function runAgent(query) {
    if (isExternal()) return runAgentExternal(query);
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
      tools: WEBLLM_TOOLS
    };
    if (window.__aiChatLog) console.log("[ai-chat] PHASE1 (tools) REQUEST", JSON.parse(JSON.stringify(toolRequest)));
    var stream1 = await providerCreate(toolRequest);
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

    // If the structured delta.tool_calls chunk was missing/empty, the JSON
    // tool call(s) may still be in the streamed text — try to recover them.
    // (Also guards the degenerate "[]" the model sometimes emits.)
    if ((!toolCalls || !toolCalls.length) && content1.trim()) {
      var parsed = jsonParseLoose(content1);
      var coerced = coerceToolCalls(parsed);
      if (coerced) toolCalls = coerced;
    }

    var toolNote = ""; // human-readable tool result, fed to Phase 2

    if (toolCalls && toolCalls.length) {
      // Tool-call turn: the streamed text is the raw JSON — swap it for chips.
      if (liveEl) liveEl.remove();
      for (var ti = 0; ti < toolCalls.length; ti++) {
        var tc = toolCalls[ti];
        var argsObj = safeParseArgs(tc.arguments);
        var t = { name: tc.name, arguments: argsObj };
        addToolChip(t.name, t.arguments);
        var result = await executeTool(t.name, t.arguments, cited);
        toolNote +=
          "Tool " + t.name + "(" + JSON.stringify(t.arguments) + ") returned:\n" +
          JSON.stringify(result).slice(0, TOOL_RESULT_MAX) + "\n\n";
      }
    } else if (content1.trim()) {
      // No tool call. Only treat this as a final answer if it reads like plain
      // text — NOT a leftover tool-call JSON fragment (some 8B grammar-locked
      // models emit a malformed tool JSON as content), which would otherwise be
      // dumped verbatim. JSON-shaped text falls through to Phase 2, which gives
      // a proper answer from context.
      var looksJson = /^\s*[\[{]/.test(content1);
      var parsedC = jsonParseLoose(content1);
      if (looksJson && (coerceToolCalls(parsedC) || parsedC !== undefined)) {
        // JSON that isn't a usable tool call (e.g. "[]" or malformed) ->
        // don't display it; let Phase 2 answer from context below.
        if (liveEl) liveEl.remove();
      } else {
        var el1 = liveEl;
        if (!el1 && content1) el1 = appendMessage("assistant", content1);
        if (el1 && content1) {
          el1.innerHTML = renderMarkdown(content1);
          appendCitations(el1, cited);
          typesetIfReady(el1);
          scrollBottom();
        }
        conversationHistory.push({ role: "assistant", content: content1 });
        return;
      }
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
    var stream2 = await providerCreate(answerRequest);
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
    typesetIfReady(msgEl);
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
      "searching the site. When an answer uses several notes, cite ALL the " +
      "relevant note names (more is better for verification) so the user can " +
      "open each one.\n\n";
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
    var stream = await providerCreate({
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
    showTyping(false);
    typesetIfReady(msgEl);
    conversationHistory.push({ role: "assistant", content: reply });
    if (!reply.trim()) addSystemMessage("(model returned an empty reply)");
  }

  function setBusy(on) {
    var ta = document.getElementById("ai-chat-input");
    var btn = document.getElementById("ai-chat-send");
    // Don't disable the textarea itself: it steals focus while generating and
    // it's not needed (isGenerating already guards double-send). Keeping it
    // enabled lets focus be restored for an immediate follow-up.
    if (btn) btn.disabled = on;
    if (ta) ta.placeholder = on ? "Thinking\u2026" : ta.dataset.ph || ta.placeholder;
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

    if (!providerReady()) {
      addSystemMessage(
        "No model loaded yet. Open \u2699\uFE0F settings and load a model or connect a server, then try again."
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
      // The free provider is a reasoning model with no tool-calling, so it
      // ALWAYS uses the grounded RAG path (never the agent/tool loop).
      if (isFree() || !(isExternal() || isAgentModel(currentModelId))) await fastAnswer(query);
      else await runAgent(query);
    } catch (e) {
      showTyping(false);
      addSystemMessage("Error: " + (e && e.message ? e.message : e));
    } finally {
      isGenerating = false;
      setBusy(false);
      // Keep the input focused so a follow-up can be typed immediately
      // (disabling the textarea during generation had stolen focus).
      var p = document.getElementById("ai-chat-panel");
      if (inputEl && p && !p.classList.contains("closed")) {
        try { inputEl.focus(); } catch (e) {}
      }
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

    // ---- Provider toggle: in-browser (WebGPU) vs Free (site) vs own server
    var providerGroup = el("div", { className: "settings-provider" });
    var radioIn = el("input", { type: "radio", name: "ai-chat-provider", id: "ai-chat-prov-in", value: "inbrowser" });
    var radioFree = el("input", { type: "radio", name: "ai-chat-provider", id: "ai-chat-prov-free", value: "free" });
    var radioOut = el("input", { type: "radio", name: "ai-chat-provider", id: "ai-chat-prov-out", value: "external" });
    var save = endpointCfg() || {};
    if (save.kind === "external") radioOut.checked = true;
    else if (isFree()) radioFree.checked = true;
    else radioIn.checked = true;
    providerGroup.appendChild(radioIn);
    providerGroup.appendChild(el("label", { for: "ai-chat-prov-in", textContent: " In-browser model (WebGPU — runs locally, no server)" }));
    providerGroup.appendChild(el("br"));
    providerGroup.appendChild(radioFree);
    providerGroup.appendChild(el("label", { for: "ai-chat-prov-free", textContent: " Free site AI (no setup" + (isFree() ? " — " + freeModelName() : "") + ")" }));
    providerGroup.appendChild(el("br"));
    providerGroup.appendChild(radioOut);
    providerGroup.appendChild(el("label", { for: "ai-chat-prov-out", textContent: " OpenAI-compatible server (e.g. OpenRouter, Groq, OpenAI, local llama.cpp/Ollama)" }));
    modal.appendChild(providerGroup);

    // ---- Free site-AI section (read-only; availability comes from the live probe)
    var freeSection = el("div", { className: "settings-section", id: "ai-chat-section-free" });
    var freeState = el("p", { className: "settings-hint" });
    if (isFree()) {
      freeState.textContent = "Available now — " + freeModelName() + ". I answer from the 1035 FAQ notes I retrieve for you. No key or setup needed.";
    } else {
      freeState.textContent = "Not currently available (the site's free AI service is off or its key is not active). If the site re-enables it, reload and choose this option again.";
    }
    freeSection.appendChild(freeState);
    modal.appendChild(freeSection);

    var inSection = el("div", { className: "settings-section", id: "ai-chat-section-in" });

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
    inSection.appendChild(label);
    inSection.appendChild(select);

    var hint = el("p", { className: "settings-hint" });
    hint.textContent =
      "Agent models can call tools: search the 1035 FAQ notes, open the source page in your browser, and read the page you are viewing. " +
      "Fast models answer from the notes I retrieve for you. " +
      "The model downloads once and is cached in your browser. Nothing is sent to any server.";
    inSection.appendChild(hint);
    modal.appendChild(inSection);

    // ---- OpenAI-compatible server section
    var outSection = el("div", { className: "settings-section", id: "ai-chat-section-out" });
    var baseLabel = el("label", { textContent: "Base URL (no trailing /chat/completions)" });
    var baseInput = el("input", {
      type: "text", id: "ai-chat-set-base",
      placeholder: "https://openrouter.ai/api/v1  or  http://localhost:8080/v1",
      value: (save && save.kind === "external") ? (save.baseUrl || "") : ""
    });
    var keyLabel = el("label", { textContent: "API key (optional for local servers; stored only in this browser)" });
    var keyInput = el("input", {
      type: "password", id: "ai-chat-set-key",
      placeholder: "sk-...",
      value: (save && save.kind === "external") ? (save.key || "") : ""
    });
    var modelLabel = el("label", { textContent: "Model name (must support tool calling for agent features)" });
    var modelInput = el("input", {
      type: "text", id: "ai-chat-set-model",
      placeholder: "openai/gpt-4o-mini  or  meta-llama/Llama-3.1-8B-Instruct",
      value: (save && save.kind === "external") ? (save.model || "") : ""
    });
    outSection.appendChild(baseLabel); outSection.appendChild(baseInput);
    outSection.appendChild(keyLabel); outSection.appendChild(keyInput);
    outSection.appendChild(modelLabel); outSection.appendChild(modelInput);
    outSection.appendChild(el("p", { className: "settings-hint", textContent:
      "Any OpenAI-compatible /chat/completions endpoint works (OpenRouter, Groq, OpenAI, Azure, vLLM, Ollama, llama.cpp llama-server). " +
      "Note: in this mode your questions are sent to that server." }));
    modal.appendChild(outSection);

    function refreshSections() {
      inSection.style.display = radioIn.checked ? "" : "none";
      outSection.style.display = radioOut.checked ? "" : "none";
      freeSection.style.display = radioFree.checked ? "" : "none";
    }
    radioIn.addEventListener("change", refreshSections);
    radioFree.addEventListener("change", refreshSections);
    radioOut.addEventListener("change", refreshSections);
    refreshSections();

    var actions = el("div", { className: "settings-actions" });
    actions.appendChild(el("button", {
      textContent: "Cancel",
      onclick: function () { overlay.remove(); }
    }));
    var applyBtn = el("button", { className: "primary" });
    function applyProvider() {
      if (radioFree.checked) {
        // Switch to the site free provider: clear any explicit choice so the
        // page (and a future reload) uses the free provider.
        clearEndpointCfg();
        storageClearModel();
        overlay.remove();
        (freeCfg ? Promise.resolve(freeCfg) : loadFreeConfig().then(function () { return freeCfg; })).then(function (cfg) {
          if (cfg) activateFree();
          else addSystemMessage("The free AI service is not available right now. It will be offered automatically when it comes back — or reload and try again.");
        });
        return;
      }
      // An explicit choice supersedes the auto free provider.
      clearFree();
      if (radioOut.checked) {
        var base = baseInput.value.trim();
        var key = keyInput.value.trim();
        var model = modelInput.value.trim();
        if (!base || !model) {
          addSystemMessage("External server needs both a Base URL and a Model name.");
          return;
        }
        saveEndpointCfg({ kind: "external", baseUrl: base, key: key, model: model });
        overlay.remove();
        activateExternal();
      } else {
        clearEndpointCfg();
        var chosen = select.value;
        storageSetModel(chosen);
        overlay.remove();
        addSystemMessage("Loading " + chosen + " \u2026 (first time takes a while)");
        loadEngine(chosen);
      }
    }
    applyBtn.onclick = applyProvider;
    function refreshButton() {
      applyBtn.textContent = radioOut.checked ? "Use server" : (radioFree.checked ? "Use free AI" : "Load model");
    }
    radioIn.addEventListener("change", refreshButton);
    radioFree.addEventListener("change", refreshButton);
    radioOut.addEventListener("change", refreshButton);
    refreshButton();
    actions.appendChild(applyBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.documentElement.appendChild(overlay);
  }

  // Switch to the external provider: no model download needed.
  function activateExternal() {
    var c = endpointCfg();
    if (!c || c.kind !== "external") return;
    currentModelId = c.model;
    setStatus("ready", "Server ready: " + c.model);
    addSystemMessage(
      "Connected to OpenAI-compatible server (" + c.model + "). " +
      "I can search the FAQ notes, open source pages and read your current page."
    );
  }

  function clearChat() {
    conversationHistory = [];
    showWelcome();
  }

  // The chat button (FAB) only OPENS the panel (it hides while the panel is
  // open); closing is the small X in the panel header, plus Escape. Both
  // controls are always reachable, so the chat can never get stuck.
  function togglePanel() {
    var panel = document.getElementById("ai-chat-panel");
    if (!panel) return;
    panelOpen = !panelOpen;
    panel.classList.toggle("closed", !panelOpen);
    // The FAB is a child of <html> (mounted to survive SPA nav), so the open
    // flag must go on the document element for the `html.chat-open` selectors
    // to reach it. body keeps its own class for the docked-content padding.
    document.documentElement.classList.toggle("chat-open", panelOpen);
  }
  // Open from the FAB: undock first, then open, so it never lands docked.
  function openPanel() {
    if (isDocked()) setDocked(false);
    if (!panelOpen) togglePanel();
  }
  // Close from the header X / Escape: undock first, then collapse.
  function closePanel() {
    if (isDocked()) setDocked(false);
    if (panelOpen) togglePanel();
  }

  // ---- Draggable + resizable panel ----
  // The header is the drag handle; the left/top edges resize. Position +
  // size are persisted so the visitor's layout survives a reload.
  var panelPos = { x: null, y: null, w: null, h: null };
  var PANEL_MIN_W = 300, PANEL_MIN_H = 360;

  function panelEl() { return document.getElementById("ai-chat-panel"); }
  function clampPanel() {
    var p = panelEl();
    if (!p) return;
    if (isDocked()) return; // docked position is CSS-managed
    var r = p.getBoundingClientRect();
    // The panel is position:fixed, so getBoundingClientRect() (viewport
    // coords) is the exact frame style.left/top uses. offsetLeft/Top are
    // unreliable here (the panel anchors by right/bottom, so they read 0).
    var x = r.left, y = r.top;
    // keep at least 88px visible; don't push off the top edge
    x = Math.max(88 - r.width, Math.min(x, window.innerWidth - 88));
    y = Math.max(0, Math.min(y, window.innerHeight - 70));
    p.style.left = x + "px";
    p.style.top = y + "px";
    p.style.bottom = "auto";
    p.style.right = "auto";
    panelPos.x = x; panelPos.y = y;
    panelPos.w = r.width; panelPos.h = r.height;
  }
  function savePanelGeom() {
    try {
      localStorage.setItem("ai-chat-geom", JSON.stringify({
        x: panelPos.x, y: panelPos.y, w: panelPos.w, h: panelPos.h
      }));
    } catch (e) {}
  }
  function applyPanelGeom() {
    var p = panelEl();
    if (!p) return;
    // A docked panel is a fixed bottom bar (see applyDockState/layoutDockBar)
    // — its position/size are managed there, so nothing to restore here.
    if (isDocked()) return;
    // On phones the panel is full-screen (CSS), so a saved desktop layout
    // must not override it.
    if (window.innerWidth < 480) return;
    // Only reposition when the visitor has a saved layout; otherwise keep
    // the CSS default (bottom-right) so first visits are unaffected.
    if (panelPos.x == null && panelPos.y == null) return;
    if (panelPos.w) p.style.width = panelPos.w + "px";
    if (panelPos.h) p.style.height = panelPos.h + "px";
    p.style.position = "fixed";
    p.style.bottom = "auto";
    p.style.right = "auto";
    if (panelPos.x != null) p.style.left = panelPos.x + "px";
    if (panelPos.y != null) p.style.top = panelPos.y + "px";
  }
  function isDocked() {
    var p = panelEl();
    return !!(p && p.classList.contains("docked"));
  }
  function restorePanelGeom() {
    try {
      var g = JSON.parse(localStorage.getItem("ai-chat-geom") || "null");
      if (g) {
        panelPos.x = (typeof g.x === "number") ? g.x : null;
        panelPos.y = (typeof g.y === "number") ? g.y : null;
        panelPos.w = (typeof g.w === "number") ? g.w : null;
        panelPos.h = (typeof g.h === "number") ? g.h : null;
      }
    } catch (e) {}
  }
  // ---- Docked mode: a floating bar pinned to the bottom of the SCREEN ----
  // Docking keeps the panel on <html> (so SPA nav never loses it) but makes it
  // a position:fixed bar at the bottom of the viewport — always in view, never
  // scrolled out of sight. It must not cover the sticky sidebars or the
  // article, so a `chat-docked` class on <body> adds matching bottom insets
  // (see styles.css) that push that content up above the bar.
  function setDocked(on) {
    try { localStorage.setItem("ai-chat-docked", on ? "1" : "0"); } catch (e) {}
    applyDockState();
  }
  function applyDockState() {
    var p = panelEl();
    if (!p) return;
    var docked = localStorage.getItem("ai-chat-docked") === "1";
    p.classList.toggle("docked", docked);
    document.body.classList.toggle("chat-docked", docked);
    var dockBtn = p.querySelector(".ai-chat-dock");
    if (dockBtn) dockBtn.classList.toggle("active", docked);
    if (docked) {
      // A fixed bottom bar — the floating position/size don't apply.
      p.style.top = ""; p.style.bottom = ""; p.style.right = "";
      p.style.width = ""; p.style.height = "";
      layoutDockBar(); // sizes left/width to the center column + body clearance
    } else {
      document.body.style.paddingBottom = "";
      applyPanelGeom();
    }
  }
  // Quartz re-renders the page on every SPA nav and REPLACES <body> (wiping the
  // inline padding-bottom we set), so after each nav keep watching for ~1.5s
  // and re-run the bar layout as soon as the NEW page's .center is measurable
  // (idempotent and cheap). Same pattern as buildSidebarToggles.
  function dockReapplySoon() {
    var tries = 0;
    (function poll() {
      var c = document.querySelector("#quartz-body .center");
      if (c && c.getBoundingClientRect().width > 40) {
        layoutDockBar();
      }
      if (tries++ < 90) requestAnimationFrame(poll);
    })();
  }
  document.addEventListener("nav", dockReapplySoon);
  window.addEventListener("popstate", dockReapplySoon);
  function pointerDrag(panel, onMove) {
    function end() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      panel.classList.remove("dragging", "resizing");
      document.body.style.userSelect = "";
    }
    function move(e) {
      e.preventDefault();
      onMove(e);
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    panel.classList.add("dragging");
    document.body.style.userSelect = "none";
  }
  function wirePanelDrag() {
    var p = panelEl();
    if (!p || p.__dragWired) return;
    p.__dragWired = true;
    // The panel is position:fixed and anchored by right/bottom by default,
    // so offsetLeft/offsetTop read 0 — getBoundingClientRect() is the true
    // viewport frame and the correct seed for style.left/top math.
    var startFrame = function () {
      var r = p.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height };
    };
    var header = p.querySelector(".ai-chat-header");
    if (header) {
      header.addEventListener("pointerdown", function (e) {
        // ignore drags that start on a header button
        if (e.target && e.target.closest && e.target.closest("button")) return;
        if (isDocked()) return; // docked panel isn't movable
        e.preventDefault();
        var s = startFrame();
        var sx = e.clientX, sy = e.clientY;
        panelPos.x = s.left; panelPos.y = s.top;
        panelPos.w = s.w; panelPos.h = s.h;
        pointerDrag(p, function (ev) {
          p.style.left = (s.left + (ev.clientX - sx)) + "px";
          p.style.top = (s.top + (ev.clientY - sy)) + "px";
          p.style.bottom = "auto";
          p.style.right = "auto";
        });
        // clamp + persist once the drag ends
        p.addEventListener("pointerup", function done() {
          clampPanel();
          savePanelGeom();
          p.removeEventListener("pointerup", done);
        });
      });
    }
    // Left edge: horizontal resize (drag left to WIDEN the left side).
    // The panel is anchored by left+top (right/bottom are auto), so changing
    // the width alone would grow the RIGHT edge — we therefore move the left
    // edge by the same amount to keep the right edge fixed.
    var rl = p.querySelector(".ai-chat-resize");
    if (rl) rl.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (isDocked()) return;
      p.classList.add("resizing");
      // Read the frame BEFORE changing insets: with all insets auto a fixed
      // element jumps to its static position, which would corrupt the seed.
      var s = startFrame();
      p.style.left = s.left + "px";
      p.style.top = s.top + "px";
      p.style.right = "auto";
      p.style.bottom = "auto";
      var sx = e.clientX;
      pointerDrag(p, function (ev) {
        var delta = sx - ev.clientX; // >0 when dragging left
        var nw = Math.min(Math.max(PANEL_MIN_W, s.w + delta), window.innerWidth - 16);
        p.style.width = nw + "px";
        // Use the RENDERED width (CSS max-width may cap it below nw) so the
        // left edge tracks the real growth, not the requested amount.
        var rw = p.getBoundingClientRect().width;
        p.style.left = (s.left - (rw - s.w)) + "px";
        panelPos.w = rw;
        panelPos.x = parseFloat(p.style.left);
      });
      p.addEventListener("pointerup", function done() {
        p.classList.remove("resizing");
        clampPanel();
        savePanelGeom();
        p.removeEventListener("pointerup", done);
      });
    });
    // Top edge: vertical resize (drag up to TALLER). Same two-edge logic so
    // the bottom edge stays fixed instead of the top one tracking the cursor.
    var rt = p.querySelector(".ai-chat-resize-v");
    if (rt) rt.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (isDocked()) return;
      p.classList.add("resizing");
      var s = startFrame();
      p.style.left = s.left + "px";
      p.style.top = s.top + "px";
      p.style.right = "auto";
      p.style.bottom = "auto";
      var sy = e.clientY;
      pointerDrag(p, function (ev) {
        var delta = sy - ev.clientY; // >0 when dragging up
        var nh = Math.min(Math.max(PANEL_MIN_H, s.h + delta), window.innerHeight - 16);
        p.style.height = nh + "px";
        // Use the RENDERED height (CSS max-height may cap it below nh) so the
        // top edge tracks the real growth, not the requested amount.
        var rh = p.getBoundingClientRect().height;
        p.style.top = (s.top - (rh - s.h)) + "px";
        panelPos.h = rh;
        panelPos.y = parseFloat(p.style.top);
      });
      p.addEventListener("pointerup", function done() {
        p.classList.remove("resizing");
        clampPanel();
        savePanelGeom();
        p.removeEventListener("pointerup", done);
      });
    });
    // Right edge: horizontal resize (drag right to WIDER). The left edge is
    // the anchor, so only the width changes.
    var rr = p.querySelector(".ai-chat-resize-r");
    if (rr) rr.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (isDocked()) return;
      p.classList.add("resizing");
      var s = startFrame();
      p.style.left = s.left + "px"; // anchor left so width grows rightward
      p.style.top = s.top + "px";
      p.style.right = "auto";
      p.style.bottom = "auto";
      var sx = e.clientX;
      pointerDrag(p, function (ev) {
        var delta = ev.clientX - sx; // >0 when dragging right
        var nw = Math.min(Math.max(PANEL_MIN_W, s.w + delta), window.innerWidth - 16);
        p.style.width = nw + "px";
        panelPos.w = nw;
      });
      p.addEventListener("pointerup", function done() {
        p.classList.remove("resizing");
        clampPanel();
        savePanelGeom();
        p.removeEventListener("pointerup", done);
      });
    });
    // Bottom edge: vertical resize (drag down to TALLER). The top edge is
    // the anchor, so only the height changes.
    var rb = p.querySelector(".ai-chat-resize-h");
    if (rb) rb.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (isDocked()) return;
      p.classList.add("resizing");
      var s = startFrame();
      p.style.left = s.left + "px";
      p.style.top = s.top + "px"; // anchor top so height grows downward
      p.style.right = "auto";
      p.style.bottom = "auto";
      var sy = e.clientY;
      pointerDrag(p, function (ev) {
        var delta = ev.clientY - sy; // >0 when dragging down
        var nh = Math.min(Math.max(PANEL_MIN_H, s.h + delta), window.innerHeight - 16);
        p.style.height = nh + "px";
        panelPos.h = nh;
      });
      p.addEventListener("pointerup", function done() {
        p.classList.remove("resizing");
        clampPanel();
        savePanelGeom();
        p.removeEventListener("pointerup", done);
      });
    });
    // Keep on-screen if the window is resized.
    window.addEventListener("resize", clampPanel);
  }

  // ---- Docked bar geometry: span the center article column, never the side panels ----
  // The docked bar is position:fixed (pinned to the bottom of the SCREEN). To
  // keep it from covering the sticky side panels, its left/width are set to
  // exactly the center .center column's box (the article column of the Quartz
  // grid); on single-column layouts (mobile / sidebars hidden) it spans edge
  // to edge. The same measurement drives body's padding-bottom so the
  // article + footer bottom stay clear of the bar.
  var dockBar = { left: null, w: null, h: 0 };
  function layoutDockBar() {
    var p = panelEl();
    if (!p) return;
    var center = document.querySelector("#quartz-body .center");
    if (!center) return;
    var r = center.getBoundingClientRect();
    var gap = 8;
    var left = Math.max(gap, r.left - 4);
    var w = r.width + 8;
    if (w < 320) { left = 0; w = window.innerWidth; } // column too narrow to trust
    var docked = p.classList.contains("docked");
    if (docked) {
      p.style.left = left + "px";
      p.style.width = w + "px";
    }
    dockBar = { left: left, w: w, h: Math.max(p.offsetHeight, 0) };
    var pad = docked && p.offsetHeight ? Math.min(p.offsetHeight + 8, window.innerHeight - 60) : 0;
    document.body.style.paddingBottom = pad ? pad + "px" : "";
  }
  window.addEventListener("resize", layoutDockBar);
  window.addEventListener("load", layoutDockBar);

  // ---- Collapsible site side panels (left nav + right rail) ----
  // The site's 3-column Quartz grid keeps the left explorer and right related-
  // pages rail fixed at 320px each, which is a lot on a laptop. These two
  // fixed chevron buttons (mounted on <html> so SPA nav keeps them) collapse
  // the left and/or right column, giving the article the space. State persists.
  function buildSidebarToggles() {
    if (document.getElementById("sidebar-toggle-left")) return;
    var body = function () { return document.getElementById("quartz-body"); };
    function persist() {
      var b = body(); if (!b) return;
      try {
        localStorage.setItem("ai-chat-sidebars", JSON.stringify({
          left: b.classList.contains("no-left"),
          right: b.classList.contains("no-right")
        }));
      } catch (e) {}
    }
    function chevron(dir) {
      return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        (dir === "left" ? '<path d="M15 18l-6-6 6-6"/>' : '<path d="M9 18l6-6-6-6"/>') + "</svg>";
    }
    var leftBtn = el("button", {
      id: "sidebar-toggle-left", className: "sidebar-toggle sidebar-toggle-left",
      title: "Toggle side panel", "aria-label": "Toggle left side panel", onclick: function () {
        var b = body(); if (!b) return;
        b.classList.toggle("no-left");
        this.classList.toggle("collapsed", b.classList.contains("no-left"));
        persist();
      }
    });
    leftBtn.innerHTML = chevron("left");
    var rightBtn = el("button", {
      id: "sidebar-toggle-right", className: "sidebar-toggle sidebar-toggle-right",
      title: "Toggle related panel", "aria-label": "Toggle right side panel", onclick: function () {
        var b = body(); if (!b) return;
        b.classList.toggle("no-right");
        this.classList.toggle("collapsed", b.classList.contains("no-right"));
        persist();
      }
    });
    rightBtn.innerHTML = chevron("right");
    document.documentElement.appendChild(leftBtn);
    document.documentElement.appendChild(rightBtn);
    // Reflect saved state + keep chevron direction in sync after a moment.
    function apply() {
      var b = body();
      if (!b) return;
      var left = false, right = false;
      try {
        var s = JSON.parse(localStorage.getItem("ai-chat-sidebars") || "null");
        if (s) { left = !!s.left; right = !!s.right; }
      } catch (e) {}
      b.classList.toggle("no-left", left);
      b.classList.toggle("no-right", right);
      leftBtn.classList.toggle("collapsed", left);
      rightBtn.classList.toggle("collapsed", right);
    }
    // The 3-column body is re-rendered on every SPA nav, which drops the
    // collapse classes. The "nav" event can fire BEFORE the new body is in
    // place, so just re-apply on it once isn't enough — keep watching for
    // ~1.5s and re-apply every time a fresh body element appears (apply() is
    // idempotent and cheap).
    function reapplySoon() {
      var seen = {}, tries = 0;
      (function poll() {
        var b = document.getElementById("quartz-body");
        if (b && !seen[b]) { seen[b] = true; apply(); }
        if (tries++ < 90) requestAnimationFrame(poll);
      })();
    }
    document.addEventListener("nav", reapplySoon);
    window.addEventListener("popstate", reapplySoon);
    apply();
  }

  // ---- Build UI (mount on <html> so SPA navigation keeps it) ----
  function buildUI() {
    if (document.getElementById("ai-chat-fab")) return;

    var fab = el("button", {
      id: "ai-chat-fab",
      className: "ai-chat-fab",
      title: "Open AI Chat Assistant",
      "aria-label": "Open the AI chat assistant",
      "aria-expanded": "false",
      onclick: openPanel
    });
    // Single chat-bubble icon: the FAB only OPENS the panel (it hides while
    // open); closing is the small X in the panel header, plus Escape.
    fab.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.1-1L3 20l1.1-4.3A8.5 8.5 0 1 1 21 11.5z"/></svg>';
    document.documentElement.appendChild(fab);

    var panel = el("div", { id: "ai-chat-panel", className: "ai-chat-panel closed" });

    // (Saved position/size are restored after the panel is appended to the
    // document — getElementById can't see it before then.)

    // Resize handles: all four edges. Left/top are "anchored" edges (dragging
    // them moves that edge + size); right/bottom are "free" edges (dragging
    // them just changes the size).
    panel.appendChild(el("div", { className: "ai-chat-resize", title: "Drag to resize width" }));
    panel.appendChild(el("div", { className: "ai-chat-resize-v", title: "Drag to resize height" }));
    panel.appendChild(el("div", { className: "ai-chat-resize-r", title: "Drag to resize width" }));
    panel.appendChild(el("div", { className: "ai-chat-resize-h", title: "Drag to resize height" }));

    var header = el("div", { className: "ai-chat-header", title: "Drag to move" });
    header.appendChild(el("h3", { textContent: "CS Admission FAQ" }));
    var actions = el("div", { className: "ai-chat-header-actions" });
    actions.appendChild(el("button", { title: "Settings", textContent: "\u2699\uFE0F", onclick: openSettings }));
    // Inline SVG (not an emoji): emoji rendering depends on the OS emoji
    // font, which is exactly what made the clear button look broken.
    var clearBtn = el("button", { title: "Clear chat", onclick: clearChat, "aria-label": "Clear chat" });
    clearBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>' +
      '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>' +
      '<path d="M10 11v6M14 11v6"/></svg>';
    actions.appendChild(clearBtn);
    // Dock: pin the chat as a floating bar at the bottom of the SCREEN (never
    // scrolled out of sight), spanning only the center article column so it
    // can't cover the side panels; body gains matching bottom padding so the
    // article/footer clear it. Toggle again to undock.
    var dockBtn = el("button", {
      title: "Dock chat to the bottom of the screen",
      "aria-label": "Dock chat to the bottom of the screen",
      className: "ai-chat-dock",
      onclick: function () { setDocked(!isDocked()); }
    });
    dockBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3v8"/><path d="M8 7l4 4 4-4"/><path d="M4 15h16v6H4z"/></svg>';
    actions.appendChild(dockBtn);
    // Close (X) button — top-right of the header. Small and inline (not the
    // big FAB), matching the other header icon buttons.
    var closeBtn = el("button", {
      title: "Close chat",
      "aria-label": "Close chat",
      className: "ai-chat-close",
      onclick: closePanel
    });
    closeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 6l12 12M18 6L6 18"/></svg>';
    actions.appendChild(closeBtn);
    header.appendChild(actions);
    panel.appendChild(header);

    var status = el("div", { className: "ai-chat-status" });
    status.appendChild(el("span", { id: "ai-chat-status-dot", className: "status-dot" }));
    status.appendChild(el("span", { id: "ai-chat-status-text", textContent: "Starting\u2026" }));
    panel.appendChild(status);

    var msgBox = el("div", { id: "ai-chat-messages", className: "ai-chat-messages" });
    panel.appendChild(msgBox);
    // The panel isn't in the DOM yet (appended at the end of buildUI), so
    // getElementById would return null — pass the reference directly.
    attachLinkQrHover(msgBox);

    var inputArea = el("div", { className: "ai-chat-input-area" });
    var textarea = el("textarea", {
      id: "ai-chat-input",
      placeholder: "Ask a question about CityUHK CS admission\u2026",
      rows: "1"
    });
    textarea.dataset.ph = textarea.placeholder;
    // If the visitor tabs/clicks into the input while the panel is closed
    // (e.g. it was miniaturised), open it so typing works.
    textarea.addEventListener("focus", function () {
      var p = document.getElementById("ai-chat-panel");
      if (p && p.classList.contains("closed")) togglePanel();
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

    // Restore the visitor's saved position/size now that the panel is in the
    // document (applyPanelGeom reads it via getElementById). If they had the
    // chat docked, applyDockState() moves it into the page grid instead.
    restorePanelGeom();
    applyDockState();

    // Wire drag/resize now that the panel is in the document.
    wirePanelDrag();
    // Collapsible left/right site side panels.
    buildSidebarToggles();

    // "Share this page" QR card in the right sidebar (full published URL).
    // buildSidebarQr also wires its own per-nav re-injection + URL re-target.
    buildSidebarQr();
  }

  // ---- Debug / test hook (harmless in production) ----
  window.__aiChatDebug = {
    setEngine: function (e, modelId) {
      engine = e;
      if (modelId) currentModelId = modelId;
      if (e) clearEndpointCfg(); // a real in-browser engine supersedes external
    },
    setExternal: function (cfg) { saveEndpointCfg(cfg); },
    getExternal: function () { return endpointCfg(); },
    getModel: function () { return currentModelId; },
    history: function () { return conversationHistory.slice(); },
    tools: TOOLS,
    // Headless testing: run any registered tool by name; returns a promise.
    callTool: function (name, args) { return executeTool(name, args || {}, {}); }
  };

  // ---- Init ----
  function init() {
    buildUI();
    showWelcome();
    loadKnowledgeIndex();
    // Escape closes the panel (when open) — the header X does the same.
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panelOpen) closePanel();
    });
    var savedCfg = endpointCfg();
    var savedModel = storageGetModel();
    if (savedCfg && savedCfg.kind === "external") {
      // Visitor explicitly configured their own server -> it wins.
      activateExternal();
    } else if (savedModel) {
      // Visitor explicitly loaded an in-browser model -> it wins.
      loadEngine(savedModel);
    } else {
      // No explicit choice: try the site-provided "free" provider. If it's
      // up and the key works, visitors get free answers with zero setup.
      // If not (disabled / key revoked / offline), fall back to the
      // normal "open settings and configure" prompt.
      setStatus("ready", "Checking free AI service\u2026");
      loadFreeConfig().then(function () {
        if (isFree()) activateFree();
        else setStatus("ready", "Open \u2699 settings to load a model or connect a server");
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
// (single IIFE wrapper is added by index.js around tools.js + this file)
