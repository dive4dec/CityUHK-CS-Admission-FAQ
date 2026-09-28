/**
 * ai-chat — local Quartz plugin for the CityUHK CS Admission FAQ site.
 *
 * Two parts, one plugin package:
 *  1. KnowledgeIndex emitter — at build time, writes static/knowledge-index.json
 *     (slug, title, folder, trimmed note text) used by the client widget for
 *     keyword RAG retrieval.
 *  2. AIChat component — a floating chat widget. The model runs fully in the
 *     browser via WebLLM (WebGPU). The widget's CSS is the `css` string and its
 *     client script is the `afterDOMLoaded` string; both are read from this
 *     plugin directory at build time, so there is nothing to compile at runtime.
 *
 * This file is imported at build time by the Quartz config loader (plain Node
 * ESM), so it must be self-contained: no TS, no scss, no extensionless
 * relative imports.
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "node:url"

const pluginDir = path.dirname(fileURLToPath(import.meta.url))

// Client-side widget styles (plain CSS; read at build time).
const widgetCSS = fs.readFileSync(path.join(pluginDir, "styles.css"), "utf8")

// Client-side widget script. Must be a plain top-level script (no import/export)
// so it works both as an ES module (production: emitted as an individual
// static/scripts/script-N-hash.js) and wrapped in an IIFE (serve mode: joined
// into the monolithic postscript bundle).
//
// tools.js (the 50+ tool registry + Pyodide run_python) is PREPENDED and the
// two files are wrapped in a SINGLE IIFE so they share one scope: tools.js
// reads knowledgeIndex / BASE which are declared in chat.js. chat.js is
// authored WITHOUT its own wrapper (see its header note), so this single
// IIFE is the only one.
const toolsScript = fs.readFileSync(path.join(pluginDir, "tools.js"), "utf8")
const chatScript = fs.readFileSync(path.join(pluginDir, "chat.js"), "utf8")
const widgetScript =
  '(function () {\n  "use strict";\n\n' +
  toolsScript +
  "\n" +
  chatScript +
  "\n})()\n"

// --- Minimal ports of quartz helpers (this file runs under plain Node, so it
// --- cannot reach into the Quartz TypeScript source tree).
function joinSegments(...segs) {
  return segs
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/")
}

async function write(opts) {
  const out = path.join(opts.ctx.argv.output, joinSegments(opts.slug + opts.ext))
  await fs.promises.mkdir(path.dirname(out), { recursive: true })
  await fs.promises.writeFile(out, opts.content)
  return out
}

// ---------------------------------------------------------------------------
// 1. KnowledgeIndex emitter
// ---------------------------------------------------------------------------
const MAX_TEXT_LENGTH = 1800
const MIN_TEXT_LENGTH = 20

export const KnowledgeIndex = (opts) => {
  // The same plugin also provides a component; when the config loader
  // instantiates it with role: "component" return the component instead.
  if (opts && opts.role === "component") return AIChat

  return {
    name: "KnowledgeIndex",
    async *emit(ctx, content) {
      const entries = []
      const seen = new Set()

      for (const [_tree, vfile] of content) {
        const slug = vfile.data?.slug ?? ""
        if (!slug || seen.has(slug)) continue
        // Assets and non-markdown virtual pages are not useful for RAG.
        if (slug.startsWith("assets/") || /\.(canvas|bases)$/.test(slug)) continue

        const frontmatter = vfile.data?.frontmatter ?? {}
        const title =
          (typeof frontmatter.title === "string" && frontmatter.title) ||
          slug.split("/").pop() ||
          slug
        const folder = slug.includes("/") ? slug.split("/").slice(0, -1).join("/") : ""

        // vfile.value holds the markdown source at emit time.
        let text =
          typeof vfile.value === "string"
            ? vfile.value
            : vfile.value != null
              ? String(vfile.value)
              : ""
        // Strip the frontmatter block and the H1 (duplicates frontmatter title).
        text = text.replace(/^---[\s\S]*?---/, "").replace(/^#\s+.*$/m, "").trim()

        if (text.length < MIN_TEXT_LENGTH) continue
        if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH)

        seen.add(slug)
        entries.push({ slug, title, folder, text })
      }

      yield write({
        ctx,
        slug: "static/knowledge-index.json",
        ext: "",
        content: JSON.stringify(entries),
      })
    },
    async *partialEmit() {},
  }
}

// ---------------------------------------------------------------------------
// 2. AIChat component
// ---------------------------------------------------------------------------
// Pre-built QuartzComponent instance (not a constructor): renders nothing on
// the server side; all UI is created client-side by the afterDOMLoaded script,
// which mounts into <html> directly so the SPA router (which morphs
// document.body on every navigation) never destroys the widget.
const AIChat = () => null
AIChat.displayName = "AIChat"
AIChat.css = widgetCSS
AIChat.afterDOMLoaded = widgetScript

export { AIChat }
