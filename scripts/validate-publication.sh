#!/bin/bash

echo "=== AWS Samples Publication Validation ==="
echo ""

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PASSED=0
FAILED=0

# Function to check file exists and is not empty
check_file() {
    local file=$1
    local description=$2
    
    if [ -f "$file" ] && [ -s "$file" ]; then
        echo "✓ $description"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo "✗ $description"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

# Function to check README sections
check_readme_section() {
    local section=$1
    
    if grep -q "## $section" README.md; then
        echo "✓ README contains '$section' section"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo "✗ README missing '$section' section"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

echo "1. Mandatory Files"
check_file "CODE_OF_CONDUCT.md" "CODE_OF_CONDUCT.md exists"
check_file "CONTRIBUTING.md" "CONTRIBUTING.md exists"
check_file "LICENSE" "LICENSE exists"
check_file "README.md" "README.md exists"
check_file "NOTICE" "NOTICE exists"

echo ""
echo "2. README Structure"
check_readme_section "Prerequisites"
check_readme_section "Installation"
check_readme_section "Deployment"
check_readme_section "Usage"
check_readme_section "Security"
check_readme_section "License"

echo ""
echo "3. Git-Secrets Configuration"
if [ -f ".git/hooks/pre-commit" ] && grep -q "git secrets" ".git/hooks/pre-commit"; then
    echo "✓ Git-secrets pre-commit hook installed"
    PASSED=$((PASSED + 1))
else
    echo "✗ Git-secrets not configured"
    FAILED=$((FAILED + 1))
fi

echo ""
echo "4. Security Scans"
echo "Running credential scan..."
if git secrets --scan 2>&1; then
    echo "✓ No credentials detected"
    PASSED=$((PASSED + 1))
else
    echo "⚠ Credential scan found issues"
    FAILED=$((FAILED + 1))
fi

echo ""
echo "=== Validation Summary ==="
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "✓ Repository is ready for publication"
    exit 0
else
    echo "⚠ Repository requires fixes before publication"
    exit 1
fi
