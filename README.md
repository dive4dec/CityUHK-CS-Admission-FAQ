# CityUHK CS Admission FAQ

Interlinked Obsidian FAQ vault for **City University of Hong Kong (CityUHK) — Department of Computer Science / College of Computing** undergraduate admission. Built for parents and students applying through **JUPAS** and **non-JUPAS** (Year 1 / Advanced Standing I & II / IB / GCE A-Level).

- **1,033 notes** across 12 topic areas, all cross-linked with `[[wikilinks]]`
- JUPAS score formulas, the **1.5× weighting policy**, published score history (2023–2026), worked examples
- Non-JUPAS routes, programme overviews (BSc CS `JS1204`, BSc Cybersecurity `JS1218`, double degree `JS1221`, ACT, Data Science), curriculum and the mandatory **ITPP internship**
- Cross-university comparisons (HKU / CUHK / HKUST / PolyU) and a 334-profile "what's my score?" lookup

## Read Online (GitHub Pages)

A read-only preview with full-text search, graph view, and folder explorer is available via GitHub Pages:

> **[https://dive4dec.github.io/CityUHK-CS-Admission-FAQ/](https://dive4dec.github.io/CityUHK-CS-Admission-FAQ/)**

## Deploy / Update the Site

```bash
# One-time: install Quartz dependencies (node >= 22, npm >= 10.9.2)
make site-init

# Build and preview locally at http://localhost:8080
make site-serve

# Build and deploy to GitHub Pages (gh-pages branch)
make site-deploy
```

After the first deploy, enable GitHub Pages in the repo:

1. Go to **Repo Settings → Pages**
2. **Source:** Deploy from branch
3. **Branch:** `gh-pages` / `(root)`
4. Save

> Note: the static site is rebuilt from the `.md` notes, so after editing notes just re-run `make site-deploy`.

## Read / Write Locally with Obsidian

1. `git clone git@github.com:dive4dec/CityUHK-CS-Admission-FAQ.git`
2. Open Obsidian → **Open folder as vault** → select `CityUHK-CS-Admission-FAQ/`
3. `.obsidian/` shared config is included; personal state (`workspace.json`, `graph.json`) is gitignored so pulls never conflict.

## Repository Structure

```
CityUHK-CS-Admission-FAQ/
├── 00_Vault-Map/       # index, code cheat-sheet, key facts
├── 01_JUPAS-Basics/    # formulas, conversion, bands, dates, 1.5x policy
├── 02_JUPAS-Scores/    # score history, worked examples, competitiveness
├── 03_NonJUPAS/        # Year 1 / ASI / ASII, IB, GCE A-Level
├── 04_Curriculum/      # streams, cybersecurity, ITPP internship
├── 05_Programmes/      # programme overviews, double degree
├── 06_Courses/         # one note per CS course (91)
├── 07_CityU-Scores/    # per programme per year 2023-2026 (222)
├── 08_Rival-Scores/    # HKU/HKUST/PolyU 2023-2025 (307)
├── 09_Score-Lookup/    # "my grades are X -> score + verdict" (334)
├── 10_Compare/         # cross-university comparisons
├── 11_Misc/            # tuition fees
├── index.md            # home page (site entry)
├── .obsidian/          # shared Obsidian config
├── .site/              # Quartz static site generator (GitHub Pages)
├── Makefile            # site-init / site-build / site-serve / site-deploy
└── .gitignore
```

## Important caveat

Published admission scores are **reference points, not cut-offs**, and are not comparable across programmes or years. The **1.5× weighting** for CS-relevant subjects is promoted by the CS admissions team but **may or may not be reflected** in the published formula for a given cycle — always confirm the current year's official formula on [admission.cs.cityu.edu.hk](https://admission.cs.cityu.edu.hk/) before applying.

## License

MIT
