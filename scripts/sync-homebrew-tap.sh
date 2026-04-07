#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Sync the local Homebrew tap formula with the latest published npm release.

Usage:
  ./scripts/sync-homebrew-tap.sh [options]

Options:
  --version <version>  Sync a specific npm version instead of the latest
  --no-audit           Skip `brew audit --strict`
  --no-commit          Update the formula but do not commit it
  --no-push            Commit locally but do not push to origin
  -h, --help           Show this help message
EOF
}

log() {
  printf '[sync-homebrew] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

VERSION=""
RUN_AUDIT=1
RUN_COMMIT=1
RUN_PUSH=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      if [[ -z "$VERSION" ]]; then
        printf 'Missing value for --version\n' >&2
        exit 1
      fi
      shift 2
      ;;
    --no-audit)
      RUN_AUDIT=0
      shift
      ;;
    --no-commit)
      RUN_COMMIT=0
      RUN_PUSH=0
      shift
      ;;
    --no-push)
      RUN_PUSH=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_cmd brew
require_cmd npm
require_cmd node
require_cmd curl
require_cmd shasum
require_cmd git
require_cmd perl

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PACKAGE_NAME="$(cd "$REPO_ROOT" && node -p "require('./package.json').name")"
if [[ -z "$VERSION" ]]; then
  VERSION="$(npm view "$PACKAGE_NAME" version)"
fi

TAP_REPOSITORY="${HOMEBREW_TAP_REPOSITORY:-SunZhiC/agents-run}"
TAP_DIR="${HOMEBREW_TAP_DIR:-$(brew --repository "$TAP_REPOSITORY")}"
FORMULA_PATH="${FORMULA_PATH:-${TAP_DIR}/Formula/${PACKAGE_NAME}.rb}"
FORMULA_REF="$(printf '%s' "$TAP_REPOSITORY" | tr '[:upper:]' '[:lower:]')/${PACKAGE_NAME}"

if [[ ! -d "$TAP_DIR" ]]; then
  printf 'Tap repository not found: %s\n' "$TAP_DIR" >&2
  exit 1
fi

if [[ ! -f "$FORMULA_PATH" ]]; then
  printf 'Formula file not found: %s\n' "$FORMULA_PATH" >&2
  exit 1
fi

URL="$(npm view "${PACKAGE_NAME}@${VERSION}" dist.tarball)"
if [[ -z "$URL" ]]; then
  printf 'Unable to resolve tarball URL for %s@%s\n' "$PACKAGE_NAME" "$VERSION" >&2
  exit 1
fi

SHA256="$(curl -fsSL "$URL" | shasum -a 256 | awk '{print $1}')"
if [[ -z "$SHA256" ]]; then
  printf 'Unable to calculate sha256 for %s\n' "$URL" >&2
  exit 1
fi

CURRENT_URL="$(ruby -e 'puts File.read(ARGV[0])[/^\s*url\s+"([^"]+)"/, 1].to_s' "$FORMULA_PATH")"
CURRENT_SHA256="$(ruby -e 'puts File.read(ARGV[0])[/^\s*sha256\s+"([^"]+)"/, 1].to_s' "$FORMULA_PATH")"

if [[ "$CURRENT_URL" == "$URL" && "$CURRENT_SHA256" == "$SHA256" ]]; then
  log "Formula already up to date for ${PACKAGE_NAME}@${VERSION}"
  exit 0
fi

log "Updating ${FORMULA_PATH}"
log "Version: ${VERSION}"
log "URL: ${URL}"
log "SHA256: ${SHA256}"

perl -0pi -e "s{^(\s*url\s+\").*(\"\s*)\$}{\${1}${URL}\$2}m; s{^(\s*sha256\s+\").*(\"\s*)\$}{\${1}${SHA256}\$2}m;" "$FORMULA_PATH"

if [[ "$RUN_AUDIT" -eq 1 ]]; then
  log "Running brew audit"
  brew audit --strict "$FORMULA_REF"
fi

if [[ "$RUN_COMMIT" -eq 1 ]]; then
  if ! git -C "$TAP_DIR" diff --quiet -- "$FORMULA_PATH"; then
    git -C "$TAP_DIR" add "$FORMULA_PATH"
    git -C "$TAP_DIR" commit -m "${PACKAGE_NAME} ${VERSION}"
    if [[ "$RUN_PUSH" -eq 1 ]]; then
      git -C "$TAP_DIR" push origin main
    else
      log "Skipped push (--no-push)"
    fi
  else
    log "No formula changes to commit"
  fi
else
  log "Skipped commit (--no-commit)"
fi

