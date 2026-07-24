#!/bin/bash

# Script to push commits and create Pull Request for Issue #252

set -e  # Exit on error

echo "=========================================="
echo "Push Commits and Create Pull Request"
echo "=========================================="
echo ""

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed."
    echo "Please install it from: https://cli.github.com/"
    exit 1
fi

# Check authentication
echo "🔐 Checking GitHub authentication..."
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub."
    echo ""
    echo "Please run: gh auth login"
    echo ""
    exit 1
fi

echo "✅ GitHub CLI is authenticated"
echo ""

# Show commits to be pushed
echo "📝 Commits to be pushed:"
git log --oneline origin/main..main
echo ""

# Push to remote
echo "🚀 Pushing to remote repository..."
git push origin main
echo "✅ Pushed successfully"
echo ""

# Create Pull Request
echo "📋 Creating Pull Request..."
gh pr create \
  --title "feat: Implement true non-interactive mode for -p/--prompt flag" \
  --body-file PR_DESCRIPTION.md \
  --base main \
  --head main \
  --label "enhancement" \
  --reviewer lessweb

echo ""
echo "✅ Pull Request created successfully!"
echo ""
echo "🔗 View your PR at:"
gh pr view --web

echo ""
echo "=========================================="
echo "Next Steps:"
echo "=========================================="
echo "1. Wait for CI checks to pass"
echo "2. Address any review comments"
echo "3. Merge the PR when approved"
echo ""
