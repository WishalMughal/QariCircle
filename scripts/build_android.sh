#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || "$1" != https://* ]]; then
  echo 'Usage: bash scripts/build_android.sh https://your-api-domain.example/api' >&2
  exit 2
fi
if ! command -v flutter >/dev/null; then
  echo 'Flutter SDK not available: install Flutter and Android SDK first.' >&2
  exit 3
fi
cd "$(dirname "$0")/../flutter_app"
flutter create . --platforms=android --project-name quran_academy
flutter pub get
flutter analyze
flutter test
flutter build apk --release --dart-define="API_BASE=$1"
echo 'APK should be in flutter_app/build/app/outputs/flutter-apk/app-release.apk'
echo 'For store releases, configure your OWN Android signing key and Play Console requirements.'
