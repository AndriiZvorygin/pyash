#!/usr/bin/env bash
set -euo pipefail

NVM_VERSION="${NVM_VERSION:-v0.39.7}"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

echo "Installing nvm ${NVM_VERSION} into ${NVM_DIR}"

fetch() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url"
    return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
    return 0
  fi
  echo "Error: curl or wget is required." >&2
  exit 1
}

# Run official installer (pinned version)
fetch "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash

# Ensure init snippet exists in common shell rc files
add_init_snippet() {
  local rc="$1"
  [ -f "$rc" ] || return 0

  local begin="# >>> nvm >>>"
  local end="# <<< nvm <<<"

  if grep -Fq "$begin" "$rc"; then
    return 0
  fi

  cat >> "$rc" <<'EOF'

# >>> nvm >>>
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
# <<< nvm <<<
EOF
}

add_init_snippet "$HOME/.bashrc"
add_init_snippet "$HOME/.zshrc"
add_init_snippet "$HOME/.profile"

# Load nvm for this script session
export NVM_DIR="$NVM_DIR"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "nvm version:"
nvm --version

echo "Install Node LTS:"
nvm install --lts
nvm use --lts

echo "Node version:"
node -v
echo "npm version:"
npm -v

echo "Done. Open a new shell for rc changes to apply everywhere."
