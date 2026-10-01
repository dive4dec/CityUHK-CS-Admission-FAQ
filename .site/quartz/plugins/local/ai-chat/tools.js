/* ================================================================
 AI Chat Widget — Agent tool registry (50+ tools) + Pyodide sandbox.
 Prepended to chat.js (same IIFE scope, plain top-level script).
 Adds: TOOL_LIB (execution) + TOOL_SCHEMAS (OpenAI tool schema) +
 Pyodide-backed run_python. See chat.js for the agent loops that
 consume these (executeTool delegates to TOOL_LIB).
 ================================================================ */

  // ---- Tool registry helpers ----
  var TOOL_LIB = {};   // name -> fn(args, ctx) -> result object
  var TOOL_SCHEMAS = []; // {name, description, parameters}

  function tool(def) {
    TOOL_LIB[def.name] = def.fn;
    TOOL_SCHEMAS.push({
      type: "function",
      function: {
        name: def.name,
        description: def.description,
        parameters: def.parameters || { type: "object", properties: {}, required: [] }
      }
    });
  }
  function strParam(d) { return { type: "string", description: d }; }
  function intParam(d) { return { type: "integer", description: d }; }
  function boolParam(d) { return { type: "boolean", description: d }; }
  function strArrParam(d) { return { type: "array", items: { type: "string" }, description: d }; }
  function codeParam() { return strParam("JUPAS (JSxxxx) or non-JUPAS (xxxxA) programme code, e.g. JS1204 or 1561A"); }
  function yearParam() { return intParam("Year, 2023-2026"); }
  function limitParam() { return intParam("Max items to return (default 5, max 10)"); }
  function textParam() { return strParam("Keywords, e.g. \"JUPAS CS admission score\""); }
  function normStr(v) { return String(v == null ? "" : v).trim(); }
  function normList(v) {
    if (Array.isArray(v)) return v.map(normStr).filter(Boolean);
    if (typeof v === "string") return v.split(/[,;]/).map(normStr).filter(Boolean);
    return [];
  }
  function normYears(v) {
    var out = [];
    normList(v).forEach(function (x) {
      var m = x.match(/(20[12]\d)/);
      if (m) out.push(parseInt(m[1], 10));
    });
    if (!out.length) out.push(2026);
    return out;
  }
  function entryByIdx(i) { return (knowledgeIndex && knowledgeIndex[i]) || null; }
  function entriesMatching(code, mode) {
    if (!knowledgeIndex || !code) return [];
    var c = String(code).toUpperCase().replace(/[\s_]+/g, "");
    var out = [];
    for (var i = 0; i < knowledgeIndex.length; i++) {
      var e = knowledgeIndex[i];
      var hay = (e.slug + " " + e.title + " " + e.text);
      var re;
      if (mode === "nonjupas") re = new RegExp("\\b" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
      else re = new RegExp("[^A-Za-z0-9]?JS" + c.replace(/^JS/, "") + "[^A-Za-z0-9]");
      if (re.test(hay)) out.push(e);
    }
    return out;
  }
  function shortAnswer(entry) {
    // Tip callout: "> [!tip] Short answer" then a blank "> " line, then the
    // answer lines ("> ..."), until the first non-"> " line (e.g. "## Question").
    var text = entry.text || "";
    var lines = text.split("\n");
    var start = -1;
    for (var i = 0; i < lines.length; i++) {
      if (/^>\s*\[!tip\]/.test(lines[i])) { start = i + 1; break; }
    }
    if (start < 0) return "";
    var out = [];
    for (var j = start; j < lines.length; j++) {
      var line = lines[j];
      if (!line.startsWith(">")) break;      // end of the callout
      var content = line.replace(/^>\s?/, "");
      if (content) out.push(content);
    }
    var sa = out.join(" ").replace(/\s+/g, " ").trim();
    return sa;
  }
  // Map full programme names to the abbreviations used in note titles, so
  // lookups like get_nonjupas_code("Computer Science") match "BSc CS ...".
  var PROGRAMME_ALIASES = {
    "computer science": ["computer science", "cs", "comp sci"],
    "cs": ["cs", "computer science"],
    "cybersecurity": ["cybersecurity", "cyber"],
    "data science": ["data science", "ds"],
    "data and systems engineering": ["data and systems engineering", "dse"],
    "computational finance": ["computational finance", "fintech", "fin tech"]
  };
  function programmeVariants(name) {
    var n = String(name || "").toLowerCase().trim();
    var out = [];
    (PROGRAMME_ALIASES[n] || [n]).forEach(function (v) { if (v && out.indexOf(v) < 0) out.push(v); });
    if (n && out.indexOf(n) < 0) out.push(n);
    return out;
  }
  // True if any programme-variant matches `hay` on WORD boundaries (so the
  // alias "ds" matches "BSc DS" but not "...systems...").
  function programmeMatches(hay, variants) {
    var h = String(hay || "").toLowerCase();
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      if (!v) continue;
      var re = new RegExp("\\b" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
      if (re.test(h)) return true;
    }
    return false;
  }
  function capTitle(t) { return t.replace(/\([^)]*\)/g, "").trim(); }
  // True if a note's folder slug starts with any of `prefixes` (case-insensitive,
  // so "05_Programmes" matches the stored slug "05_programmes"). Pass [] to match all.
  function folderPrefix(folder, prefixes) {
    if (!prefixes || !prefixes.length) return true;
    var f = String(folder || "").toLowerCase();
    for (var i = 0; i < prefixes.length; i++) {
      if (f.indexOf(String(prefixes[i]).toLowerCase()) === 0) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // SEARCH cluster — generic retrieval. Each entry it returns carries
  // `id`; read_note(id) then returns the FULL note text (the snippet
  // alone is often too thin to answer from — that is the main cause of
  // weak answers).
  // ------------------------------------------------------------------
  function searchCore(query, limit, folder, minTitleHits) {
    var q = normStr(query);
    var lim = Math.max(1, Math.min(parseInt(limit, 10) || 5, 10));
    if (!q || !knowledgeIndex) return { ok: false, count: 0, results: [], error: "search_notes needs a non-empty 'query' (e.g. \"JUPAS scholarship\"). Retry with keywords, not an empty string." };
    var terms = q.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
    if (!terms.length) return { ok: false, count: 0, results: [], error: "No searchable words in that query. Retry with different keywords." };
    // Topic boost: the longest query term (e.g. "scholarship" in
    // "JS1204 Computer Science JUPAS scholarship tier") names the real
    // topic. Doubling notes whose TITLE carries it stops off-topic but
    // keyword-rich notes (e.g. every JS1204 score note) from crowding out
    // the on-topic notes when the model appends the programme code.
    var topic = terms.slice().sort(function (a, b) { return b.length - a.length; })[0] || "";
    var scored = [];
    for (var i = 0; i < knowledgeIndex.length; i++) {
      var e = knowledgeIndex[i];
      if (folder && e.folder !== folder) continue;
      var combined = (e.title + " " + e.text).toLowerCase();
      var titleLower = e.title.toLowerCase();
      var score = 0, titleHits = 0;
      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        if (combined.indexOf(term) < 0) continue;
        score += titleLower.indexOf(term) >= 0 ? 10 : 1;
        if (titleLower.indexOf(term) >= 0) titleHits++;
        score += Math.max(0, 5 - combined.indexOf(term) / 100);
      }
      if (topic.length >= 6 && titleLower.indexOf(topic) >= 0) score *= 2;
      if (minTitleHits && titleHits < minTitleHits) continue;
      if (score > 0) scored.push({ e: e, score: score, titleHits: titleHits });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var payload = {
      ok: true,
      count: scored.length,
      results: scored.slice(0, lim).map(function (s) {
        return {
          id: knowledgeIndex.indexOf(s.e),
          slug: s.e.slug,
          title: s.e.title,
          folder: s.e.folder,
          score: Math.round(s.score * 10) / 10,
          short_answer: shortAnswer(s.e),
          snippet: answerExcerpt(s.e)
        };
      })
    };
    // The agent loop hard-truncates tool results (TOOL_RESULT_MAX). A cut
    // mid-object makes the model receive INVALID JSON and silently drops
    // the lowest-ranked (often most on-topic) results. Instead, shrink the
    // result set ourselves so the JSON always fits intact: fewer complete
    // results > broken JSON.
    var budget = (typeof TOOL_RESULT_MAX !== "undefined" ? TOOL_RESULT_MAX : 6000) - 200;
    var s = JSON.stringify(payload);
    while (s.length > budget && payload.results.length > 1) {
      payload.results.pop();
      s = JSON.stringify(payload);
    }
    if (payload.results.length < Math.min(lim, scored.length)) {
      payload.truncated = "Fewer results shown to fit the tool-result budget; the top-ranked ones are complete. Use read_note(id) for full text or re-search with a smaller limit.";
    }
    return payload;
  }
  // Excerpt anchored at the note's "## Answer" section (falls back to the
  // start of the text). This is where the actual tables, amounts and
  // thresholds live — a leading slice just re-serves the tip callout that
  // short_answer already covers, wasting the (truncated) tool-result budget
  // and hiding the data the model needs.
  function answerExcerpt(entry) {
    var text = entry.text || "";
    var ai = text.indexOf("## Answer");
    var start = ai >= 0 ? ai : 0;
    var out = text.slice(start, start + 340).replace(/\n{2,}/g, "\n").trim();
    return start > 0 ? "… " + out : out;
  }

  tool({
    name: "search_notes",
    description: "Keyword-search all the CityUHK CS admission FAQ notes. The MAIN lookup tool. Returns ranked results with a 'short_answer' for each — usually enough to answer directly; call read_note(id) for the full text when you need more detail. If the user asks about the CURRENT/THIS page, use read_current_page instead.",
    parameters: {
      type: "object",
      properties: {
        query: textParam(),
        limit: limitParam(),
        folder: strParam("Optional folder prefix to narrow the search, e.g. '07_cityu-scores' (see list_folders)")
      },
      required: ["query"]
    },
    fn: function (a, ctx) {
      var r = searchCore(a.query, a.limit, normStr(a.folder), 0);
      r.hint = r.count ? "You have enough to answer. Use read_note(id) only if a result's short_answer/snippet is insufficient." : "Try fewer/different keywords, or list_folders to find the right section.";
      return r;
    }
  });

  tool({
    name: "search_exact",
    description: "Strict search: a note only matches if EVERY keyword appears in its TITLE (or the whole note for multi-word phrases). Use when search_notes returns too many loosely related notes.",
    parameters: { type: "object", properties: { query: textParam(), limit: limitParam() }, required: ["query"] },
    fn: function (a) {
      var r = searchCore(a.query, a.limit, "", 1);
      r.note = "Only notes whose title contains at least one full keyword are shown; tighten keywords for stricter matching.";
      return r;
    }
  });

  tool({
    name: "find_notes_mentioning",
    description: "Find every note that mentions a specific code, subject, programme, university or number (e.g. 'JS1204', 'Cybersecurity', 'HKU', '47,000'). Returns up to 10 matches with title + short answer.",
    parameters: { type: "object", properties: { term: strParam("The exact word/phrase/code to find in the notes"), limit: limitParam() }, required: ["term"] },
    fn: function (a) {
      var t = normStr(a.term);
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 10, 10));
      if (!t || !knowledgeIndex) return { ok: true, count: 0, results: [] };
      var tl = t.toLowerCase();
      var results = [];
      for (var i = 0; i < knowledgeIndex.length && results.length < lim; i++) {
        var e = knowledgeIndex[i];
        if ((e.title + " " + e.text).toLowerCase().indexOf(tl) >= 0) {
          results.push({ id: i, slug: e.slug, title: e.title, folder: e.folder, short_answer: shortAnswer(e) });
        }
      }
      return { ok: true, count: results.length, results: results };
    }
  });

  // ------------------------------------------------------------------
  // WEB cluster — best-effort internet lookup for topics the vault does NOT
  // cover (job market, salaries, industry news, competitor universities'
  // non-CityU data, general CS knowledge). Calls Wikipedia (en + zh) and
  // DuckDuckGo straight from the browser (both are CORS-open, no proxy /
  // server / API key needed). Used ONLY after search_notes comes up empty —
  // the vault is the source of truth for admission facts; the web is a
  // fallback so the assistant never just says "not in the notes."
  // ------------------------------------------------------------------
  function decodeWikiSnippet(s) {
    return String(s || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/\s+/g, " ").trim();
  }
  async function wikiSearch(lang, q, lim) {
    var base = "https://" + lang + ".wikipedia.org/w/api.php";
    var url = base + "?action=query&list=search&srsearch=" + encodeURIComponent(q) +
      "&srlimit=" + lim + "&format=json&origin=*";
    var res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var data = await res.json();
    var rows = (data && data.query && data.query.search) || [];
    return rows.map(function (r) {
      return {
        source: "Wikipedia",
        title: r.title,
        snippet: decodeWikiSnippet(r.snippet),
        url: "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(r.title.replace(/ /g, "_"))
      };
    });
  }
  async function ddgSearch(q, lim) {
    // DuckDuckGo Instant Answer API (CORS-open). Returns topic/abstract/
    // related topics rather than full web results — a good lightweight source.
    var url = "https://api.duckduckgo.com/?q=" + encodeURIComponent(q) + "&format=json&no_html=1&no_redirect=1&skip_disambig=1";
    var res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var d = await res.json();
    var out = [];
    if (d.AbstractText) out.push({ source: "DuckDuckGo", title: d.Heading || q, snippet: String(d.AbstractText), url: d.AbstractURL || "" });
    ((d.RelatedTopics) || []).slice(0, lim).forEach(function (t) {
      var item = t.FirstURL ? t : (t.Topics && t.Topics[0]);
      if (!item || !item.Text) return;
      out.push({ source: "DuckDuckGo", title: item.Text.split(" - ")[0], snippet: item.Text, url: item.FirstURL || "" });
    });
    return out;
  }

  tool({
    name: "web_search",
    description: "Search the INTERNET (Wikipedia + DuckDuckGo) for information the site's notes do NOT cover — e.g. CS job market / salaries / demand in Hong Kong, industry trends, what a CS graduate does, general CS concepts. Use this as a FALLBACK when search_notes returns nothing or clearly lacks the answer, so you can still give a best-effort answer instead of just saying 'not in the notes'. Always frame web results as general knowledge (cite the source title), and note the site's own admission data is authoritative for CityU facts.",
    parameters: {
      type: "object",
      properties: {
        query: textParam("Web search keywords, e.g. \"Hong Kong computer science graduate salary job market\""),
        limit: limitParam()
      },
      required: ["query"]
    },
    fn: async function (a) {
      var q = normStr(a.query);
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 5, 8));
      if (!q) return { ok: false, error: "web_search needs a non-empty 'query'." };
      var results = [];
      var errors = [];
      // Run Wikipedia (en + zh) and DuckDuckGo concurrently; tolerate any one
      // failing (offline / blocked) and return what we got.
      try {
        var en = await wikiSearch("en", q, lim);
        results = results.concat(en);
      } catch (e) { errors.push("wikipedia-en: " + (e && e.message ? e.message : e)); }
      try {
        var zh = await wikiSearch("zh", q, Math.max(2, Math.floor(lim / 2)));
        results = results.concat(zh);
      } catch (e) { errors.push("wikipedia-zh: " + (e && e.message ? e.message : e)); }
      try {
        var ddg = await ddgSearch(q, Math.max(2, Math.floor(lim / 2)));
        results = results.concat(ddg);
      } catch (e) { errors.push("duckduckgo: " + (e && e.message ? e.message : e)); }
      // De-dupe by (source+title), cap to limit.
      var seen = {}, out = [];
      for (var i = 0; i < results.length && out.length < lim; i++) {
        var r = results[i];
        if (!r || !r.snippet) continue;
        var k = r.source + "|" + r.title;
        if (seen[k]) continue;
        seen[k] = true;
        out.push(r);
      }
      if (!out.length) {
        return {
          ok: false,
          error: "No web results (sources unreachable or no matches)." + (errors.length ? " (" + errors.join("; ") + ")" : ""),
          hint: "If the internet is blocked in the user's browser, fall back to answering from the site notes or say you could not verify."
        };
      }
      return {
        ok: true,
        count: out.length,
        results: out,
        caveat: "General web knowledge (Wikipedia / DuckDuckGo), NOT CityU's official admission data. Cite the source title(s); for CityU-specific admission facts the site notes are authoritative."
      };
    }
  });

  tool({
    name: "list_folders",
    description: "List the site's note sections (folders) with note counts. Use to discover what topics exist before searching, or when a search returns nothing.",
    parameters: { type: "object", properties: {}, required: [] },
    fn: function () {
      if (!knowledgeIndex) return { ok: false, error: "index not loaded" };
      var counts = {}, names = {};
      for (var i = 0; i < knowledgeIndex.length; i++) {
        var f = knowledgeIndex[i].folder || "(root)";
        counts[f] = (counts[f] || 0) + 1;
        names[f] = knowledgeIndex[i].title;
      }
      var out = Object.keys(counts).sort().map(function (f) { return { folder: f, notes: counts[f], example: names[f] }; });
      return { ok: true, sections: out };
    }
  });

  tool({
    name: "list_notes",
    description: "List note titles (with ids and slugs) in a folder or matching a title keyword. Cheap way to browse a section (e.g. all 2026 CityU score notes, all courses) without reading their content.",
    parameters: {
      type: "object",
      properties: {
        folder: strParam("Folder prefix, e.g. '07_cityu-scores'"),
        title_contains: strParam("Only titles containing this text (case-insensitive)"),
        limit: limitParam()
      },
      required: []
    },
    fn: function (a) {
      var f = normStr(a.folder), tc = normStr(a.title_contains).toLowerCase();
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 25, 50));
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (f && e.folder !== f) continue;
        if (tc && e.title.toLowerCase().indexOf(tc) < 0) continue;
        out.push({ id: i, slug: e.slug, title: e.title });
        if (out.length >= lim) break;
      }
      return { ok: true, count: out.length, notes: out, hint: "Use read_note(id) to read the full text of any listed note." };
    }
  });

  tool({
    name: "read_note",
    description: "Return the full text of one note by the id (or slug) from search_notes / list_notes / find_notes_mentioning. Use when the returned snippet or short_answer is not enough to answer accurately — this is how you get complete details (tables, dates, conditions, full requirement lists) without navigating the user's page. For a LONG note, pass offset to read the part you have not seen yet (the result's `next_offset` tells you where to continue), or section to jump straight to a heading (e.g. 'Answer', 'Requirements', 'Examples').",
    parameters: {
      type: "object",
      properties: {
        id: intParam("Note id from a search/list result"),
        slug: strParam("Or the note slug"),
        offset: intParam("Character position to start from (default 0). Use the previous result's next_offset to continue."),
        max_chars: intParam("Max characters to return (default 2200, max 6000)"),
        section: strParam("Optional: start at the heading containing this text (e.g. 'Answer', 'Requirements', 'Examples')")
      },
      required: []
    },
    fn: function (a, ctx) {
      var e = null;
      if (a.id != null) e = entryByIdx(parseInt(a.id, 10));
      else if (normStr(a.slug)) { for (var i = 0; i < (knowledgeIndex || []).length; i++) if (knowledgeIndex[i].slug === normStr(a.slug)) { e = knowledgeIndex[i]; break; } }
      if (!e) return { ok: false, error: "No note with that id/slug. Call search_notes or list_notes first." };
      var text = e.text || "";
      var off = Math.max(0, parseInt(a.offset, 10) || 0);
      var max = Math.min(parseInt(a.max_chars, 10) || 2200, 6000);
      // section: jump to the first heading ("##"/"###") whose text contains the
      // term, so "section: Requirements" skips straight to that part of a long note.
      if (a.section) {
        var term = String(a.section).toLowerCase();
        var headingRe = /^#{2,6}\s+[^\n]*$/gm;
        var hm, bestAt = -1;
        while ((hm = headingRe.exec(text))) {
          if (hm[0].toLowerCase().indexOf(term) >= 0) { bestAt = hm.index; break; }
        }
        if (bestAt >= 0) off = bestAt;
      }
      if (off > text.length) off = text.length;
      var slice = text.slice(off, off + max);
      var nextOffset = off + slice.length;
      var out = { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, text: slice };
      if (nextOffset < text.length) {
        out.truncated = true;
        out.next_offset = nextOffset;
        out.total_chars = text.length;
        out.more = "Note continues — call read_note again with offset=" + nextOffset + " (or a smaller max_chars) to read the rest.";
      }
      return out;
    }
  });

  // ------------------------------------------------------------------
  // PROGRAMME & CODE cluster — structured lookups over the vault's
  // code tables (cheat sheet, per-code overview/score/fee notes).
  // ------------------------------------------------------------------
  function jupasCodesFromCheatSheet() {
    for (var i = 0; i < (knowledgeIndex || []).length; i++) {
      var e = knowledgeIndex[i];
      if (e.slug.indexOf("code-cheat-sheet") >= 0 && /JS\d{4}/.test(e.text)) {
        var rows = [];
        var re = /\|\s*(JS\d{4})\s*\|\s*([^|\n]+)\|/g, m;
        while ((m = re.exec(e.text)) && rows.length < 20) {
          var prog = m[2].trim();
          var route = e.text.slice(m.index).split("\n")[0].split("|").pop() || "";
          rows.push({ code: m[1], programme: prog, route: route.trim() || "JUPAS" });
        }
        if (rows.length) return rows;
      }
    }
    return null;
  }

  tool({
    name: "get_jupas_code",
    description: "Return the JUPAS code(s) for a CityUHK CS programme (e.g. 'computer science', 'cybersecurity', 'data science', 'double degree'). Use this when the user asks for a JUPAS code. Also use it to LIST all JUPAS codes when no programme is given.",
    parameters: { type: "object", properties: { programme: strParam("Programme name, e.g. 'Computer Science'; leave empty to list all") }, required: [] },
    fn: function (a) {
      var want = normStr(a.programme).toLowerCase();
      var all = jupasCodesFromCheatSheet();
      if (!all) return { ok: false, error: "Programme code table not found. Use search_notes instead." };
      if (!want) return { ok: true, codes: all, hint: "These are ALL CityUHK CS JUPAS codes. Cite them with their programme names." };
      var variants = programmeVariants(want);
      var hits = all.filter(function (r) {
        return programmeMatches(r.programme, variants) ||
          want.split(/\s+/).every(function (w) { return r.programme.toLowerCase().indexOf(w) >= 0; });
      });
      if (!hits.length) hits = all.filter(function (r) { return want.split(/\s+/).some(function (w) { return w.length > 3 && r.programme.toLowerCase().indexOf(w) >= 0; }); });
      return { ok: true, codes: hits.length ? hits : all, matched: hits.length > 0, hint: hits.length ? "" : "No exact programme match — here are all CS JUPAS codes to pick from." };
    }
  });

  tool({
    name: "get_nonjupas_code",
    description: "Return the non-JUPAS admission code(s) for a CityUHK CS programme (e.g. 1561A for BSc CS). Use when the user asks for a non-JUPAS / direct-application code, or the application fee / advanced-standing route.",
    parameters: { type: "object", properties: { programme: strParam("Programme name, e.g. 'Computer Science'; leave empty to list all") }, required: [] },
    fn: function (a) {
      var want = normStr(a.programme);
      var variants = want ? programmeVariants(want) : [];
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "03_nonjupas") continue;
        var m = e.title.match(/Code\s+([0-9]{4}[A-Z])/i);
        if (!m) continue;
        var prog = e.title.replace(/Non-JUPAS Code [0-9A-Z]+/i, "").replace(/\bBSc\b/g, "").trim();
        var hay = (e.title + " " + e.text).toLowerCase();
        var match = !want || programmeMatches(e.title + " " + e.text, variants);
        if (match) out.push({ code: m[1], programme: prog, note_title: e.title, note_id: i });
      }
      if (!out.length) return { ok: false, error: "No non-JUPAS code note found for that programme. Try search_notes." };
      return { ok: true, codes: out, hint: "Application fee and advanced-standing details: read_note(id) on a listed note." };
    }
  });

  tool({
    name: "get_programme_info",
    description: "Get programme profiles from their overview notes: what they are, streams/majors, duration, and the note's short answer. The single best first call when the user asks about a programme by name or code. Pass code='all' (or a broad name like 'double degree') to list EVERY matching programme note at once.",
    parameters: { type: "object", properties: { code: codeParam(), name: strParam("Or the programme name, e.g. 'BSc Data Science'; 'double degree' lists all double degrees") }, required: [] },
    fn: function (a) {
      var code = normStr(a.code), name = normStr(a.name);
      var variants = name ? programmeVariants(name) : [];
      var all = [];
      var wantAll = !code && !name || /^(all|list|every|all of them)$/i.test(code) || /^(all|list|every)$/i.test(name);
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var n = knowledgeIndex[i];
        if (n.folder !== "05_programmes") continue;
        if (wantAll) { all.push(n); continue; }
        var isCode = code && (new RegExp("\\b" + code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(n.slug + " " + n.title));
        var isName = name && (programmeMatches(n.title, variants) || programmeMatches(n.title + " " + n.text.slice(0, 200), variants));
        // Broad ask ("all", "double degree", "double") -> match every overview
        // note whose title carries the topic word(s). "double degree" is two
        // words, so word-boundary matching on the whole phrase would miss the
        // titles ("...Double Degree Overview"); match per topic word instead.
        var isBroad = false;
        if (name && /^(all|list|every|each|double(\s+degrees?)?(\s+and\s+\w+)*|\w+\s+(degree|degrees))$/i.test(name)) {
          var wts = name.toLowerCase().split(/\s+/).filter(function (w) { return w.length > 3 && w !== "degree" && w !== "degrees"; });
          if (wts.length) {
            var tl = n.title.toLowerCase();
            var wmatch = wts.filter(function (w) { return new RegExp("\\b" + w + "\\b").test(tl); }).length;
            isBroad = wmatch >= Math.ceil(wts.length / 2);
          }
        }
        if (isCode || isName || isBroad) all.push(n);
      }
      if (!all.length) {
        // Never fail blind: hand back the catalogue of codes so the model (or user) can pick.
        var known = [];
        for (var j = 0; j < (knowledgeIndex || []).length; j++) {
          var k = knowledgeIndex[j];
          if (k.folder !== "05_programmes") continue;
          var cm = k.title.match(/(JS\d{4})/);
          known.push(cm ? cm[1] + " " + k.title.replace(cm[1], "").trim() : k.title);
        }
        return { ok: false, error: "No programme note for that code/name.", known_codes: known.slice(0, 12), hint: "Pick a code from known_codes, or use search_notes." };
      }
      var first = all[0];
      if (all.length > 1) {
        // Multi-match: a compact list (full summaries for 14 notes would blow the budget).
        return {
          ok: true,
          matched: all.length,
          programmes: all.slice(0, 14).map(function (x) {
            return { id: knowledgeIndex.indexOf(x), title: x.title, short_answer: shortAnswer(x).slice(0, 220) };
          }),
          more: "Full text of any one via read_note(id)."
        };
      }
      return {
        ok: true,
        matched: all.length,
        id: knowledgeIndex.indexOf(first),
        slug: first.slug,
        title: first.title,
        short_answer: shortAnswer(first),
        summary: first.text.slice(0, 1200),
        more: "Full text via read_note(id)." + (all.length > 1 ? " Also matched: " + all.slice(1).map(function (x) { return x.title + " (id " + knowledgeIndex.indexOf(x) + ")"; }).join("; ") + "." : "")
      };
    }
  });

  tool({
    name: "list_all_programmes",
    description: "List every CityUHK CS programme note (title + id + code if present). Use to answer 'what programmes does CityUHK CS offer?' or to find the exact name before get_programme_info.",
    parameters: { type: "object", properties: { limit: limitParam() }, required: [] },
    fn: function (a) {
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 15, 30));
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "05_programmes") continue;
        var m = e.title.match(/(JS\d{4}|[0-9]{4}[A-Z])/);
        out.push({ id: i, title: e.title, code: m ? m[1] : null });
        if (out.length >= lim) break;
      }
      return { ok: true, count: out.length, programmes: out };
    }
  });

  tool({
    name: "compare_programmes",
    description: "Fetch the side-by-side comparison note(s) between CS programmes (e.g. CS vs Data Science vs Cybersecurity) and return their short answers + summary. Use for 'which programme is different / which should I choose' questions.",
    parameters: { type: "object", properties: { names: strArrParam("Optional programme names to compare, e.g. ['Computer Science','Cybersecurity']") }, required: [] },
    fn: function (a) {
      var want = normList(a.names);
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        // Comparison notes no longer live in a dedicated "10_compare" folder
        // (removed from the vault); they are titled "… vs …" / "…Key
        // Differences" inside 05_programmes / 04_curriculum / 02_jupas-scores.
        var isCompare = /\bvs\b|differen|compar/.test(e.title.toLowerCase());
        if (!isCompare) continue;
        var hay = e.title.toLowerCase() + " " + e.text.toLowerCase();
        if (want.length && !want.every(function (w) { return hay.indexOf(w.toLowerCase()) >= 0; })) continue;
        out.push({ id: i, slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 900) });
        if (out.length >= 3) break;
      }
      return { ok: true, count: out.length, comparisons: out, hint: out.length ? "read_note(id) for the full comparison." : "No dedicated comparison note matched — answer from get_programme_info results instead." };
    }
  });

  tool({
    name: "get_programme_streams",
    description: "Return the streams / specialisations / majors of a programme (e.g. the 5 streams of BSc CS: AI, Cybersecurity, Data Science, Multimedia, Software Engineering).",
    parameters: { type: "object", properties: { code: codeParam(), name: strParam("Or programme name") }, required: [] },
    fn: function (a, ctx) {
      var code = normStr(a.code), name = normStr(a.name).toLowerCase();
      var e = null;
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var n = knowledgeIndex[i];
        if (n.folder !== "05_programmes" && n.folder !== "06_courses") continue;
        var isCode = code && n.title.toUpperCase().indexOf(code.toUpperCase()) >= 0;
        var isName = name && n.title.toLowerCase().indexOf(name) >= 0;
        if ((isCode || isName) && (/stream|major|specialis/i.test(n.title) || /stream|major/i.test(n.text.slice(0, 400)))) { e = n; break; }
      }
      if (!e) {
        // fall back: search for streams in the programme's notes
        return { ok: false, error: "No dedicated streams note found. Use get_programme_info or search_notes(query='streams " + (code || name) + "')." };
      }
      return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 1200) };
    }
  });

  // ------------------------------------------------------------------
  // SCORE cluster — parses the vault's per-year score notes
  // (07_cityu-scores, 02_jupas-scores) into numbers.
  // ------------------------------------------------------------------
  function scoreFromNote(entry) {
    var t = entry.text || "";
    var med = t.match(/(?:Median|median)\s*([0-9]+)\b/i);
    var lq = t.match(/(?:Lower Quartile|lower quartile)\s*([0-9]+)\b/i);
    var yr = (entry.title.match(/\b(20[12]\d)\b/) || t.match(/\b(20[12]\d)\b/));
    var formula = t.match(/(?:formula|Formula)[:\s]*([^\n.]{3,60})/);
    return {
      median: med ? parseInt(med[1], 10) : null,
      lower_quartile: lq ? parseInt(lq[1], 10) : null,
      year: yr ? parseInt(yr[1], 10) : null,
      formula: formula ? formula[1].trim() : null,
      short_answer: shortAnswer(entry)
    };
  }
  function findCodeScoreNote(code, folderPrefix, year) {
    if (!knowledgeIndex) return null;
    var c = String(code || "").toUpperCase();
    var fallback = null;
    for (var i = 0; i < knowledgeIndex.length; i++) {
      var e = knowledgeIndex[i];
      if (folderPrefix && e.folder.indexOf(folderPrefix) !== 0) continue;
      if (c && e.title.toUpperCase().indexOf(c) < 0) continue;
      var s = scoreFromNote(e);
      if (s.median == null) continue;
      // Prefer a note whose TITLE carries the requested year; if the note
      // has no explicit year, fall back to text.
      var titleYear = (e.title.match(/\b(20[12]\d)\b/) || [])[1];
      var entryYear = titleYear ? parseInt(titleYear, 10) : s.year;
      if (year) {
        if (entryYear === parseInt(year, 10)) return e;
        if (!titleYear && s.year === parseInt(year, 10)) return e;
        if (!fallback) fallback = e;
      } else if (!fallback) {
        fallback = e;
      }
    }
    return fallback;
  }

  tool({
    name: "get_cityu_score",
    description: "Get CityUHK's published JUPAS admission score (median + lower quartile, weighted) for a CS programme code in a given year (default 2026). Use for 'what score do I need / what was the cut-off' questions about CityU itself.",
    parameters: { type: "object", properties: { code: codeParam(), year: yearParam() }, required: ["code"] },
    fn: function (a) {
      var e = findCodeScoreNote(a.code, "07_cityu-scores", a.year);
      if (!e) return { ok: false, error: "No CityU score note for " + a.code + (a.year ? " in " + a.year : "") + ". Try get_all_cityu_scores or search_notes." };
      var s = scoreFromNote(e);
      return { ok: true, code: String(a.code).toUpperCase(), programme: capTitle(e.title), year: s.year, median: s.median, lower_quartile: s.lower_quartile, formula: s.formula, note: s.short_answer, note_id: knowledgeIndex.indexOf(e) };
    }
  });

  tool({
    name: "get_rival_score",
    description: "NO LONGER POPULATED. Cross-university score comparisons (HKU, CUHK, HKUST, …) were removed from the vault, so this returns a 'removed' notice instead of data. For CityU's own published CS scores use get_cityu_score / get_all_cityu_scores / score_history.",
    parameters: { type: "object", properties: { code: strParam("The rival university's programme code, e.g. '6004' (HKU)"), university: strParam("e.g. 'HKU', 'CUHK', 'HKUST'"), year: yearParam() }, required: [] },
    fn: function (a) {
      return {
        ok: false,
        removed: true,
        error: "Cross-university score comparisons are no longer on this site — the vault covers CityU's OWN published CS scores only. Use get_cityu_score / get_all_cityu_scores / score_history for CityU. You may add the general caution that admission score scales differ across universities and are not directly comparable."
      };
    }
  });

  tool({
    name: "get_all_cityu_scores",
    description: "List CityU's published scores for every CS programme code, optionally for one year. Use for 'list all CS admission scores' or to compare CityU programmes against each other.",
    parameters: { type: "object", properties: { year: yearParam(), limit: limitParam() }, required: [] },
    fn: function (a) {
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 20, 40));
      var seen = {}, out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "07_cityu-scores") continue;
        var s = scoreFromNote(e);
        if (s.median == null) continue;
        if (a.year && s.year !== parseInt(a.year, 10)) continue;
        var m = e.title.match(/(JS\d{4})/);
        if (!m) continue;
        var key = m[1] + "|" + s.year;
        if (seen[key]) continue;
        seen[key] = true;
        out.push({ code: m[1], programme: capTitle(e.title), year: s.year, median: s.median, lower_quartile: s.lower_quartile, note_id: i });
        if (out.length >= lim) break;
      }
      out.sort(function (x, y) { return x.code < y.code ? -1 : 1; });
      return { ok: true, count: out.length, scores: out };
    }
  });

  tool({
    name: "score_history",
    description: "Get the year-by-year history of CityU's published scores for one programme code (e.g. JS1204 across 2023-2026). Use for 'how has the score trended / is it rising or falling'.",
    parameters: { type: "object", properties: { code: codeParam() }, required: ["code"] },
    fn: function (a) {
      var c = String(a.code || "").toUpperCase();
      if (!c) return { ok: false, error: "code is required" };
      var byYear = {};
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "07_cityu-scores" && e.folder !== "02_jupas-scores") continue;
        if (e.title.toUpperCase().indexOf(c) < 0) continue;
        var s = scoreFromNote(e);
        if (s.year && s.median != null) byYear[s.year] = { year: s.year, median: s.median, lower_quartile: s.lower_quartile };
      }
      var years = Object.keys(byYear).map(Number).sort();
      if (!years.length) return { ok: false, error: "No score history found for " + c + ". Use get_cityu_score for a single year." };
      var hist = years.map(function (y) { return byYear[y]; });
      var first = hist[0].median, last = hist[hist.length - 1].median;
      var trend = last > first ? "rising" : (last < first ? "falling" : "flat");
      return { ok: true, code: c, history: hist, trend: trend, from: first, to: last };
    }
  });

  tool({
    name: "lookup_grade_score",
    description: "Convert HKDSE grades into the weighted JUPAS admission score the site uses (Best-5 formula), and say how it compares to CityU CS's current median/quartile. Use when the user gives actual grades, e.g. '4,4,3,3,2 — is that enough for CS?'.",
    parameters: { type: "object", properties: { grades: strParam("Up to 5 DSE grades, e.g. '5,4,4,3,3' or 'A,B,B,C,C'"), code: codeParam() }, required: ["grades"] },
    fn: function (a) {
      var g = normStr(a.grades).toUpperCase();
      var map = { "A**": 7, "A*": 6, A: 5, B: 4, C: 3, D: 2, E: 1 };
      var nums = [];
      g.split(/[,;\s]+/).filter(Boolean).forEach(function (x) {
        x = x.trim();
        if (/^\d+$/.test(x)) nums.push(parseInt(x, 10));
        else if (map[x] != null) nums.push(map[x]);
      });
      if (!nums.length) return { ok: false, error: "Could not parse grades. Pass up to 5 DSE grades, e.g. '5,4,4,3,3'." };
      nums = nums.slice(0, 5);
      nums.sort(function (x, y) { return y - x; });
      var best5 = nums;
      var total = best5.reduce(function (s, n) { return s + n; }, 0);
      var total15 = Math.round(total * 1.5);
      var code = String(a.code || "JS1204").toUpperCase();
      var cs = findCodeScoreNote(code, "07_cityu-scores", 2026) || findCodeScoreNote("JS1204", "07_cityu-scores", 2026);
      var csScore = cs ? scoreFromNote(cs) : null;
      var vs = null;
      if (csScore && csScore.median != null) {
        vs = total >= csScore.median ? "at/above the 2026 median (" + csScore.median + ")"
          : (csScore.lower_quartile != null && total >= csScore.lower_quartile ? "between the lower quartile (" + csScore.lower_quartile + ") and median (" + csScore.median + ")"
          : "below the 2026 lower quartile (" + csScore.lower_quartile + ")");
      }
      return {
        ok: true, grades_best5: best5, score: total, score_1_5x_range: total15 !== total ? total + "-" + total15 : total,
        compared_to: vs,
        caveat: "Weight-1 published formula; the 1.5x subject-weighting policy (if applied) raises the top weighted subjects. Reference only, not a cut-off."
      };
    }
  });

  // ------------------------------------------------------------------
  // PRACTICAL cluster — fees, dates, requirements, routes, logistics.
  // Each tool reads the specific note(s) that hold that fact and returns
  // the short answer + relevant slice, so answers are concrete.
  // ------------------------------------------------------------------
  function topicNotes(keyword, folders, max) {
    var out = [];
    var kw = String(keyword || "").toLowerCase();
    var fl = folders || [];
    for (var i = 0; i < (knowledgeIndex || []).length; i++) {
      var e = knowledgeIndex[i];
      if (fl.length && !fl.some(function (f) { return e.folder.indexOf(f) === 0; })) continue;
      if (kw && (e.title + " " + e.text).toLowerCase().indexOf(kw) < 0) continue;
      out.push(e);
      if (out.length >= (max || 3)) break;
    }
    return out;
  }
  function topicResult(keyword, folders, max) {
    var notes = topicNotes(keyword, folders, max);
    if (!notes.length) return { ok: false, error: "No note found about '" + keyword + "'. Try search_notes." };
    return {
      ok: true,
      count: notes.length,
      notes: notes.map(function (e) {
        return { id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 900) };
      })
    };
  }

  tool({
    name: "get_tuition_fees",
    description: "Get CityUHK undergraduate tuition fees (local vs non-local, per year, per programme where noted) and whether CS programmes differ. Use for 'how much does it cost / tuition / fees'.",
    parameters: { type: "object", properties: { programme: strParam("Optional: a specific programme to check for fee differences, e.g. 'double degree'") }, required: [] },
    fn: function (a) {
      var notes = topicNotes(a.programme || "tuition fee", ["05_programmes", "01_jupas-basics"], 3);
      if (!notes.length) notes = topicNotes("fee", null, 3);
      if (!notes.length) return { ok: false, error: "No fee note found. Try search_notes(query='tuition fee')." };
      return { ok: true, count: notes.length, notes: notes.map(function (e) { return { id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 1000) }; }) };
    }
  });

  tool({
    name: "get_jupas_key_dates",
    description: "Get the JUPAS application key dates (submit, OEA, school reference, HKDSE results, Main Round offer, acceptance-fee window) for a cycle year. Use for 'when do I apply / what are the deadlines / when are results'.",
    parameters: { type: "object", properties: { year: yearParam() }, required: [] },
    fn: function (a) {
      var e = null;
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var n = knowledgeIndex[i];
        if (n.folder !== "01_jupas-basics" && n.folder !== "03_nonjupas") continue;
        if (!/key dates/i.test(n.title)) continue;
        if (a.year && new RegExp("\\b" + a.year + "\\b").test(n.title + n.text)) { e = n; break; }
        if (!e) e = n;
      }
      if (!e) return { ok: false, error: "No key-dates note found. Try search_notes(query='JUPAS key dates')." };
      return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, text: e.text.slice(0, 1800), more: "Full table via read_note(id)." };
    }
  });

  tool({
    name: "get_entry_requirements",
    description: "Get the minimum entrance / admission requirements (DSE subjects, grades, English, additional qualifications) for a CS programme. Use for 'what grades / what subjects do I need to qualify'.",
    parameters: { type: "object", properties: { code: codeParam(), name: strParam("Or programme name") }, required: [] },
    fn: function (a) {
      var code = normStr(a.code).toUpperCase(), name = normStr(a.name).toLowerCase();
      var e = null;
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var n = knowledgeIndex[i];
        var isReq = /requirement|entry/i.test(n.title);
        if (!isReq) continue;
        if (code && n.title.toUpperCase().indexOf(code) >= 0) { e = n; break; }
        if (name && n.title.toLowerCase().indexOf(name) >= 0) { e = n; break; }
      }
      if (!e) e = (topicNotes("minimum entrance requirement", ["01_jupas-basics", "05_programmes", "03_nonjupas"], 1))[0] || null;
      if (!e) return { ok: false, error: "No requirements note found. Try search_notes(query='minimum entrance requirements')." };
      return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 1100) };
    }
  });

  tool({
    name: "get_programme_duration",
    description: "Get the duration of a programme (e.g. 4 years for the standard JUPAS CS degree; note any differences for double degree / advanced standing). Use for 'how long is the degree'.",
    parameters: { type: "object", properties: { code: codeParam(), name: strParam("Or programme name") }, required: [] },
    fn: function (a) {
      var code = normStr(a.code).toUpperCase(), name = normStr(a.name).toLowerCase();
      var e = null;
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var n = knowledgeIndex[i];
        if (!/duration/i.test(n.title) && !/duration|year/i.test(n.text.slice(0, 300))) continue;
        if (code && n.title.toUpperCase().indexOf(code) >= 0) { e = n; break; }
        if (name && n.title.toLowerCase().indexOf(name) >= 0) { e = n; break; }
      }
      if (!e) e = (topicNotes("duration", ["05_programmes", "03_nonjupas"], 1))[0] || null;
      if (!e) return { ok: false, error: "No duration note found. Try search_notes(query='programme duration years')." };
      return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 900) };
    }
  });

  tool({
    name: "get_application_routes",
    description: "Explain the ways to get into CityUHK CS: JUPAS, non-JUPAS (local), advanced standing / transfer, and international (non-local) routes, with their codes and fees. Use for 'how do I apply / what are my options to apply'.",
    parameters: { type: "object", properties: {}, required: [] },
    fn: function (a, ctx) {
      var out = {};
      out.jupas = (topicNotes("JUPAS", ["01_jupas-basics"], 1))[0];
      out.nonjupas = (topicNotes("non-JUPAS", ["03_nonjupas"], 1))[0];
      var intl = (topicNotes("non-local", null, 1))[0] || (topicNotes("international", null, 1))[0];
      out.international = intl;
      var found = out.jupas || out.nonjupas || out.international;
      if (!found) return { ok: false, error: "No route notes found. Try search_notes(query='how to apply')." };
      function pack(e) { return e ? { id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e) } : null; }
      return { ok: true, jupas: pack(out.jupas), non_jupas: pack(out.nonjupas), international: pack(out.international), hint: "read_note(id) for details on any route." };
    }
  });

  tool({
    name: "get_scholarships",
    description: "Get scholarships / financial aid available to CityUHK CS students (amounts, eligibility, thresholds). Use for 'scholarships / funding / bursaries / financial aid'. Optionally set type to 'jupas', 'international', 'mainland', 'athlete', or 'donor' to narrow; omit for the main local entrance scholarships.",
    parameters: { type: "object", properties: { type: strParam("Optional: 'jupas' (local JUPAS Flagship/Institutional/Dean's), 'international', 'mainland', 'athlete', or 'donor'") }, required: [] },
    fn: function (a) {
      var t = normStr(a.type).toLowerCase();
      var queries = {
        jupas: ["scholarship jupas", "scholarship", "bursary"],
        international: ["scholarship international", "scholarship non-local", "scholarship"],
        mainland: ["scholarship mainland", "scholarship"],
        athlete: ["athletes entrance scholarship", "scholarship"],
        donor: ["donor scholarships", "scholarship"]
      };
      var qs = queries[t] || ["scholarship", "bursary", "financial aid"];
      var seen = {}, results = [];
      for (var qi = 0; qi < qs.length && results.length < 6; qi++) {
        var r = searchCore(qs[qi], 6);
        for (var i = 0; i < r.count && results.length < 6; i++) {
          var res = r.results[i];
          if (seen[res.id]) continue;
          seen[res.id] = true;
          results.push(res);
        }
        if (results.length) break; // only fall back to next query if the first returned nothing
      }
      if (!results.length) return { ok: false, error: "No scholarship note found in the FAQ. Try search_notes(query='scholarship')." };
      return { ok: true, count: results.length, notes: results.map(function (s) { return { id: s.id, slug: s.slug, title: s.title, short_answer: s.short_answer, snippet: s.snippet }; }) , hint: "For full requirement tables (minimum HKDSE scores, A*/IB thresholds, HK$ amounts) call read_note(id) on the relevant note." };
    }
  });

  tool({
    name: "get_rankings",
    description: "Get CityUHK CS academic rankings / reputation (QS, THE, subject world rankings, local standing). Use for 'how is CityU CS ranked / is it good / reputation'.",
    parameters: { type: "object", properties: {}, required: [] },
    fn: function (a) {
      var notes = topicNotes("ranking", ["00_vault-map", "05_programmes"], 3);
      if (!notes.length) notes = topicNotes("ranked", null, 3);
      if (!notes.length) return { ok: false, error: "No ranking note found. Try search_notes(query='QS ranking')." };
      return { ok: true, count: notes.length, notes: notes.map(function (e) { return { id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 900) }; }) };
    }
  });

  // ------------------------------------------------------------------
  // COURSE & CURRICULUM cluster — the 91 course FAQs (06_courses) and
  // curriculum notes (04_curriculum).
  // ------------------------------------------------------------------
  function courseCodeOf(title) {
    var m = String(title || "").match(/\b((?:CS|IT|IF|CPE|EE|AMath|MATH|PHYS|CHEM|BIOL|STAT|BIOI|ME|IE|AC|BA|BF|ECON|MGMT|ACCT)[0-9]{3,4}[A-Z]?)\b/i);
    return m ? m[1].toUpperCase() : null;
  }
  function findCourse(code, name) {
    code = String(code || "").toUpperCase().replace(/\s+/g, "");
    name = String(name || "").toLowerCase();
    for (var i = 0; i < (knowledgeIndex || []).length; i++) {
      var e = knowledgeIndex[i];
      if (e.folder !== "06_courses") continue;
      var cc = courseCodeOf(e.title);
      if (code && cc && (cc === code || e.title.toUpperCase().indexOf(code) >= 0)) return e;
      if (name && e.title.toLowerCase().indexOf(name) >= 0) return e;
    }
    return null;
  }

  tool({
    name: "get_course_info",
    description: "Get one CS course's FAQ: what it is, which year/area it belongs to, prerequisites, and workload hints. Use when the user names a course code (e.g. CS1102, CS2505) or title.",
    parameters: { type: "object", properties: { code: strParam("Course code, e.g. CS1102"), name: strParam("Or the course title, e.g. 'Algorithms'") }, required: [] },
    fn: function (a) {
      var e = findCourse(a.code, a.name);
      if (!e) return { ok: false, error: "No course found for '" + (a.code || a.name) + "'. Use list_courses to browse, or search_notes." };
      return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 1100), more: "read_note(id) for the full course FAQ." };
    }
  });

  tool({
    name: "list_courses",
    description: "List CS course codes + titles, optionally filtered by year (1-4), area, or a keyword. Use for 'what courses are in year 2 / list the core courses / what's in the AI stream'.",
    parameters: {
      type: "object",
      properties: {
        year: intParam("Optional year level 1-4"),
        keyword: strParam("Optional: filter titles containing this, e.g. 'algorithms'"),
        limit: limitParam()
      },
      required: []
    },
    fn: function (a) {
      var year = parseInt(a.year, 10), kw = normStr(a.keyword).toLowerCase();
      var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 20, 40));
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "06_courses") continue;
        if (kw && e.title.toLowerCase().indexOf(kw) < 0) continue;
        var cc = courseCodeOf(e.title);
        if (year) {
          // course-code second digit often signals year in CS dept (CS1xxx=yr1 etc.)
          var m = cc && cc.match(/^CS([0-9])/);
          if (m && year && parseInt(m[1], 10) !== year) {
            // also accept explicit "Year N" in text
            if (!new RegExp("year\\s+" + year, "i").test(e.text.slice(0, 400))) continue;
          }
        }
        out.push({ id: i, code: cc, title: e.title });
        if (out.length >= lim) break;
      }
      return { ok: true, count: out.length, courses: out, hint: "get_course_info(code) for details." };
    }
  });

  tool({
    name: "get_curriculum_overview",
    description: "Get the CS curriculum structure: core vs electives, the 5 streams, credit breakdown, and how courses fit together. Use for 'how is the CS curriculum structured / what do I study'.",
    parameters: { type: "object", properties: { limit: limitParam() }, required: [] },
    fn: function (a) {
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "04_curriculum") continue;
        out.push({ id: i, slug: e.slug, title: e.title, short_answer: shortAnswer(e) });
        if (out.length >= (parseInt(a.limit, 10) || 8)) break;
      }
      if (!out.length) return { ok: false, error: "No curriculum notes found. Try search_notes(query='curriculum')." };
      return { ok: true, count: out.length, notes: out };
    }
  });

  tool({
    name: "get_core_courses",
    description: "List the common-core / foundational CS courses (programming, algorithms, data structures, systems) that all CS streams share. Use for 'what core courses are mandatory'.",
    parameters: { type: "object", properties: { limit: limitParam() }, required: [] },
    fn: function (a) {
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "06_courses") continue;
        if (/core|foundational/i.test(e.text.slice(0, 400)) && /\bCS1\d{2,3}\b/.test(e.title)) {
          out.push({ id: i, code: courseCodeOf(e.title), title: e.title });
          if (out.length >= (parseInt(a.limit, 10) || 12)) break;
        }
      }
      if (!out.length) return { ok: false, error: "No core-course notes matched. Use list_courses or search_notes(query='core courses')." };
      return { ok: true, count: out.length, courses: out };
    }
  });

  tool({
    name: "list_stream_courses",
    description: "List the courses that belong to a specific CS stream (Artificial Intelligence, Cybersecurity, Data Science, Multimedia Computing, Software Engineering). Use for 'what courses are in the AI stream'.",
    parameters: { type: "object", properties: { stream: strParam("Stream name, e.g. 'Artificial Intelligence' or 'AI'") }, required: ["stream"] },
    fn: function (a) {
      var s = normStr(a.stream).toLowerCase();
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "06_courses") continue;
        if ((e.text.slice(0, 600) + " " + e.title).toLowerCase().indexOf(s) >= 0) {
          out.push({ id: i, code: courseCodeOf(e.title), title: e.title });
          if (out.length >= 25) break;
        }
      }
      if (!out.length) return { ok: false, error: "No courses matched stream '" + a.stream + "'. Use get_programme_streams to list the streams, then search_notes." };
      return { ok: true, count: out.length, stream: a.stream, courses: out };
    }
  });

  tool({
    name: "get_course_prerequisites",
    description: "Get the prerequisites / co-requisites and recommended background for a specific course. Use for 'what do I need before CS2505 / what are the prerequisites'.",
    parameters: { type: "object", properties: { code: strParam("Course code, e.g. CS2505"), name: strParam("Or course title") }, required: [] },
    fn: function (a) {
      var e = findCourse(a.code, a.name);
      if (!e) return { ok: false, error: "No course found for '" + (a.code || a.name) + "'. Use get_course_info or list_courses first." };
      var text = e.text;
      var m = text.match(/(prerequisit[\s\S]{0,300}?)(\n##|\n###|$)/i);
      var snippet = m ? m[1].trim() : text.slice(0, 600);
      return { ok: true, id: knowledgeIndex.indexOf(e), code: courseCodeOf(e.title), title: e.title, prerequisites: snippet.slice(0, 500), more: "read_note(id) for the full course FAQ." };
    }
  });

  tool({
    name: "get_elective_list",
    description: "List CS elective courses (non-core), optionally by stream or keyword. Use for 'what electives can I take / list electives'.",
    parameters: { type: "object", properties: { keyword: strParam("Optional filter, e.g. 'web' or 'graphics'"), limit: limitParam() }, required: [] },
    fn: function (a) {
      var kw = normStr(a.keyword).toLowerCase();
      var out = [];
      for (var i = 0; i < (knowledgeIndex || []).length; i++) {
        var e = knowledgeIndex[i];
        if (e.folder !== "06_courses") continue;
        if (/elective/i.test(e.text.slice(0, 600))) {
          if (kw && e.title.toLowerCase().indexOf(kw) < 0) continue;
          out.push({ id: i, code: courseCodeOf(e.title), title: e.title });
          if (out.length >= (parseInt(a.limit, 10) || 20)) break;
        }
      }
      if (!out.length) return { ok: false, error: "No electives matched. Use list_courses to browse, or search_notes(query='elective')." };
      return { ok: true, count: out.length, courses: out };
    }
  });

  // ------------------------------------------------------------------
  // TOPIC cluster — one tool per common question intent. Each reads the
  // note(s) that actually hold that answer and returns them, so the model
  // can answer concretely instead of re-searching.
  // ------------------------------------------------------------------
  tool({ name: "get_employment_outcomes", description: "Get CS graduate employment statistics (salaries, destinations, top employers) for a programme. Use for 'what do graduates do / starting salary / job prospects'.", parameters: { type: "object", properties: { code: codeParam(), name: strParam("Or programme name") }, required: [] }, fn: function (a) { var e = findTopic("employment", a); return e ? packNote(e, 1000) : { ok: false, error: "No employment note found. Try search_notes(query='employment outcomes')." }; } });
  tool({ name: "get_research_areas", description: "Get the CS department's research areas / labs / focus topics. Use for 'what is CS research at CityU / research groups'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("research", ["05_programmes", "00_vault-map"], 3); return packNotes(n, "research note"); } });
  tool({ name: "get_1_5x_weighting", description: "Explain the JUPAS 1.5x subject-weighting policy: what it does, which subjects count, its current status, and how it changes a candidate's admission score. Use for 'what is 1.5x weighting / how does weighting work'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("1.5x", ["01_jupas-basics"], 2); if (!n.length) n = topicNotes("subject weighting", ["01_jupas-basics"], 2); return packNotes(n, "1.5x weighting note"); } });
  tool({ name: "get_double_degree_info", description: "Get details of the CS double degree (BSc CS + BSc Computational Finance & FinTech, JS1221): how it works, duration, fees, entry. Use for questions about the double degree / JS1221.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("double degree", ["05_programmes", "01_jupas-basics", "02_jupas-scores"], 2); return packNotes(n, "double degree note"); } });
  tool({ name: "get_admission_process", description: "Explain how JUPAS admission works end-to-end: applications, choices, Main Round, Supplementary Round, and how offers are made. Use for 'how does JUPAS work / how are offers decided'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("JUPAS", ["01_jupas-basics"], 2); return packNotes(n, "JUPAS process note"); } });
  tool({ name: "get_flexible_admission", description: "Explain flexible admission: when CityU may make an offer even if the published score/quartile is not met (boundary cases, OEA, holistic review). Use for 'I'm just below the cut-off, any chance / what is flexible admission'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("flexible admission", null, 2); return packNotes(n, "flexible admission note"); } });
  tool({ name: "get_international_admission", description: "Get how international / non-local students apply to CityUHK CS (non-JUPAS international route, documents, fees, quotas). Use for 'I'm an international student, how do I apply / can foreigners apply'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("non-local", ["03_nonjupas", "01_jupas-basics"], 2); if (!n.length) n = topicNotes("international", null, 2); return packNotes(n, "international admission note"); } });
  tool({ name: "get_advancement_transfer", description: "Get advanced standing / transfer / articulation routes into CityUHK CS (starting in year 2, credit transfer, associate-degree pathways). Use for 'can I start in year 2 / transfer into CS / advanced standing'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("advanced standing", ["03_nonjupas"], 2); if (!n.length) n = topicNotes("transfer", null, 2); return packNotes(n, "advanced standing/transfer note"); } });
  tool({ name: "get_placement_career", description: "Get internship, industry placement, and career-services info for CS students. Use for 'is there an internship / placement programme / career support'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("placement", null, 2); if (!n.length) n = topicNotes("internship", null, 2); return packNotes(n, "placement/internship note"); } });
  tool({ name: "get_campus_location", description: "Get the CityUHK Kowloon Tong campus location, how to get there, and facilities relevant to CS students. Use for 'where is the campus / how do I get to CityU'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("campus", null, 2); if (!n.length) n = topicNotes("Kowloon Tong", null, 2); return packNotes(n, "campus note"); } });
  tool({ name: "get_accommodation", description: "Get on-campus student accommodation info for CityUHK CS freshmen (availability, cost, eligibility). Use for 'is there student housing / where will I stay / accommodation'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("accommodation", null, 2); if (!n.length) n = topicNotes("dormitory", null, 2); return packNotes(n, "accommodation note"); } });
  tool({ name: "get_finance_loan", description: "Get student finance options: HKSF / JUPAS loan, tuition payment instalments, and cost planning. Use for 'student loan / how do I pay tuition / financial assistance'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("loan", null, 2); if (!n.length) n = topicNotes("HKSF", null, 2); return packNotes(n, "finance/loan note"); } });
  tool({ name: "get_language_requirement", description: "Get the English / DSE language subject requirement for CS admission (and any other subject minimums). Use for 'what English grade do I need / language requirement'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("English", ["01_jupas-basics", "05_programmes"], 2); if (!n.length) n = topicNotes("language requirement", null, 2); return packNotes(n, "language requirement note"); } });
  tool({ name: "get_subject_weights", description: "Get how JUPAS weights the best-5 subjects for CityU CS (which subjects count, best-5 rule, bonus/penalty). Use for 'how is the admission score calculated / subject weighting for CityU CS'.", parameters: { type: "object", properties: { code: codeParam() }, required: [] }, fn: function (a) { var e = findCodeScoreNote(a.code, "07_cityu-scores"); if (e) { var s = scoreFromNote(e); return { ok: true, code: String(a.code).toUpperCase(), formula: s.formula, note: s.short_answer, note_id: knowledgeIndex.indexOf(e) }; } var n = topicNotes("weighting formula", ["01_jupas-basics", "02_jupas-scores"], 2); return packNotes(n, "weighting formula note"); } });
  tool({ name: "get_oae_info", description: "Get the OAE (Other Academic Exercises) / additional exercises for CS admission if any. Use for 'is there an interview / OAE / additional exercise for CS'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("OAE", ["01_jupas-basics", "05_programmes"], 2); if (!n.length) n = topicNotes("additional exercise", null, 2); return packNotes(n, "OAE note"); } });
  tool({ name: "get_application_fee", description: "Get the non-JUPAS / direct-application fee (e.g. HK$200 per programme) and whether JUPAS charges an application fee. Use for 'how much does it cost to apply / application fee'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("application fee", ["03_nonjupas", "01_jupas-basics"], 2); if (!n.length) n = topicNotes("HK$200", null, 2); return packNotes(n, "application fee note"); } });
  tool({ name: "get_jupas_choices", description: "Explain JUPAS choices: how many choices you can enter, how to order them, and how to update them before/after results. Use for 'how many choices can I put / how do I fill in my JUPAS choices'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("choices", ["01_jupas-basics"], 2); if (!n.length) n = topicNotes("update choices", null, 2); return packNotes(n, "JUPAS choices note"); } });
  tool({ name: "get_admission_rounds", description: "Explain the JUPAS rounds: Main Round vs Supplementary Round, when each offers, and what happens if you miss Main Round. Use for 'what is the Main Round / Supplementary Round / if I don't get in Main Round'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("Main Round", ["01_jupas-basics", "02_jupas-scores"], 2); if (!n.length) n = topicNotes("Supplementary Round", null, 2); return packNotes(n, "admission rounds note"); } });
  tool({ name: "get_hkdse_best5", description: "Explain the 'Best 5 subjects' rule for CityU CS's JUPAS score: which 5 count, how DSE grades map to points, and the weighting. Use for 'how are my 5 subjects chosen / best 5 rule'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var e = findCodeScoreNote("JS1204", "07_cityu-scores"); if (e) { var s = scoreFromNote(e); return { ok: true, formula: s.formula, note: s.short_answer, note_id: knowledgeIndex.indexOf(e) }; } var n = topicNotes("Best 5", ["01_jupas-basics", "02_jupas-scores"], 2); return packNotes(n, "best-5 rule note"); } });
  tool({ name: "get_deferred_admission", description: "Explain deferring an offer / deferring entry (starting later than the offer year) and any conditions. Use for 'can I defer my offer / start a year later'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("defer", null, 2); if (!n.length) n = topicNotes("deferred", null, 2); return packNotes(n, "deferral note"); } });
  tool({ name: "get_graduation_requirements", description: "Get the graduation requirements for the CS degree (total credits, core + elective split, any requirements per stream). Use for 'how many credits to graduate / what do I need to complete the degree'.", parameters: { type: "object", properties: { code: codeParam() }, required: [] }, fn: function (a) { var n = topicNotes("graduation", ["04_curriculum", "05_programmes"], 2); if (!n.length) n = topicNotes("credits", ["04_curriculum"], 2); return packNotes(n, "graduation requirement note"); } });
  tool({ name: "get_course_units", description: "Get the credit units / workload for a specific CS course. Use for 'how many credits is CS2505 / what's the workload'.", parameters: { type: "object", properties: { code: strParam("Course code, e.g. CS2505"), name: strParam("Or course title") }, required: [] }, fn: function (a) { var e = findCourse(a.code, a.name); if (!e) return { ok: false, error: "No course found. Use get_course_info or list_courses first." }; var m = (e.text).match(/(\d)\s*(?:credits|units)/i); return { ok: true, id: knowledgeIndex.indexOf(e), code: courseCodeOf(e.title), title: e.title, units: m ? parseInt(m[1], 10) : null, short_answer: shortAnswer(e), more: "read_note(id) for the full course FAQ." }; } });
  tool({ name: "get_medium_of_instruction", description: "Get the language(s) of instruction for CityUHK CS courses (English; any bilingual options). Use for 'is it taught in English / language of instruction'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("language of instruction", null, 2); if (!n.length) n = topicNotes("bilingual", null, 2); return packNotes(n, "medium of instruction note"); } });
  tool({ name: "get_cs_department", description: "Get an overview of the CityUHK Department of Computer Science (faculty, size, facilities, college it sits in). Use for 'tell me about the CS department / college of computing'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("Department of Computer Science", ["00_vault-map", "05_programmes"], 3); if (!n.length) n = topicNotes("department", null, 3); return packNotes(n, "department note"); } });
  tool({ name: "list_all_notes", description: "List ALL note titles in the vault (paginated by limit). Use to answer 'what can this assistant tell me about / what topics exist' or to find a note when other searches fail.", parameters: { type: "object", properties: { limit: limitParam(), offset: intParam("Start position (for paging, default 0)") }, required: [] }, fn: function (a) { var lim = Math.max(1, Math.min(parseInt(a.limit, 10) || 30, 100)); var off = Math.max(0, parseInt(a.offset, 10) || 0); var out = []; for (var i = off; i < (knowledgeIndex || []).length && out.length < lim; i++) { var e = knowledgeIndex[i]; out.push({ id: i, title: e.title, folder: e.folder }); } return { ok: true, total: (knowledgeIndex || []).length, count: out.length, offset: off, notes: out }; } });
  tool({ name: "get_related_notes", description: "Get notes related to the CURRENT page (or a given topic): same programme code, folder neighbours, and shared keywords. Use for 'what else should I read / related topics to this page'.", parameters: { type: "object", properties: { topic: strParam("Optional topic/code to relate to; default = current page"), limit: limitParam() }, required: [] }, fn: function (a) { var topic = normStr(a.topic); if (!topic) { var art = (typeof document !== "undefined" && document.querySelector("article")); topic = (document.title || ""); } if (!topic) return { ok: false, error: "No topic given and no current page." }; var tl = topic.toLowerCase(); var out = []; for (var i = 0; i < (knowledgeIndex || []).length && out.length < 8; i++) { var e = knowledgeIndex[i]; if (e.title.toLowerCase() === tl) continue; var score = 0; var words = tl.split(/\s+/).filter(function (w) { return w.length > 3; }); for (var w = 0; w < words.length; w++) { if (e.title.toLowerCase().indexOf(words[w]) >= 0) score += 3; if ((e.text || "").toLowerCase().indexOf(words[w]) >= 0) score += 1; } if (score >= 2) out.push({ id: i, slug: e.slug, title: e.title, folder: e.folder, score: score }); } out.sort(function (x, y) { return y.score - x.score; }); return { ok: true, count: out.length, related: out.slice(0, parseInt(a.limit, 10) || 6) }; } });
  tool({ name: "get_contact_info", description: "Get contact details / links for the CS department or admissions office (where to email/call). Use for 'who do I contact / where do I ask / contact the department'.", parameters: { type: "object", properties: {}, required: [] }, fn: function () { var n = topicNotes("contact", null, 3); if (!n.length) n = topicNotes("admissions office", null, 3); return packNotes(n, "contact note"); } });

  function findTopic(kw, a) {
    var code = normStr(a && a.code).toUpperCase(), name = normStr(a && a.name).toLowerCase();
    var list = topicNotes(kw, ["05_programmes", "00_vault-map"], 4);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (code && e.title.toUpperCase().indexOf(code) >= 0) return e;
      if (name && e.title.toLowerCase().indexOf(name) >= 0) return e;
    }
    return list[0] || null;
  }
  function packNote(e, chars) {
    return { ok: true, id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, chars || 1000), more: "read_note(id) for the full text." };
  }
  function packNotes(notes, label) {
    if (!notes || !notes.length) return { ok: false, error: "No " + label + " found. Try search_notes." };
    return { ok: true, count: notes.length, notes: notes.map(function (e) { return { id: knowledgeIndex.indexOf(e), slug: e.slug, title: e.title, short_answer: shortAnswer(e), summary: e.text.slice(0, 800) }; }) };
  }

  // ------------------------------------------------------------------
  // PYTHON cluster — Pyodide (CPython compiled to WebAssembly) so the
  // agent can compute over the FAQ data (or anything) with real Python.
  // The current knowledge index is exposed to Python as `knowledge`
  // (a list of dicts: slug, title, folder, text). Built-in packages
  // (numpy, pandas, matplotlib, scipy, sympy, ...) load via loadPackage;
  // anything else via micropip. First use downloads the runtime (~10MB)
  // once; afterwards it is cached in the browser.
  // ------------------------------------------------------------------
  var PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs";
  var pyodideState = { mod: null, inst: null, loading: null, ready: false, err: null };

  function pyLoadPackage(pyodide, name) {
    return pyodide.loadPackage(name).then(
      function () { return { pkg: name, ok: true, via: "built-in" }; },
      function () {
        // Not a built-in Pyodide package -> try micropip (PyPI).
        return pyodide.loadPackage("micropip").then(function () {
          return pyodide.runPythonAsync("import micropip; await micropip.install('" + String(name).replace(/'/g, "") + "')");
        }).then(function () { return { pkg: name, ok: true, via: "micropip" }; });
      }
    );
  }

  async function ensurePyodide() {
    if (pyodideState.ready) return pyodideState.inst;
    if (pyodideState.err) throw new Error(pyodideState.err);
    if (pyodideState.loading) return pyodideState.loading;
    pyodideState.loading = (async function () {
      try {
        if (!pyodideState.mod) {
          pyodideState.mod = await import(PYODIDE_URL);
        }
        var pyodide = await pyodideState.mod.loadPyodide({
          indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/"
        });
        pyodideState.inst = pyodide;
        pyodideState.ready = true;
        return pyodide;
      } catch (e) {
        pyodideState.err = "Pyodide failed to load: " + (e && e.message ? e.message : e);
        pyodideState.loading = null;
        throw new Error(pyodideState.err);
      }
    })();
    return pyodideState.loading;
  }

  tool({
    name: "run_python",
    description: "Run Python code (via Pyodide/WebAssembly, in the browser) to compute or extract anything from the FAQ data or do math. The current knowledge index is available as `knowledge` — a list of dicts with keys slug, title, folder, text. Built-in packages numpy/pandas/matplotlib/scipy/sympy are preinstalled on demand; pass `packages` to load more (e.g. 'pandas', 'qrcode'). Print your answer with print(). Use this for aggregations, comparisons, rankings, score math, or any analysis the other tools can't express. You can also GENERATE IMAGES (e.g. QR codes with the 'qrcode' package, charts with matplotlib): encode them as a base64 PNG and print `data:image/png;base64,....` — the chat renders it inline as a picture. The code must not try to use the network or filesystem.",
    parameters: {
      type: "object",
      properties: {
        code: strParam("Python code to run. `knowledge` holds the FAQ notes. End with print() of the result you want."),
        packages: strArrParam("Optional extra Python packages to install first, e.g. ['pandas']")
      },
      required: ["code"]
    },
    fn: async function (a, ctx) {
      var code = String((a && a.code) || "").trim();
      if (!code) return { ok: false, error: "code is required" };
      var pkgs = normList(a && a.packages);
      var t0 = Date.now();
      var pyodide;
      try {
        pyodide = await ensurePyodide();
      } catch (e) {
        return { ok: false, error: String(e.message || e), hint: "Pyodide needs a network fetch on first use; check connectivity and retry." };
      }
      try {
        for (var i = 0; i < pkgs.length; i++) {
          var r = await pyLoadPackage(pyodide, pkgs[i]);
          if (!r.ok) return { ok: false, error: "Failed to install package " + pkgs[i] };
        }
        // Inject the knowledge index as a REAL Python list of dicts (toPy
        // converts the JS array, so Python can subscript/iterate it normally).
        var data = (knowledgeIndex || []).map(function (e) {
          return { slug: e.slug, title: e.title, folder: e.folder, text: (e.text || "").slice(0, 1200) };
        });
        var n = (knowledgeIndex || []).length;
        var pyKnowledge = null;
        try { pyKnowledge = pyodide.toPy(data); }
        catch (e) { pyKnowledge = data; }
        pyodide.globals.set("knowledge", pyKnowledge);
        pyodide.globals.set("knowledge_count", n);
        // Capture stdout.
        var out = "";
        pyodide.setStdout({ batched: function (s) { out += s + "\n"; } });
        var ret = null;
        try {
          ret = await pyodide.runPythonAsync(code);
        } catch (pe) {
          return { ok: false, error: "Python error: " + String(pe.message || pe), stdout: out.slice(0, 4000) };
        }
        var retStr = "";
        try { retStr = (ret != null) ? String(ret) : ""; } catch (e) { retStr = ""; }
        if (retStr && !out) out = retStr;
        return {
          ok: true,
          stdout: out.slice(0, 6000),
          truncated: out.length > 6000,
          notes_available: n,
          ms: Date.now() - t0
        };
      } catch (e) {
        return { ok: false, error: "Python run failed: " + (e && e.message ? e.message : e) };
      }
    }
  });

  tool({
    name: "python_packages_available",
    description: "List the Python packages already available to run_python without extra install (Pyodide built-ins) and note that anything else can be pip-installed on demand. Use to decide whether to pass `packages` to run_python.",
    parameters: { type: "object", properties: {}, required: [] },
    fn: function () {
      return {
        ok: true,
        builtin: ["numpy", "pandas", "matplotlib", "scipy", "sympy", "Pillow", "requests", "sqlite3", "lxml"],
        note: "These are Pyodide's bundled packages (loaded on first use). Any other PyPI package can be installed at runtime by passing it in run_python's `packages` (via micropip) — e.g. ['scikit-learn', 'beautifulsoup4']. Pure-Python packages work best; some compiled ones may not have a Pyodide build."
      };
    }
  });

