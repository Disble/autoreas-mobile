#!/usr/bin/env bash
#
# Entrypoint for the local Docker APK build (see docker-compose.eas.yml, service `eas-build`).
#
# Resolves ORG_GRADLE_PROJECT_reactNativeArchitectures INSIDE the container instead of letting
# Compose interpolate AUTOREAS_ANDROID_ABIS on the HOST at `docker compose` parse time. Compose
# only expands `${VAR}` in the compose YAML from the calling shell (or a top-level `.env` file)
# -- never from `env_file: .env.local`, which is loaded into the CONTAINER's environment only
# after the container starts. A developer who set AUTOREAS_ANDROID_ABIS in `.env.local` (the
# project's own per-developer config file) was therefore silently ignored and always got the
# `arm64-v8a` default baked in at compose-parse time. See docs/local-android-build.md
# ("Configuration reference") for the full picture.
#
# Precedence (highest wins), computed here rather than by Compose:
#   1. AUTOREAS_ANDROID_ABIS_SHELL_OVERRIDE -- captured from the calling shell's environment at
#      `docker compose` parse time, via `${AUTOREAS_ANDROID_ABIS:-}` in docker-compose.eas.yml.
#      This is how a one-off `AUTOREAS_ANDROID_ABIS=x86_64 docker compose ... run eas-build`
#      reaches the container at all: Compose does NOT forward arbitrary host environment
#      variables into a container by itself, so without this capture the export would silently
#      do nothing.
#   2. AUTOREAS_ANDROID_ABIS -- set either by `docker compose run -e AUTOREAS_ANDROID_ABIS=...`
#      (Compose's own `run -e` precedence beats `env_file:` automatically, no help needed here)
#      or by `.env.local` via `env_file:`.
#   3. arm64-v8a -- default (the test tablet's ABI).
#
# Do NOT "simplify" this by adding a bare `environment: - AUTOREAS_ANDROID_ABIS` pass-through
# entry to docker-compose.eas.yml. Verified empirically (2026-09-23, Docker Compose
# v2.40.3-desktop.1): a bare pass-through entry for a key ALWAYS wins over `env_file:` for that
# same key, even when the host variable is completely unset -- it silently empties out whatever
# `.env.local` set. That is exactly why the shell-capture above uses a differently-named
# variable instead of reusing AUTOREAS_ANDROID_ABIS.
#
# Combining a bare shell export with `-e` in the same invocation is not a supported combination:
# the shell export wins in that case. Use one or the other.

set -euo pipefail

readonly VALID_ABIS="armeabi-v7a arm64-v8a x86 x86_64"
readonly DEFAULT_ABIS="arm64-v8a"

# --- Resolve which ABIs to build, and where the value came from -----------------------------
if [ -n "${AUTOREAS_ANDROID_ABIS_SHELL_OVERRIDE:-}" ]; then
  raw_abis="$AUTOREAS_ANDROID_ABIS_SHELL_OVERRIDE"
  abis_source="from AUTOREAS_ANDROID_ABIS (shell)"
elif [ "${AUTOREAS_ANDROID_ABIS+is_set}" = "is_set" ]; then
  # Set (even to an empty string, e.g. a stray "AUTOREAS_ANDROID_ABIS=" line in .env.local) --
  # validated below, deliberately NOT treated the same as "unset". `${VAR+word}` is nounset-safe.
  raw_abis="$AUTOREAS_ANDROID_ABIS"
  abis_source="from AUTOREAS_ANDROID_ABIS"
else
  raw_abis="$DEFAULT_ABIS"
  abis_source="default"
fi

# --- Validate and normalize: trim spaces, reject empty items, check against the accepted set -
is_valid_abi() {
  local candidate="$1" known
  for known in $VALID_ABIS; do
    if [ "$candidate" = "$known" ]; then
      return 0
    fi
  done
  return 1
}

fail_invalid() {
  echo "--- Invalid AUTOREAS_ANDROID_ABIS value: '$raw_abis' ($1) ---"
  echo "--- Accepted values (comma-separated, no empty items): armeabi-v7a, arm64-v8a, x86, x86_64 ---"
  exit 1
}

if [ -z "$raw_abis" ]; then
  fail_invalid "empty value"
fi

# A leading, trailing, or doubled comma means an empty item -- catch it here, because
# `IFS=',' read -ra` below silently drops a trailing empty field instead of erroring on it.
case "$raw_abis" in
  ,*|*,|*,,*)
    fail_invalid "empty item"
    ;;
esac

IFS=',' read -ra raw_items <<< "$raw_abis"

normalized_items=()
for raw_item in "${raw_items[@]}"; do
  trimmed="$(printf '%s' "$raw_item" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [ -z "$trimmed" ]; then
    fail_invalid "empty item"
  fi
  if ! is_valid_abi "$trimmed"; then
    fail_invalid "unknown ABI '$trimmed'"
  fi
  normalized_items+=("$trimmed")
done

resolved_abis="$(IFS=,; echo "${normalized_items[*]}")"

if [ "$abis_source" = "default" ]; then
  echo "--- Native ABIs: $resolved_abis (default) ---"
else
  echo "--- Native ABIs: $resolved_abis ($abis_source) ---"
fi

# Gradle reads ORG_GRADLE_PROJECT_* as project properties that override
# android/gradle.properties, so this is what actually narrows the CMake/NDK build.
export ORG_GRADLE_PROJECT_reactNativeArchitectures="$resolved_abis"

# Fail loudly when Gradle would not see the Docker-only configuration. A base image that moves
# GRADLE_USER_HOME away from the mounted /root/.gradle turns every build cold and re-enables
# lintVital without any error: that is how a 4.5 min build became 14.5 min on 2026-09-23.
gradle_home="${GRADLE_USER_HOME:-$HOME/.gradle}"
if ! grep -qs '^org.gradle.caching=true' "$gradle_home/gradle.properties" \
  || [ ! -f "$gradle_home/init.d/skip-lint-vital.init.gradle" ]; then
  echo "--- Gradle user home '$gradle_home' does not carry docker/gradle/ (build cache, lintVital skip). ---"
  echo "--- Check GRADLE_USER_HOME and the /root/.gradle mounts in docker-compose.eas.yml. ---"
  exit 1
fi
echo "--- Gradle user home: $gradle_home (build cache on, lintVital skipped) ---"

# Dry run: print the resolution above and stop, without installing dependencies or building.
# Used to verify precedence cheaply (see docs/local-android-build.md, "Configuration reference").
if [ "${AUTOREAS_DRY_RUN:-0}" = "1" ]; then
  exit 0
fi

profile="${1:-preview}"

echo '--- Installing dependencies ---'
bun install --frozen-lockfile

# Name the artifact after what it is, in dist/android/ (gitignored, excluded by .easignore so old
# APKs are never uploaded into the next build). Mirrors the CI release name
# (autoreas-mobile-<version>-android.apk) plus what tells local builds apart:
#   autoreas-mobile-<version>-<profile>-<abis>-<UTC timestamp>[-g<commit>].apk
# <abis> is `universal` when all four ABIs are built, otherwise the list joined with `+`. The commit
# is omitted when Git cannot read the repository (a Git worktree, see EAS_NO_VCS).
app_version="$(node -p "require('./app.json').expo.version")"
abi_count=0
for abi in armeabi-v7a arm64-v8a x86 x86_64; do
  case ",$resolved_abis," in *",$abi,"*) abi_count=$((abi_count + 1)) ;; esac
done
if [ "$abi_count" -eq 4 ]; then
  abis_label="universal"
else
  abis_label="${resolved_abis//,/+}"
fi
commit_label=""
if commit="$(git -c safe.directory=/app -C /app rev-parse --short HEAD 2>/dev/null)"; then
  commit_label="-g${commit}"
fi
artifact="dist/android/autoreas-mobile-${app_version}-${profile}-${abis_label}-$(date -u +%Y%m%dT%H%MZ)${commit_label}.apk"
mkdir -p dist/android

echo '--- Starting EAS local build ---'
ok=0
attempt=1
while [ "$attempt" -le 3 ]; do
  if bunx eas-cli@latest build --local --platform android --profile "$profile" --non-interactive --output "$artifact"; then
    ok=1
    break
  fi
  echo "--- Attempt $attempt failed ---"
  if [ "$attempt" -lt 3 ]; then
    sleep 5
  fi
  attempt=$((attempt + 1))
done

if [ "$ok" -ne 1 ]; then
  echo '--- Build FAILED after 3 attempts. No APK was produced. ---'
  exit 1
fi

echo "--- Build complete: $artifact ---"
