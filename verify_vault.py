#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vault integrity gate: dangling [[wikilinks]] + split GFM tables.

Exit 0 when the vault is clean, 1 otherwise. Run: python3 verify_vault.py
(from the vault root) or `make verify`.
"""
import re, sys, pathlib

def main():
    root = pathlib.Path(".")
    vault = [d for d in root.iterdir() if d.is_dir() and d.name not in (".site", ".obsidian", ".git")]
    stems = set()
    for d in vault:
        for p in d.rglob("*.md"):
            stems.add(p.stem)
    if (root / "index.md").exists():
        stems.add("index")

    def resolve(target):
        t = target.split("|")[0].split("#")[0].strip()
        return t in stems or t.replace("/", "") in stems

    dangling = badtable = files = 0
    mdfiles = []
    if (root / "index.md").exists():
        mdfiles.append(root / "index.md")
    for d in vault:
        mdfiles.extend(p for p in d.rglob("*.md"))
    for f in mdfiles:
        files += 1
        text = f.read_text(encoding="utf-8")
        for m in re.findall(r"\[\[([^\]]+)\]\]", text):
            if not resolve(m):
                dangling += 1
                print("  DANGLE %s: [[%s]]" % (f, m))
        lines = text.splitlines()
        # a blank line BETWEEN two row lines splits a GFM table
        for i in range(len(lines) - 2):
            if (lines[i].lstrip().startswith("|")
                    and lines[i + 1].strip() == ""
                    and lines[i + 2].lstrip().startswith("|")):
                badtable += 1
                print("  SPLIT TABLE %s:%d (blank line between rows)" % (f, i + 1))
    print("VERIFY: dangling=%d badtable=%d files=%d" % (dangling, badtable, files))
    return 1 if (dangling or badtable) else 0

if __name__ == "__main__":
    sys.exit(main())
