#!/usr/bin/env bash
# tools/check-cmd.sh — manage and inspect leviroutes fleet-check configuration.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRACKED="$ROOT/tools/check.conf"
GLOBAL_CONF="${HOME:+$HOME/.fleet/check.conf}"
REPO_CONF="${HOME:+$HOME/.fleet/leviroutes-check.conf}"
TARGET="${FLEET_CHECK_CONF:-$GLOBAL_CONF}"

case "${1:-}" in
  --install)
    shift || true
    if [ "${1:-}" = "--global" ]; then
      DEST="$GLOBAL_CONF"
    else
      DEST="${TARGET:-$GLOBAL_CONF}"
    fi
    mkdir -p "$(dirname "$DEST")"
    GIT_COMMON=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
    if [ -n "$GIT_COMMON" ]; then
      sed "s|^CHECK_FAST_CONTRACT_OWNER=.*|CHECK_FAST_CONTRACT_OWNER=\"$GIT_COMMON\"|" "$TRACKED" > "$DEST"
    else
      cp "$TRACKED" "$DEST"
    fi
    if [ -n "$REPO_CONF" ]; then
      mkdir -p "$(dirname "$REPO_CONF")"
      cp "$DEST" "$REPO_CONF"
    fi
    echo "Installed check configuration from $TRACKED to $DEST"
    exit 0
    ;;
  --check)
    if [ ! -f "$TARGET" ]; then
      echo "No check configuration installed at $TARGET" >&2
      exit 3
    fi
    if cmp -s "$TRACKED" "$TARGET"; then
      echo "Check configuration in sync with $TARGET"
      exit 0
    else
      echo "Check configuration differs from $TARGET" >&2
      diff -u "$TRACKED" "$TARGET" || true
      exit 1
    fi
    ;;
  CHECK_CMD|CHECK_FAST_CMD|CHECK_TIMEOUT|CHECK_FAST_TIMEOUT|CHECK_FAST_PASS_RE|CHECK_FAST_NO_WORK_RE|CHECK_FAST_COVERAGE_REQUIRED|CHECK_FAST_CONTRACT_OWNER)
    # shellcheck disable=SC1090
    source "$TRACKED"
    [ -f "$TARGET" ] && source "$TARGET"
    eval "echo \"\${$1:-}\""
    exit 0
    ;;
  "")
    # shellcheck disable=SC1090
    source "$TRACKED"
    [ -f "$TARGET" ] && source "$TARGET"
    echo "CHECK_CMD=\"${CHECK_CMD:-}\""
    echo "CHECK_TIMEOUT=${CHECK_TIMEOUT:-}"
    echo "CHECK_FAST_CMD=\"${CHECK_FAST_CMD:-}\""
    echo "CHECK_FAST_TIMEOUT=${CHECK_FAST_TIMEOUT:-}"
    echo "CHECK_FAST_PASS_RE=\"${CHECK_FAST_PASS_RE:-}\""
    echo "CHECK_FAST_NO_WORK_RE=\"${CHECK_FAST_NO_WORK_RE:-}\""
    echo "CHECK_FAST_COVERAGE_REQUIRED=${CHECK_FAST_COVERAGE_REQUIRED:-}"
    echo "CHECK_FAST_CONTRACT_OWNER=\"${CHECK_FAST_CONTRACT_OWNER:-}\""
    exit 0
    ;;
  *)
    echo "Usage: tools/check-cmd.sh [--install [--global]] [--check] [FIELD]" >&2
    exit 2
    ;;
esac
