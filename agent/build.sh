#!/bin/sh
# Builds the standalone `moonlight` binaries (Bun runtime embedded, no Node needed) and copies the
# install scripts into agent/release/, which deploy/deploy.sh uploads for the gateway to serve.
#   agent/build.sh            # all five targets
#   agent/build.sh linux-x64  # just one
set -eu
cd "$(dirname "$0")"
BUN=${BUN:-$(command -v bun || echo "$HOME/.bun/bin/bun")}
RCODESIGN=${RCODESIGN:-$(command -v rcodesign || echo "$HOME/.bun/bin/rcodesign")}
TARGETS=${*:-darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64}

mkdir -p release
for t in $TARGETS; do
  ext=
  [ "$t" = windows-x64 ] && ext=.exe
  "$BUN" build agent.mjs --compile --minify --target="bun-$t" --outfile "release/moonlight-$t$ext"
  case $t in
    darwin-*)
      # macOS kills binaries whose signature doesn't match their pages, and Bun's cross-compiled x64 build
      # keeps its runtime's original signature over the modified file. Re-sign ad-hoc (entitlements kept).
      if [ -x "$RCODESIGN" ]; then
        "$RCODESIGN" sign --binary-identifier moonlight "release/moonlight-$t" >/dev/null
      else
        echo "warning: rcodesign not found; release/moonlight-$t may not run on macOS" >&2
      fi
      ;;
  esac
done
cp install.sh install.ps1 release/
chmod +x release/install.sh
ls -l release
