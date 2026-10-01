/**
 * note-dates — local Quartz plugin: stamp valid `created`/`modified` dates
 * into note frontmatter at build time (in-memory; the .md files are NOT
 * rewritten).
 *
 * Why: on filesystems that do not report birth times (e.g. some overlay/tmpfs
 * mounts: `stat` shows `Birth: -`, `fs.statSync().birthtimeMs === 0`), the
 * community CreatedModifiedDate plugin's `created` fallback is
 * `new Date(birthtimeMs)` = `new Date(0)` (invalid), so it logs
 * `Warning: found invalid date "0"` for EVERY note. Untracked new notes also
 * trigger `isn't yet tracked by git, dates will be inaccurate` warnings.
 *
 * How: runs as an early markdown transformer. It MUST be ordered after the
 * frontmatter parser (@quartz-community/note-properties, defaultOrder 5, which
 * sets file.data.frontmatter) and BEFORE created-modified-date (order 10).
 * Order 7 satisfies both. It sets frontmatter.created / frontmatter.modified
 * for any note lacking them:
 *   - modified = the file's latest git commit date (when tracked), else mtime
 *   - created  = mtime (birth time is 0 on this filesystem; mtime is the
 *     closest valid proxy)
 * CreatedModifiedDate is frontmatter-first, so these values win -> no
 * warnings.
 *
 * Imported by the Quartz config loader (plain Node ESM): keep it
 * dependency-free and self-contained (no TS, no scss).
 */
import fs from "fs"
import path from "path"
import { Repository } from "@napi-rs/simple-git"

const hasDate = (v) => v != null && !isNaN(new Date(v).getTime())
const iso = (d) => new Date(d).toISOString().slice(0, 10)

export default function NoteDates(_opts) {
  return {
    name: "NoteDates",
    markdownPlugins(ctx) {
      // Discover the git repo ONCE (mirrors the community date plugin).
      let repo = undefined
      let workdir = null
      if (ctx && ctx.argv && ctx.argv.directory) {
        try {
          repo = Repository.discover(ctx.argv.directory)
          workdir = repo.workdir()
        } catch {
          repo = undefined
        }
      }
      return [
        () => async (_tree, file) => {
          const fm = file.data && file.data.frontmatter
          const fullFp = file.data && file.data.filePath
          if (!fm || !fullFp) return
          // Leave notes that already carry valid frontmatter dates untouched.
          if (hasDate(fm.created) || hasDate(fm.modified)) return
          let st
          try {
            st = await fs.promises.stat(fullFp)
          } catch {
            return
          }
          let modified = st.mtime
          if (repo) {
            try {
              const rel = path.relative(workdir, fullFp)
              const last = await repo.getFileLatestModifiedDateAsync(rel)
              if (last && !isNaN(last.getTime())) modified = last
            } catch {
              /* untracked: keep mtime */
            }
          }
          fm.created = iso(st.mtime) // birth time is 0 on this filesystem
          fm.modified = iso(modified)
        },
      ]
    },
  }
}
