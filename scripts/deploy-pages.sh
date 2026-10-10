#!/usr/bin/env bash
# Builds the app and publishes dist/ to the gh-pages branch.
set -e
cd "$(dirname "$0")/.."
npm run build
cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="sq-vault-deploy" -c user.email="deploy@users.noreply.github.com" commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git push -f https://github.com/rayenanane1/sq-vault gh-pages
rm -rf .git
