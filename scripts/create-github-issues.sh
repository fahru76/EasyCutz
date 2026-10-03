#!/usr/bin/env bash
# Creates GitHub issues from .github/backlog/*.md (front matter: title, labels).
# Requirements: GitHub CLI (`gh auth login`) and the repo pushed to GitHub.
# Usage (Git Bash / macOS / Linux):  bash scripts/create-github-issues.sh [--dry-run]
# Safe to re-run: issues whose title already exists are skipped.
set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true
cd "$(dirname "$0")/.."

$DRY_RUN || command -v gh >/dev/null || { echo "GitHub CLI 'gh' not found: https://cli.github.com"; exit 1; }
$DRY_RUN || gh auth status >/dev/null || { echo "Run: gh auth login"; exit 1; }

existing="$($DRY_RUN && echo "" || gh issue list --state all --limit 500 --json title --jq '.[].title')"

for file in .github/backlog/EZ-*.md; do
  title="$(sed -n 's/^title: *"\{0,1\}\(.*[^"]\)"\{0,1\} *$/\1/p' "$file" | head -1)"
  labels="$(sed -n 's/^labels: *//p' "$file" | head -1 | tr -d ' ')"
  body="$(awk 'BEGIN{n=0} /^---$/{n++; next} n>=2' "$file")"

  if grep -Fxq "$title" <<<"$existing"; then
    echo "skip (exists): $title"; continue
  fi

  if $DRY_RUN; then
    echo "would create: $title  [labels: $labels]"; continue
  fi

  IFS=',' read -ra label_list <<<"$labels"
  for label in "${label_list[@]}"; do
    gh label create "$label" --force >/dev/null 2>&1 || true
  done
  gh issue create --title "$title" --label "$labels" --body "$body (source: \`$file\`)"
done
