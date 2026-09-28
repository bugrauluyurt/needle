#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
BROWSER=${BROWSER:-$(command -v chromium || command -v chromium-browser || command -v google-chrome)}
render() { "$BROWSER" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor="$1" --window-size=1280,640 --screenshot="$PWD/$2" "file://$PWD/hero.html" >/dev/null 2>&1; }
render 2 hero.png
render 1 social-preview.png
echo "hero.png (README) and social-preview.png (GitHub → Settings → Social preview)"
