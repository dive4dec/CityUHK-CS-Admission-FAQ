/**
 * heading-ids — local Quartz plugin: turn `{#id}` markers at the end of a
 * heading into a real, short, stable `id` and remove the marker text — from
 * BOTH the rendered heading and the sidebar Table of Contents.
 *
 * Why: the admission cover page uses `## Q2 — ... {#q2}` so each section has a
 * short, stable anchor (#q2) the note "back to cover page" links point at.
 * This Quartz build otherwise (a) renders `{#...}` as literal text in the
 * heading AND the TOC, and (b) gives both a long auto-slug of the whole
 * heading (marker included). The two long slugs differ from each other, and
 * neither is the clean `#q2` the back-links want.
 *
 * How it works (mdast level, running AFTER the TOC plugin):
 *   1. Rewrite `file.data.toc` in place: for each entry whose text ends in
 *      `{#id}`, set `slug` = id and strip the marker from `text`. The TOC
 *      component renders directly from these entries, so its links and labels
 *      become the clean short anchors.
 *   2. Walk the headings: strip the marker from the heading's text and record
 *      the id on `node.data.hProperties.id`. `remark-rehype` copies that onto
 *      the element's `properties.id`; GFM's heading-id pass (rehype-slug) only
 *      assigns an id when none is present, so it skips these headings and the
 *      short id wins on the actual <h2>.
 *
 * Order 51: AFTER table-of-contents (50, which captures heading text + builds
 * `file.data.toc`) and AFTER github-flavored-markdown (40, whose rehype-slug
 * would otherwise assign the long auto id). The TOC already ran, so its
 * `entry.text` still carries the marker for us to match.
 *
 * Imported by the config loader (plain Node ESM): no TS/scss, no
 * extensionless relative imports. `unist-util-visit` is a Quartz dep already
 * resolvable from this directory.
 */
import { visit } from "unist-util-visit"

const MARKER = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/

export default function HeadingIds(_opts) {
  return {
    name: "HeadingIds",
    markdownPlugins() {
      return [
        () => (tree, file) => {
          // 1. Clean the TOC the component is about to render.
          const toc = file && file.data && file.data.toc
          if (Array.isArray(toc)) {
            for (const entry of toc) {
              if (entry && typeof entry.text === "string") {
                const m = entry.text.match(MARKER)
                if (m) {
                  entry.slug = m[1]
                  entry.text = entry.text
                    .slice(0, m.index)
                    .replace(/\s+$/, "")
                }
              }
            }
          }

          // 2. Clean the headings themselves + set the explicit id.
          visit(tree, "heading", (node) => {
            const children = node.children || []
            for (let i = children.length - 1; i >= 0; i--) {
              const c = children[i]
              if (c.type === "text" && typeof c.value === "string") {
                const m = c.value.match(MARKER)
                if (!m) return
                const id = m[1]
                const before = c.value.slice(0, m.index).replace(/\s+$/, "")
                if (before === "") children.splice(i, 1)
                else c.value = before
                node.data = node.data || {}
                node.data.hProperties = Object.assign({}, node.data.hProperties, { id })
                return
              }
              // A non-text trailing node means the marker is not a plain
              // trailing text child; leave this heading untouched.
              if (i === children.length - 1) return
            }
          })
        },
      ]
    },
  }
}
