#!/usr/bin/env bash
# UI/UX rule audit for Next.js projects.
# Usage: bash scripts/ui-audit.sh [src_dir]
# Exits 1 when any rule is violated. Heuristic grep checks: each hit must be reviewed,
# and genuine exceptions should be documented in src/design-system/README.md.

set -u
SRC="${1:-src}"
violations=0

if [ ! -d "$SRC" ]; then
  echo "ui-audit: directory '$SRC' not found" >&2
  exit 2
fi

scan() {
  # $1 = rule title, $2 = PCRE pattern, $3 = "components" to limit to TSX/JSX (token files excluded)
  local title="$1" pattern="$2" scope="${3:-all}"
  local hits
  if [ "$scope" = "components" ]; then
    hits=$(grep -RInP --include='*.tsx' --include='*.jsx' -e "$pattern" "$SRC" 2>/dev/null || true)
  else
    hits=$(grep -RInP --include='*.tsx' --include='*.jsx' --include='*.ts' --include='*.css' \
           -e "$pattern" "$SRC" 2>/dev/null || true)
  fi
  if [ -n "$hits" ]; then
    echo "FAIL: $title"
    echo "$hits" | sed 's/^/    /'
    echo
    violations=$((violations + 1))
  fi
}

echo "UI audit of: $SRC"
echo

# 1. No mock or fake data in shipped UI
scan "Mock or placeholder data (remove, use real data layer)" \
  'lorem ipsum|John Doe|Jane Doe|mockData|MOCK_|fakeData|dummyData|sampleData|example\.com/avatar'

# 2. Native, unstyled controls
scan "Native <select> (use the styled Select)" '<select[\s>]'
scan "Native checkbox or radio (use the styled Checkbox/RadioGroup)" '<input[^>]*type=["'\'']?(checkbox|radio)'
scan "Native browser dialogs (use the designed Dialog)" '\b(window\.)?(alert|confirm|prompt)\('

# 3. Tooltips and labels
scan "title attribute used as tooltip (use the Tooltip component)" '\stitle=["'\''{]'
scan "Icon-only button without aria-label" '<button(?![^>]*aria-label)[^>]*>\s*<[A-Z][A-Za-z0-9]*[^>]*/>\s*</button>'

# 4. Colors and tokens
scan "Hardcoded hex color in component (use semantic tokens)" \
  '(?<![\w-])#[0-9a-fA-F]{3,8}\b' components
scan "Inline style with color or background (use tokens)" 'style=\{\{[^}]*(color|background)'

# 5. Layout and overflow
scan "Global horizontal overflow hidden (hides real defects)" 'overflow-x-hidden|overflow-x:\s*hidden'
scan "100vh instead of dvh (overshoots on mobile)" 'min-h-screen|h-screen|100vh'
scan "Tailwind arbitrary width/height in pixels on content containers (review responsiveness)" \
  'w-\[[0-9]+px\]|max-w-\[[0-9]+px\]'

# 6. Motion and performance
scan "transition-all (animate only the properties you need)" '\btransition-all\b'
scan "Animating layout properties (use transform/opacity)" 'transition-\[(width|height|top|left)'

# 7. Scrollbars
if ! grep -RIlq --include='*.css' 'scrollbar' "$SRC" 2>/dev/null; then
  echo "FAIL: No custom scrollbar styles found (define scrollbar tokens in globals.css)"
  echo
  violations=$((violations + 1))
fi

# 8. Theme support
if ! grep -RIlq --include='*.css' '\.dark' "$SRC" 2>/dev/null; then
  echo "FAIL: No dark theme tokens found (.dark block missing in globals.css)"
  echo
  violations=$((violations + 1))
fi

# 9. Product tours
if ! grep -RIlq 'data-tour=' "$SRC" 2>/dev/null; then
  echo "WARN: No data-tour anchors found. Add product tours for main feature areas (see product-tour.md)."
  echo
fi

# 10. Inputs without placeholder (heuristic: inputs that lack placeholder on the same line)
hits=$(grep -RInP --include='*.tsx' '<(input|textarea)\b(?![^>]*placeholder)(?![^>]*type=["'\'']?(hidden|checkbox|radio|submit|file)["'\''])[^>]*/?>' "$SRC" 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "FAIL: Input or textarea without a placeholder hint (single-line heuristic, multi-line tags may need manual review)"
  echo "$hits" | sed 's/^/    /'
  echo
  violations=$((violations + 1))
fi

echo "----------------------------------------"
if [ "$violations" -eq 0 ]; then
  echo "PASS: no UI rule violations detected by heuristics."
  echo "Still run the device matrix, both themes, keyboard-only, and reduced-motion checks."
  exit 0
else
  echo "FAILED: $violations rule group(s) flagged. Fix or document each exception."
  exit 1
fi
