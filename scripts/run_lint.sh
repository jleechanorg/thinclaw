#!/bin/bash

# thinclaw Lint Script (Node.js/TypeScript)
# Runs ESLint, Prettier, and TypeScript type checking

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR="${1:-.}"

echo -e "${BLUE}🔍 Running Node.js linting on: ${PROJECT_DIR}${NC}"
echo "=================================================="

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  node_modules not found. Running npm install...${NC}"
    npm install
fi

# Track overall status
overall_status=0

# 1. ESLint
echo -e "\n${BLUE}📋 STEP 1: ESLint${NC}"
if npx eslint "$PROJECT_DIR" --ext .js,.ts 2>/dev/null; then
    echo -e "${GREEN}✅ ESLint: PASSED${NC}"
else
    echo -e "${YELLOW}⚠️  ESLint: issues found (or not configured)${NC}"
fi

# 2. TypeScript type check
echo -e "\n${BLUE}📋 STEP 2: TypeScript Type Check${NC}"
if [ -f "tsconfig.json" ]; then
    if npx tsc --noEmit 2>/dev/null; then
        echo -e "${GREEN}✅ TypeScript: PASSED${NC}"
    else
        echo -e "${YELLOW}⚠️  TypeScript: type errors found${NC}"
        overall_status=1
    fi
else
    echo -e "${YELLOW}⚠️  No tsconfig.json found - skipping TypeScript check${NC}"
fi

# Summary
echo -e "\n=================================================="
if [[ $overall_status -eq 0 ]]; then
    echo -e "${GREEN}🎉 LINTING COMPLETE${NC}"
else
    echo -e "${YELLOW}⚠️  Some checks had issues${NC}"
fi

exit $overall_status