#!/bin/bash

# thinclaw Coverage Script (Node.js/Vitest)
# Runs Vitest tests with coverage analysis
#
# Usage:
#   ./coverage.sh                   # Run tests with coverage + HTML report (default)
#   ./coverage.sh --integration     # Run all tests with coverage + HTML report
#   ./coverage.sh --no-html         # Generate text report only (skip HTML)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_NAME="$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "thinclaw")"
COVERAGE_DIR="/tmp/${PROJECT_NAME}/coverage"

echo -e "${BLUE}🔍 thinclaw Coverage Analysis${NC}"
echo "=================================================="

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  node_modules not found. Running npm install...${NC}"
    npm install
fi

# Parse command line arguments
include_integration=false
generate_html=true

for arg in "$@"; do
    case $arg in
        --integration)
            include_integration=true
            ;;
        --no-html)
            generate_html=false
            ;;
    esac
done

mkdir -p "$COVERAGE_DIR"

# Run vitest with coverage
echo -e "\n${BLUE}🧪 Running Vitest with coverage...${NC}"

if [ "$generate_html" = true ]; then
    echo -e "${BLUE}📊 Generating HTML report to: $COVERAGE_DIR${NC}"
fi

start_time=$(date +%s)

# Build vitest command
VITEST_CMD="npx vitest run --coverage --coverage.provider=v8"

if [ "$generate_html" = true ]; then
    VITEST_CMD="$VITEST_CMD --coverage.reporter=html --coverage.reporter=text"
fi

# Run tests
if $VITEST_CMD 2>&1; then
    echo -e "${GREEN}✅ Tests PASSED${NC}"
    exit_code=0
else
    echo -e "${RED}❌ Tests FAILED${NC}"
    exit_code=1
fi

# Timing
end_time=$(date +%s)
duration=$((end_time - start_time))
echo -e "\n${BLUE}⏱️  Coverage analysis completed in ${duration}s${NC}"
echo -e "${BLUE}📁 Coverage files saved to: $COVERAGE_DIR${NC}"

exit $exit_code