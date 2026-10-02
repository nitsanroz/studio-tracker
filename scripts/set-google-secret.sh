#!/bin/bash
# Replaces GOOGLE_CLIENT_SECRET in .env.local and in Vercel (production).
# Asks for the value without echoing it, so it never lands in a chat or a log.
#
#   bash scripts/set-google-secret.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/node-v24.18.0-darwin-arm64/bin:$PATH"

printf "Paste the NEW Google client secret, then press Enter: "
read -rs SECRET
echo
if [[ ! "$SECRET" =~ ^GOCSPX- ]]; then
  echo "That doesn't look like a Google client secret (they start with GOCSPX-). Nothing changed."
  exit 1
fi

# .env.local: drop the old line, add the new one.
grep -v '^GOOGLE_CLIENT_SECRET=' .env.local > .env.local.tmp || true
echo "GOOGLE_CLIENT_SECRET=$SECRET" >> .env.local.tmp
mv .env.local.tmp .env.local
echo "✓ .env.local updated"

# Vercel: remove the old value (if any), add the new one.
npx vercel env rm GOOGLE_CLIENT_SECRET production --yes >/dev/null 2>&1 || true
printf "%s" "$SECRET" | npx vercel env add GOOGLE_CLIENT_SECRET production --sensitive >/dev/null 2>&1
echo "✓ Vercel updated"
echo "Done — tell Claude."
