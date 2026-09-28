# Makefile for CityUHK CS Admission FAQ — Quartz GitHub Pages
#
# Usage:
#   make site-init     # One-time: install Quartz dependencies (needs node >= 22, npm >= 10.9.2)
#   make site-build    # Build static site into .site/public/
#   make site-serve    # Preview locally at http://localhost:8080
#   make site-deploy   # Build + push to gh-pages branch (requires push access to origin)
#   make site-clean    # Remove build output

QUARTZ_DIR := .site
CONTENT_DIR := content
OUTPUT_DIR := $(QUARTZ_DIR)/public
PORT := 8080

# Branch for GitHub Pages
PAGES_BRANCH := gh-pages

.PHONY: site-init site-build site-serve site-deploy site-clean

# One-time setup: install Quartz npm dependencies
site-init:
	cd $(QUARTZ_DIR) && npm install

# Build the static site
site-build:
	cd $(QUARTZ_DIR) && npx quartz build -d $(CONTENT_DIR)

# Serve locally for preview
site-serve:
	cd $(QUARTZ_DIR) && python3 serve.py $(PORT) public

# Deploy to GitHub Pages (gh-pages branch).
# Copies the built site into a throwaway repo that points at the SAME origin,
# then force-pushes it as the gh-pages branch. Needs push access to origin.
site-deploy: site-build
	@echo "Deploying to $(PAGES_BRANCH) branch..."
	@ORIGIN=$$(git remote get-url origin) && \
	 if [ -z "$$ORIGIN" ]; then echo "error: no origin remote. Run: git remote add origin git@github.com:dive4dec/CityUHK-CS-Admission-FAQ.git"; exit 1; fi && \
	 TMP=$$(mktemp -d) && \
	 cp -r $(OUTPUT_DIR) "$$TMP/site" && \
	 cd "$$TMP/site" && \
	 git init -q && \
	 git checkout -b $(PAGES_BRANCH) && \
	 git config user.name "CityUHK-CS-Admission-FAQ Deploy" && \
	 git config user.email "deploy@cityu-cs-admission-faq.local" && \
	 git add -A && \
	 git commit -q -m "Deploy Quartz site $$(date -u '+%Y-%m-%d %H:%M UTC')" && \
	 git remote add origin "$$ORIGIN" && \
	 git push --force -u origin $(PAGES_BRANCH); \
	 STATUS=$$?; cd /; rm -rf "$$TMP"; exit $$STATUS
	@echo ""
	@echo "Deployed to $(PAGES_BRANCH) branch."
	@echo "Enable GitHub Pages: Repo Settings → Pages → Source: Deploy from branch → $(PAGES_BRANCH) / (root)"
	@echo "Site URL: https://dive4dec.github.io/CityUHK-CS-Admission-FAQ/"

# Clean build output
site-clean:
	rm -rf $(OUTPUT_DIR)
