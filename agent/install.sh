#!/bin/sh
# Moonlight agent installer for macOS and Linux:
#   curl -fsSL https://moonlight.hajunshin.com/install.sh | sh
# Puts the standalone `moonlight` binary in ~/.local/bin (override with MOONLIGHT_INSTALL_DIR).
set -eu

BASE="${MOONLIGHT_URL:-https://moonlight.hajunshin.com}"
DIR="${MOONLIGHT_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "moonlight: $(uname -s) isn't supported by this script. On Windows, run in PowerShell: irm $BASE/install.ps1 | iex" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) echo "moonlight: no build for $(uname -m) CPUs yet." >&2; exit 1 ;;
esac
# A shell running under Rosetta reports x86_64 on Apple silicon; use the native build.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi

url="$BASE/dl/moonlight-$os-$arch"
mkdir -p "$DIR"
tmp="$DIR/.moonlight-download.$$"
trap 'rm -f "$tmp"' EXIT INT TERM
echo "Downloading Moonlight for $os-$arch..."
if command -v curl >/dev/null 2>&1; then
  curl -fL --progress-bar "$url" -o "$tmp"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$tmp" "$url"
else
  echo "moonlight: this script needs curl or wget." >&2
  exit 1
fi
chmod +x "$tmp"
mv -f "$tmp" "$DIR/moonlight"
trap - EXIT INT TERM
# Gatekeeper quarantines browser downloads (curl's aren't); clear the flag in case the file came that way.
if [ "$os" = darwin ]; then xattr -d com.apple.quarantine "$DIR/moonlight" 2>/dev/null || true; fi

echo "Installed $("$DIR/moonlight" --version) at $DIR/moonlight"
run=moonlight
case ":$PATH:" in
  *":$DIR:"*) ;;
  *)
    run="$DIR/moonlight"
    case "${SHELL:-}" in
      */zsh) rc="$HOME/.zshrc" ;;
      */bash) rc="$HOME/.bashrc" ;;
      *) rc="$HOME/.profile" ;;
    esac
    echo
    echo "$DIR isn't on your PATH yet. To add it:"
    echo "  echo 'export PATH=\"$DIR:\$PATH\"' >> $rc && . $rc"
    ;;
esac
echo
echo "Next:"
echo "  1. Install Ollama (https://ollama.com) and pull a model:  ollama pull qwen2.5:7b"
echo "  2. Connect this computer:  $run"
