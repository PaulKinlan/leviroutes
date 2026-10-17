#!/usr/bin/env bash
# tools/fast-gate.sh — the FAST tier: run the suites that cover what a change can affect, and FAIL LOUDLY
# on a changed file that maps to none.
#
# Adheres to ~/fleet/docs/speed.md R2, R5, R14:
#   * R2: Fast gate is a strict subset of the full gate, budgeted <= 60 s.
#   * R5: Selection is affected-only via suite-map.tsv, failing loudly on unmapped files.
#   * R14: The gate must cover what a change can affect.
#
# Output contract parsed by ~/fleet/remote/check-coverage.py and ~/fleet/remote/producer-verdict.py:
#   fast-gate: running: <suite>
#   fast-gate: passed: <suite>
#   fast-gate: failed: <suite>
#   fast-gate: unmapped: <path>
#   fast-gate: PASS (<N> suite(s), <M> changed file(s))
set -uo pipefail

HERE=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
MAP="$HERE/suite-map.tsv"
JOBS=${FAST_GATE_JOBS:-4}

[ -f "$MAP" ] || { echo "fast-gate: no $MAP — the map IS the gate; refusing to guess" >&2; exit 1; }

# Every non-exemption row must still describe something in the tree. A row left behind for a
# path that was deleted (and so can never change again) is dead config, and dead config is
# worse than a missing row: it turns a future change under that path from a loud 'unmapped'
# failure into a PASS with coverage that never ran. leviroutes-n0a deleted SpecRunner.html,
# tests/ and lib/ but re-mapped them to unrelated suites, so re-adding tests/x.js selected
# spec/*.spec.mjs instead of failing loudly (leviroutes-62g). Retired paths lose their row.
DEAD_ROWS=()
while IFS=$'\t' read -r pat rest; do
  case $pat in ''|\#*|\!*) continue ;; esac
  case $pat in
    *'/**')
      # <dir>/** means "anything under this directory", so the directory is what must exist.
      [ -d "$ROOT/${pat%'/**'}" ] || DEAD_ROWS+=("$pat")
      ;;
    *'*'*|*'?'*|*'['*)
      echo "fast-gate: FAIL - map row '$pat' is not a supported shape: use <path> or <dir>/**." >&2
      exit 1
      ;;
    *)
      [ -e "$ROOT/$pat" ] || DEAD_ROWS+=("$pat")
      ;;
  esac
done < "$MAP"

if [ "${#DEAD_ROWS[@]}" -gt 0 ]; then
  for pat in "${DEAD_ROWS[@]}"; do
    echo "fast-gate: dead row: $pat matches nothing in the tree"
  done
  echo "fast-gate: FAIL - ${#DEAD_ROWS[@]} map row(s) name paths that no longer exist. Retired paths must lose their row, so a change there fails loudly as unmapped." >&2
  exit 1
fi

LIST=0; BASE="${FAST_GATE_BASE:-}"; RUN_ALL=0; EXPLICIT=()
while [ $# -gt 0 ]; do
  case $1 in
    --list)    LIST=1; shift ;;
    --changed) EXPLICIT+=("${2:?--changed needs a path}"); shift 2 ;;
    --base)    BASE="${2:?--base needs a ref}"; shift 2 ;;
    --all)     RUN_ALL=1; shift ;;
    *)         echo "fast-gate: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

is_exempt() {
  local pat
  while IFS=$'\t' read -r pat _; do
    case $pat in \!*) [ -n "${pat#!}" ] || continue; [[ $1 == ${pat#!} ]] && return 0 ;; esac
  done < "$MAP"
  return 1
}

suites_for() {
  local f="$1" pat rest
  # Changed spec files map to themselves directly
  case $f in spec/*.spec.mjs|spec/*.spec.js) echo "$f"; return ;; esac

  while IFS=$'\t' read -r pat rest; do
    case $pat in ''|\#*|\!*) continue ;; esac
    if [[ $f == $pat ]]; then
      printf '%s\n' $rest
    fi
  done < "$MAP"
}

if [ "$RUN_ALL" -eq 1 ]; then
  mapfile -t SELECTED < <(
    while IFS=$'\t' read -r pat rest; do
      case $pat in ''|\#*|\!*) continue ;; esac
      printf '%s\n' $rest
    done < "$MAP" | sed '/^$/d' | sort -u
  )
  CHANGED=("all")
else
  if [ "${#EXPLICIT[@]}" -eq 0 ]; then
    if [ -z "$BASE" ]; then
      for b in origin/main main origin/master master; do
        git -C "$ROOT" rev-parse --verify --quiet "$b" >/dev/null 2>&1 && { BASE=$b; break; }
      done
    fi
    [ -n "$BASE" ] || { echo "fast-gate: no base ref (no origin/main, main, origin/master, master) and no --changed given" >&2; exit 1; }
    MB=$(git -C "$ROOT" merge-base "$BASE" HEAD 2>/dev/null) || { echo "fast-gate: cannot merge-base $BASE..HEAD" >&2; exit 1; }

    # If HEAD is the base commit, compare HEAD~1..HEAD if available so tip commit is checked
    DIFF_SPEC="$MB..HEAD"
    if [ "$MB" = "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)" ]; then
      if git -C "$ROOT" rev-parse --verify --quiet HEAD~1 >/dev/null 2>&1; then
        DIFF_SPEC="HEAD~1..HEAD"
      fi
    fi

    mapfile -t CHANGED < <( { git -C "$ROOT" diff --name-only "$DIFF_SPEC"
                              git -C "$ROOT" diff --name-only; } 2>/dev/null \
                            | sed '/^$/d' | sort -u )
  else
    CHANGED=("${EXPLICIT[@]}")
  fi

  UNMAPPED=(); EXEMPT_COUNT=0; SELECTED=()
  for f in ${CHANGED[@]+"${CHANGED[@]}"}; do
    got=$(suites_for "$f")
    if [ -n "$got" ]; then
      while IFS= read -r s; do [ -n "$s" ] && SELECTED+=("$s"); done <<<"$got"
    elif is_exempt "$f"; then
      EXEMPT_COUNT=$((EXEMPT_COUNT + 1))
    else
      UNMAPPED+=("$f")
    fi
  done

  if [ "${#UNMAPPED[@]}" -gt 0 ]; then
    mapfile -t _unmapped_sorted < <(printf '%s\n' "${UNMAPPED[@]}" | sort -u)
    for f in "${_unmapped_sorted[@]}"; do [ -n "$f" ] && echo "fast-gate: unmapped: $f"; done
    echo "fast-gate: FAIL - ${#UNMAPPED[@]} changed file(s) map to no suite in tools/suite-map.tsv." >&2
    exit 1
  fi

  mapfile -t SELECTED < <(printf '%s\n' ${SELECTED[@]+"${SELECTED[@]}"} | sed '/^$/d' | sort -u)

  if [ "${#SELECTED[@]}" -eq 0 ]; then
    echo "fast-gate: no suites affected by ${#CHANGED[@]} changed file(s) (${EXEMPT_COUNT} exempt)"
    exit 0
  fi
fi

if [ "$LIST" -eq 1 ]; then
  printf '%s\n' "${SELECTED[@]}"
  exit 0
fi

# Verify mapped suites exist
MISSING=()
for s in "${SELECTED[@]}"; do [ -f "$ROOT/$s" ] || MISSING+=("$s"); done
if [ "${#MISSING[@]}" -gt 0 ]; then
  printf 'fast-gate: missing: %s\n' "${MISSING[@]}"
  echo "fast-gate: FAIL - ${#MISSING[@]} suite(s) named in tools/suite-map.tsv do not exist." >&2
  exit 1
fi

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

run_single_suite() {
  local suite="$1"
  local logfile="$2"
  if [ -n "${FAST_GATE_RUNNER:-}" ]; then
    $FAST_GATE_RUNNER "$suite" >"$logfile" 2>&1
  elif [[ "$suite" == *.sh ]]; then
    bash "$ROOT/$suite" >"$logfile" 2>&1
  elif [[ "$suite" == *.mjs ]] || [[ "$suite" == *.js ]]; then
    if [[ "$suite" == spec/* ]]; then
      npx jasmine "$ROOT/$suite" >"$logfile" 2>&1
    else
      node "$ROOT/$suite" >"$logfile" 2>&1
    fi
  else
    npx jasmine "$ROOT/$suite" >"$logfile" 2>&1
  fi
}

for s in "${SELECTED[@]}"; do
  echo "fast-gate: running: $s"
done

n=0
for s in "${SELECTED[@]}"; do
  key=$(printf '%s' "$s" | tr '/.' '__')
  (
    run_single_suite "$s" "$TMP/$key.log"
    echo $? > "$TMP/$key.rc"
  ) &
  n=$((n + 1))
  if [ "$n" -ge "$JOBS" ]; then
    wait -n
    n=$((n - 1))
  fi
done
wait

rc=0
for s in "${SELECTED[@]}"; do
  key=$(printf '%s' "$s" | tr '/.' '__')
  suite_rc=$(cat "$TMP/$key.rc" 2>/dev/null || echo 1)
  if [ "$suite_rc" -eq 0 ]; then
    echo "fast-gate: passed: $s"
  else
    echo "fast-gate: failed: $s"
    sed 's/^/    /' "$TMP/$key.log" 2>/dev/null | tail -40
    rc=1
  fi
done

if [ "$rc" -eq 0 ]; then
  echo "fast-gate: PASS (${#SELECTED[@]} suite(s), ${#CHANGED[@]} changed file(s))"
else
  echo "fast-gate: FAIL (see the suite logs above)" >&2
fi
exit $rc
