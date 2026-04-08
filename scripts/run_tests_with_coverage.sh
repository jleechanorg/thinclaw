#!/bin/bash

# thinclaw Test Runner with Coverage (Node.js/Vitest)
# Runs Vitest tests with coverage analysis
#
# Usage:
#   ./run_tests_with_coverage.sh                   # Run tests with coverage
#   ./run_tests_with_coverage.sh --no-html        # Generate text report only (skip HTML)
#   ./run_tests_with_coverage.sh --integration     # Run all tests including integration

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR="${1:-.}"

echo -e "${BLUE}🔍 Running thinclaw tests with coverage${NC}"
echo "=================================================="

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  node_modules not found. Running npm install...${NC}"
    npm install
fi

# Track overall status
overall_status=0

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

# Determine test file patterns
echo -e "\n${BLUE}📋 Finding test files...${NC}"

TEST_FILES="*.test.js *.test.ts"

if [ "$include_integration" = true ]; then
    echo -e "${YELLOW}Including integration tests${NC}"
else
    echo -e "${YELLOW}Excluding integration tests (use --integration to include)${NC}"
fi

# Run vitest with coverage
echo -e "\n${BLUE}🧪 Running Vitest with coverage...${NC}"

if [ "$generate_html" = true ]; then
    # Run with coverage (HTML report)
    if npx vitest run --coverage --coverage.provider=v8 --coverage.reporter=html --reporter=verbose 2>&1; then
        echo -e "${GREEN}✅ Tests PASSED with coverage${NC}"
    else
        echo -e "${RED}❌ Tests FAILED${NC}"
        overall_status=1
    fi
else
    # Run with coverage (text only)
    if npx vitest run --coverage --coverage.provider=v8 --reporter=verbose 2>&1; then
        echo -e "${GREEN}✅ Tests PASSED with coverage${NC}"
    else
        echo -e "${RED}❌ Tests FAILED${NC}"
        overall_status=1
    fi
fi

# Summary
echo -e "\n=================================================="
if [[ $overall_status -eq 0 ]]; then
    echo -e "${GREEN}🎉 TESTS COMPLETE${NC}"
else
    echo -e "${YELLOW}⚠️  Some tests failed${NC}"
fi

exit $overall_status