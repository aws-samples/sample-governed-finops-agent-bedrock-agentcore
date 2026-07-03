#!/bin/bash

echo "=== Generating NOTICE File ==="

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

NOTICE_FILE="NOTICE"

# Header
cat > "$NOTICE_FILE" << 'EOF'
Sample FinOps Agent for Amazon Bedrock AgentCore
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

This project includes the following third-party software/licenses:

---

EOF

# Python dependencies
echo "Python Dependencies:" >> "$NOTICE_FILE"
echo "" >> "$NOTICE_FILE"

if [ -f "agentcore/requirements.txt" ]; then
    while IFS= read -r line; do
        # Skip comments and empty lines
        [[ "$line" =~ ^#.*$ ]] && continue
        [[ -z "$line" ]] && continue
        
        # Extract package name (before version specifier)
        package=$(echo "$line" | sed 's/\[.*\]//g' | sed 's/[><=!].*//' | xargs)
        
        # Query PyPI for license info (requires network)
        echo "- $package - [License TBD - verify manually]" >> "$NOTICE_FILE"
        echo "  https://pypi.org/project/$package" >> "$NOTICE_FILE"
        echo "" >> "$NOTICE_FILE"
    done < "agentcore/requirements.txt"
fi

if [ -f "agentcore-remediator/requirements.txt" ]; then
    while IFS= read -r line; do
        # Skip comments and empty lines
        [[ "$line" =~ ^#.*$ ]] && continue
        [[ -z "$line" ]] && continue
        
        # Extract package name (before version specifier)
        package=$(echo "$line" | sed 's/\[.*\]//g' | sed 's/[><=!].*//' | xargs)
        
        # Query PyPI for license info (requires network)
        echo "- $package - [License TBD - verify manually]" >> "$NOTICE_FILE"
        echo "  https://pypi.org/project/$package" >> "$NOTICE_FILE"
        echo "" >> "$NOTICE_FILE"
    done < "agentcore-remediator/requirements.txt"
fi

echo "---" >> "$NOTICE_FILE"
echo "" >> "$NOTICE_FILE"

# CDK dependencies
echo "Node.js Dependencies (CDK):" >> "$NOTICE_FILE"
echo "" >> "$NOTICE_FILE"

if [ -f "cdk/package.json" ]; then
    # Extract dependencies using jq if available
    if command -v jq &> /dev/null; then
        jq -r '.dependencies | to_entries[] | "- \(.key) - [License TBD]\n  https://npmjs.com/package/\(.key)\n"' cdk/package.json >> "$NOTICE_FILE"
    else
        echo "Note: jq not available. Please manually add CDK dependencies from cdk/package.json" >> "$NOTICE_FILE"
    fi
fi

echo "---" >> "$NOTICE_FILE"
echo "" >> "$NOTICE_FILE"

# Frontend dependencies
echo "Node.js Dependencies (Frontend):" >> "$NOTICE_FILE"
echo "" >> "$NOTICE_FILE"

if [ -f "frontend/package.json" ]; then
    # Extract dependencies using jq if available
    if command -v jq &> /dev/null; then
        jq -r '.dependencies | to_entries[] | "- \(.key) - [License TBD]\n  https://npmjs.com/package/\(.key)\n"' frontend/package.json >> "$NOTICE_FILE"
    else
        echo "Note: jq not available. Please manually add frontend dependencies from frontend/package.json" >> "$NOTICE_FILE"
    fi
fi

echo "" >> "$NOTICE_FILE"
echo "---" >> "$NOTICE_FILE"
echo "" >> "$NOTICE_FILE"
echo "⚠ Manual review required:" >> "$NOTICE_FILE"
echo "  1. Verify license types for each dependency" >> "$NOTICE_FILE"
echo "  2. Confirm repository URLs are correct" >> "$NOTICE_FILE"
echo "  3. Update [License TBD] with actual license types" >> "$NOTICE_FILE"

echo "✓ NOTICE file generated at $NOTICE_FILE"
echo ""
echo "⚠ Manual review required:"
echo "  1. Verify license types for each dependency"
echo "  2. Confirm repository URLs are correct"
echo "  3. Add frontend dependencies if not included"
