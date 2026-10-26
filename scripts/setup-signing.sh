#!/usr/bin/env sh
# Create a release keystore once and print the values to paste into
# GitHub -> Settings -> Secrets and variables -> Actions.
# Keep release.jks and the passwords somewhere safe: Play needs the same key for every update.
set -eu
ALIAS="${1:-roadside}"
if [ ! -f release.jks ]; then
  keytool -genkeypair -v -keystore release.jks -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000
fi
echo "ANDROID_KEYSTORE_BASE64:"
base64 -w0 release.jks 2>/dev/null || base64 release.jks
echo
echo "ANDROID_KEY_ALIAS: $ALIAS"
echo "ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_PASSWORD: the passwords you just typed"
