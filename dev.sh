#!/bin/zsh
# Dev server launcher — uses the project-local Node 24 (system node is 18, too old for Next.js 16).
export PATH="$HOME/.local/node/node-v24.18.0-darwin-arm64/bin:$PATH"
cd "$(dirname "$0")"
exec npm run dev
