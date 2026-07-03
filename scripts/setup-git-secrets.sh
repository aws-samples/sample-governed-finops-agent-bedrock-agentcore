#!/bin/bash
set -e

echo "=== Git-Secrets Setup for AWS Samples ==="
echo ""

# Check if git-secrets is already installed
if command -v git-secrets &> /dev/null; then
    echo "✓ git-secrets already installed ($(git-secrets --version 2>/dev/null || echo 'version unknown'))"
else
    echo "Installing git-secrets..."
    
    # Clone git-secrets if not already present
    if [ ! -d "/tmp/git-secrets" ]; then
        echo "  Cloning awslabs/git-secrets repository..."
        git clone https://github.com/awslabs/git-secrets.git /tmp/git-secrets
    else
        echo "  Using existing clone at /tmp/git-secrets"
    fi
    
    # Install git-secrets
    cd /tmp/git-secrets
    
    # Check if sudo is needed
    if [ -w "/usr/local/bin" ]; then
        make install
    else
        echo "  Administrator privileges required for installation..."
        sudo make install
    fi
    
    echo "✓ git-secrets installed successfully"
fi

# Navigate to repository root
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"

if [ -z "$REPO_ROOT" ]; then
    echo "✗ Error: Not in a git repository"
    echo "  Please run this script from within the agentcore-cost-optimizer repository"
    exit 1
fi

cd "$REPO_ROOT"
echo "  Repository root: $REPO_ROOT"
echo ""

# Install git hooks
echo "Installing git hooks..."
if [ ! -d ".git/hooks" ]; then
    mkdir -p .git/hooks
    echo "  Created .git/hooks directory"
fi

git secrets --install -f
echo "✓ Git hooks installed (.git/hooks/pre-commit, .git/hooks/commit-msg, .git/hooks/prepare-commit-msg)"
echo ""

# Register AWS patterns
echo "Registering AWS credential patterns..."
git secrets --register-aws
echo "✓ AWS patterns registered (AWS Access Keys, Secret Keys, Account IDs)"
echo ""

# Add custom patterns for additional security
echo "Adding custom security patterns..."

# API keys pattern
git secrets --add '[Aa](PI|pi)[_-]?[Kk](EY|ey)[_-]?[=:][[:space:]]*['\''"]?[A-Za-z0-9/+=]{20,}['\''"]?'

# Token pattern
git secrets --add '[Tt](OKEN|oken)[_-]?[=:][[:space:]]*['\''"]?[A-Za-z0-9/+=]{20,}['\''"]?'

# Generic secret pattern
git secrets --add '[Ss](ECRET|ecret)[_-]?[=:][[:space:]]*['\''"]?[A-Za-z0-9/+=]{20,}['\''"]?'

# Private key pattern
git secrets --add -- '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'

# Internal Amazon references (should not be in public aws-samples repos)
git secrets --add 'a2z\.com'
git secrets --add 'isengard\.amazon\.com'
git secrets --add 'corp\.amazon\.com'

echo "✓ Custom patterns added:"
echo "  - API key patterns"
echo "  - Token patterns"
echo "  - Secret patterns"
echo "  - Private key patterns"
echo "  - Internal Amazon domain patterns"
echo ""

# Add patterns to git configuration (for this repository)
git config --local secrets.patterns "true"

echo "=== Setup Complete ==="
echo ""
echo "Git-secrets is now configured for this repository!"
echo ""
echo "What happens now:"
echo "  • Every commit will be scanned for secrets before it's created"
echo "  • Commit messages will be scanned for sensitive information"
echo "  • If secrets are detected, the commit will be blocked"
echo ""
echo "Next steps:"
echo "  1. Scan existing history: git secrets --scan-history"
echo "  2. Scan current files:    git secrets --scan"
echo "  3. List patterns:         git secrets --list"
echo ""
echo "To scan the repository now, run:"
echo "  cd $REPO_ROOT && git secrets --scan"
echo ""
