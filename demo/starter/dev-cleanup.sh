#!/usr/bin/env bash
# Kill all dev-server processes spawned for this slidev fork's demo/starter, including
# orphans left behind by past sessions. `nohup pnpm dev … & disown` (the pattern
# the original `dev` script + claude sessions use) reparents children to init when
# the spawning shell exits, so they accumulate silently across sessions.
#
# Usage:
#   bash dev-cleanup.sh        # list + prompt
#   bash dev-cleanup.sh -y     # kill without prompting
#   bash dev-cleanup.sh -n     # dry-run (list only)
set -euo pipefail

YES=
DRY=
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    -n|--dry-run) DRY=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# Process patterns with an explicit slidev path in their cmdline — safe to match
# globally (no cwd lookup needed). Catches the nodemon watcher + the slidev.mjs
# child it spawns.
EXPLICIT='/c/slidev/demo/starter/.*node_modules/.*(@slidev/cli/bin/slidev\.mjs|nodemon)'

# `pnpm dev` / `pnpm static:dev` invocations have no path in their cmdline, so we
# resolve cwd via lsof and only match ones in this project's directory. This
# keeps the cleanup project-scoped even though other projects use `pnpm dev` too.
PNPM_PATTERN='pnpm (dev|static:dev)$'
PROJECT_DIR='/Users/ryan/c/slidev/demo/starter'

explicit_pids() {
  pgrep -fl "$EXPLICIT" 2>/dev/null | awk '{print $1}' || true
}

pnpm_pids_in_project() {
  pgrep -fl "$PNPM_PATTERN" 2>/dev/null | awk '{print $1}' | while read -r pid; do
    cwd=$(lsof -p "$pid" 2>/dev/null | awk '$4=="cwd" {print $NF; exit}')
    [[ "$cwd" == "$PROJECT_DIR"* ]] && echo "$pid"
  done
}

PIDS=$(printf '%s\n%s\n' "$(explicit_pids)" "$(pnpm_pids_in_project)" | sort -u | grep -v '^$' || true)

if [[ -z "$PIDS" ]]; then
  echo "no dev-server processes to clean up."
  exit 0
fi

echo "matching processes (slidev demo/starter only):"
ps -o pid,ppid,etime,command -p $PIDS 2>/dev/null || true
echo ""

if [[ -n "$DRY" ]]; then
  exit 0
fi

if [[ -z "$YES" ]]; then
  read -rp "kill all? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "aborted."; exit 1; }
fi

echo "$PIDS" | xargs kill -TERM 2>/dev/null || true
sleep 1
SURVIVORS=$(printf '%s\n%s\n' "$(explicit_pids)" "$(pnpm_pids_in_project)" | sort -u | grep -v '^$' || true)
if [[ -n "$SURVIVORS" ]]; then
  echo "force-killing survivors: $SURVIVORS"
  echo "$SURVIVORS" | xargs kill -9 2>/dev/null || true
fi

echo ""
echo "ports:"
for p in 3282 3283; do
  holders=$(lsof -ti:$p 2>/dev/null | tr '\n' ' ')
  [[ -z "$holders" ]] && holders='<free>'
  echo "  $p: $holders"
done
