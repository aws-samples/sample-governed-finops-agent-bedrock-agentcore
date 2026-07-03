#!/bin/bash

echo "=== Scanning for Internal Amazon References ==="

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

FINDINGS=0

# Patterns to search for
PATTERNS=(
    "a2z"
    "isengard"
    "corp\.amazon\.com"
    "[0-9]{12}\.amazon\.com"
    "amzn-internal"
)

# File types to scan
FILE_TYPES="-name '*.py' -o -name '*.ts' -o -name '*.js' -o -name '*.md' -o -name '*.yaml' -o -name '*.yml' -o -name '*.json' -o -name '*.sh'"

for pattern in "${PATTERNS[@]}"; do
    echo ""
    echo "Searching for: $pattern"
    
    # Use grep with line numbers, case-insensitive, excluding common non-source directories
    RESULTS=$(find . -type f \( $FILE_TYPES \) \
        -not -path "./node_modules/*" \
        -not -path "./.git/*" \
        -not -path "./cdk.out/*" \
        -not -path "./.pytest_cache/*" \
        -not -path "./.ruff_cache/*" \
        -not -path "./frontend/node_modules/*" \
        -not -path "./frontend/dist/*" \
        -exec grep -Hn -i "$pattern" {} \; 2>/dev/null)
    
    if [ -n "$RESULTS" ]; then
        echo "⚠ FOUND:"
        echo "$RESULTS"
        FINDINGS=$((FINDINGS + 1))
    else
        echo "✓ No matches found"
    fi
done

echo ""
echo "=== Scan Complete ==="
if [ $FINDINGS -eq 0 ]; then
    echo "✓ No internal references detected"
    exit 0
else
    echo "⚠ $FINDINGS pattern(s) found matches"
    echo "Review and remove internal references before publication"
    exit 1
fi
