#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check for dry run mode
DRY_RUN_FLAG=""
if [ "${DRY_RUN}" = "true" ] || [ "${DRY_RUN}" = "1" ]; then
  DRY_RUN_FLAG="--dry-run"
  echo -e "${BLUE}DRY RUN MODE - No packages will be published${NC}"
fi

echo "Publishing all packages to GitHub Packages..."
echo ""

# Get the root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGES_DIR="$ROOT_DIR/packages"

# Check if packages directory exists
if [ ! -d "$PACKAGES_DIR" ]; then
  echo -e "${RED}Error: packages directory not found at $PACKAGES_DIR${NC}"
  exit 1
fi

# Track success/failure
FAILED_PACKAGES=()
SUCCESSFUL_PACKAGES=()

# Iterate through all packages
for package_dir in "$PACKAGES_DIR"/*; do
  if [ -d "$package_dir" ]; then
    package_name=$(basename "$package_dir")

    # Check if package.json exists
    if [ ! -f "$package_dir/package.json" ]; then
      echo -e "${YELLOW}Skipping $package_name (no package.json found)${NC}"
      continue
    fi

    if node -e "const fs = require('node:fs'); const pkg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.exit(pkg.private === true ? 0 : 1)" "$package_dir/package.json"; then
      echo -e "${YELLOW}Skipping $package_name (private package)${NC}"
      continue
    fi

    if [ -n "$DRY_RUN_FLAG" ]; then
      echo -e "${BLUE}[DRY RUN] Publishing $package_name...${NC}"
    else
      echo -e "${YELLOW}Publishing $package_name...${NC}"
    fi

    # Change to package directory and publish
    cd "$package_dir"

    if npm publish --access restricted $DRY_RUN_FLAG; then
      if [ -n "$DRY_RUN_FLAG" ]; then
        echo -e "${BLUE}✓ [DRY RUN] Would publish $package_name${NC}"
      else
        echo -e "${GREEN}✓ Successfully published $package_name${NC}"
      fi
      SUCCESSFUL_PACKAGES+=("$package_name")
    else
      echo -e "${RED}✗ Failed to publish $package_name${NC}"
      FAILED_PACKAGES+=("$package_name")
    fi

    echo ""
  fi
done

# Summary
echo "================================================"
echo "Publication Summary"
echo "================================================"
echo -e "${GREEN}Successful: ${#SUCCESSFUL_PACKAGES[@]}${NC}"
for pkg in "${SUCCESSFUL_PACKAGES[@]}"; do
  echo -e "  ${GREEN}✓${NC} $pkg"
done

if [ ${#FAILED_PACKAGES[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}Failed: ${#FAILED_PACKAGES[@]}${NC}"
  for pkg in "${FAILED_PACKAGES[@]}"; do
    echo -e "  ${RED}✗${NC} $pkg"
  done
  exit 1
fi

echo ""
if [ -n "$DRY_RUN_FLAG" ]; then
  echo -e "${BLUE}[DRY RUN] All packages validated successfully!${NC}"
else
  echo -e "${GREEN}All packages published successfully!${NC}"
fi
