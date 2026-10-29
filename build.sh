#!/usr/bin/env bash
#
# One entry point for every platform.
#
#   ./build.sh                 what you can run
#   ./build.sh check           every gate: engine, website, Swift port, cross-language drift
#   ./build.sh website         build the Next.js site
#   ./build.sh website dev     run it on port 3000
#   ./build.sh ios             build the iPhone app for the simulator
#   ./build.sh ios run         build, install and launch it on a simulator
#   ./build.sh ios device      build signed for a paired iPhone, and list what is paired
#   ./build.sh ios test        SolarKit's gates against the JPL fixtures
#   ./build.sh generate        regenerate the Swift tables from the TypeScript engine
#   ./build.sh conformance     regenerate the cross-platform conformance suite
#
# `set -o pipefail` with explicit status capture, because a piped command's exit code is the
# pipeline's, not the command's, and reading the wrong one is how a red build gets reported
# green. That happened twice on this project before this script existed.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SIMULATOR="${SOLAR_SIMULATOR:-iPhone 17 Pro}"
BUNDLE_ID="com.sobytes.solar"

failed=0

step() {
  local name="$1"
  shift
  printf '%-22s ' "$name"
  if output=$("$@" 2>&1); then
    printf 'ok\n'
  else
    printf 'FAILED\n'
    printf '%s\n' "$output" | tail -30
    failed=1
  fi
}

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing: %s\n%s\n' "$1" "$2"
    exit 1
  fi
}

usage() {
  sed -n '3,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  printf '\nplatforms\n'
  printf '  website   Next.js, the reference client. Imports @solar/engine directly.\n'
  printf '  ios       iPhone, SwiftUI + SceneKit over SolarKit. A hand-port; see contracts/.\n'
  printf '  android   not started\n'
  printf '  tv        not started\n'
}

generate_swift() {
  require node "install Node, then run npm install"
  npx tsx mobile/ios/SolarKit/generate.mjs
}

case "${1:-}" in
  ""|help|-h|--help)
    usage
    ;;

  check)
    step "typecheck engine" npm run --silent typecheck --workspace engine
    step "typecheck website" npm run --silent typecheck --workspace website
    step "lint" npx eslint .
    step "tests" npx vitest run
    if command -v swift >/dev/null 2>&1; then
      # Release, not debug. Measured: 0.6 s against 61.7 s, a factor of 99. The physics loops
      # are completely dominated by debug-mode bounds checking and ARC traffic, so a debug
      # test run is measuring Swift's debug overhead rather than the integrator. The same
      # applies to the app: mutual gravity is unusable in a debug build.
      step "swift SolarKit" swift test -c release --package-path mobile/ios/SolarKit
    else
      printf '%-22s skipped, no swift toolchain\n' "swift SolarKit"
    fi
    if [ "$failed" -ne 0 ]; then
      printf '\nat least one gate failed\n'
      exit 1
    fi
    printf '\nall gates green\n'
    ;;

  generate)
    generate_swift
    ;;

  conformance)
    require node "install Node, then run npm install"
    # The cases are committed, so regenerating is a deliberate act: it says the engine's
    # answers changed and every port now needs to agree with the new ones.
    npx tsx scripts/generate-conformance.mjs
    ;;

  website)
    case "${2:-build}" in
      dev)
        lsof -ti:3000 | xargs kill -9 2>/dev/null
        npm run dev
        ;;
      build) npm run build ;;
      test) npx vitest run ;;
      *) printf 'unknown: website %s\n' "$2"; exit 1 ;;
    esac
    ;;

  ios)
    require xcodebuild "install Xcode from the App Store"
    require xcodegen "brew install xcodegen"
    # The .xcodeproj is generated from project.yml and is not committed, so regenerate it
    # before every build rather than trusting whatever is on disk.
    (cd mobile/ios && xcodegen generate) || exit 1

    case "${2:-build}" in
      build)
        xcodebuild -project mobile/ios/Solar.xcodeproj -scheme Solar \
          -destination 'generic/platform=iOS Simulator' -configuration Debug build \
          | grep -E 'error:|warning:|BUILD' || true
        ;;
      test)
        swift test -c release --package-path mobile/ios/SolarKit
        ;;
      device)
        # Signed as SOBYTES LTD, team pinned in project.yml. -allowProvisioningUpdates lets
        # Xcode create or refresh the team profile rather than failing on a missing one.
        udid="${3:-}"
        if [ -z "$udid" ]; then
          # Matched by the UDID's own shape, not by column position. devicectl pads its
          # columns with spaces and the model name contains spaces too, so counting fields
          # from the end lands on a word of the model rather than on the identifier.
          udid=$(xcrun devicectl list devices 2>/dev/null \
            | grep "physical" | grep "available" \
            | grep -oE '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}' | head -1)
        fi
        if [ -z "$udid" ]; then
          printf 'no paired iPhone found. Pair one, or pass its UDID:\n'
          printf '  ./build.sh ios device <UDID>\n\n'
          xcrun devicectl list devices 2>/dev/null | head -20
          exit 1
        fi
        printf 'building for device %s\n' "$udid"
        xcodebuild -project mobile/ios/Solar.xcodeproj -scheme Solar \
          -destination "id=$udid" -configuration Debug -allowProvisioningUpdates build \
          | grep -E 'error:|Provisioning Profile|BUILD' || true
        ;;
      run)
        xcodebuild -project mobile/ios/Solar.xcodeproj -scheme Solar \
          -destination 'generic/platform=iOS Simulator' -configuration Debug build \
          >/dev/null || { printf 'build failed\n'; exit 1; }
        udid=$(xcrun simctl list devices available \
          | grep -m1 "$SIMULATOR (" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
        if [ -z "$udid" ]; then
          printf 'no simulator named "%s". Set SOLAR_SIMULATOR to one of:\n' "$SIMULATOR"
          xcrun simctl list devices available | grep -E "iPhone|iPad" | sed 's/^/  /'
          exit 1
        fi
        app=$(find ~/Library/Developer/Xcode/DerivedData -name 'Solar.app' \
          -path '*Debug-iphonesimulator*' -maxdepth 5 2>/dev/null | head -1)
        [ -n "$app" ] || { printf 'built app not found\n'; exit 1; }
        xcrun simctl boot "$udid" 2>/dev/null
        open -a Simulator
        xcrun simctl install "$udid" "$app"
        xcrun simctl launch "$udid" "$BUNDLE_ID"
        printf 'running on %s\n' "$SIMULATOR"
        ;;
      *) printf 'unknown: ios %s\n' "$2"; exit 1 ;;
    esac
    ;;

  android|tv)
    printf '%s is not started. See %s/README.md for what it has to provide.\n' "$1" "$1"
    exit 1
    ;;

  *)
    printf 'unknown platform: %s\n\n' "$1"
    usage
    exit 1
    ;;
esac
