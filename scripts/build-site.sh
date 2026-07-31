#!/usr/bin/env bash
# Packages the static game into a directory for GitHub Pages.
# The script list is read out of index.html so a newly added script can never be
# left behind by a hand-maintained copy list.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/_site}"

mkdir -p "$out"
cp "$root/index.html" "$out/"

grep -o 'src="[^"]*"' "$root/index.html" | cut -d'"' -f2 | while read -r src; do
  if [ ! -f "$root/$src" ]; then
    echo "build-site: index.html references missing file $src" >&2
    exit 1
  fi
  mkdir -p "$out/$(dirname "$src")"
  cp "$root/$src" "$out/$src"
done
