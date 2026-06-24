#!/usr/bin/env bash
# ============================================================
# wear-emu.sh – Wear OS Emulator Helper for PiMobile
#
# Usage:
#   ./scripts/wear-emu.sh start [round|square]   — Start emulator
#   ./scripts/wear-emu.sh stop                    — Stop emulator
#   ./scripts/wear-emu.sh install                — Build & install APK
#   ./scripts/wear-emu.sh logcat                 — Tail device logs
#   ./scripts/wear-emu.sh shell                  — Interactive adb shell
#   ./scripts/wear-emu.sh status                 — Show device status
#   ./scripts/wear-emu.sh uninstall              — Remove app from device
#   ./scripts/wear-emu.sh build-only             — Build APK without installing
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AVD_ROUND="wear_round_35"
AVD_SQUARE="wear_square_35"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
EMULATOR="$ANDROID_HOME/emulator/emulator"
ADB="$ANDROID_HOME/platform-tools/adb"
AVDMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
BUILD_DIR="$SCRIPT_DIR/wear-os-app"

export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# --- Ensure adb server is running ---
ensure_adb() {
    "$ADB" start-server >/dev/null 2>&1 || true
}

# --- Find emulator serial (ignores physical devices) ---
emulator_serial() {
    "$ADB" devices | awk 'NR>1 && $2=="device" && $1 ~ /^emulator-/ {print $1}' | head -1
}

# --- Get first available device (prefer emulator) ---
any_serial() {
    local emu
    emu=$(emulator_serial)
    if [ -n "$emu" ]; then
        echo "$emu"
    else
        "$ADB" devices | awk 'NR>1 && $2=="device" {print $1}' | head -1
    fi
}

# --- Wait for emulator to fully boot ---
wait_for_boot() {
    local serial="$1"
    echo "⏳ Waiting for emulator to boot..."
    "$ADB" -s "$serial" wait-for-device
    for i in $(seq 1 60); do
        local boot
        boot=$("$ADB" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')
        if [ "$boot" = "1" ]; then
            echo "✅ Emulator is ready (boot completed in ~${i}s)"
            # Wake up the screen
            "$ADB" -s "$serial" shell input keyevent 26 2>/dev/null || true  # power button
            "$ADB" -s "$serial" shell input keyevent 82 2>/dev/null || true  # unlock
            return 0
        fi
        sleep 2
    done
    echo "⚠️  Emulator may still be booting (timeout after 120s)"
}

case "${1:-help}" in
    start)
        AVD_NAME="$AVD_ROUND"
        [ "${2:-}" = "square" ] && AVD_NAME="$AVD_SQUARE"
        [ "${2:-}" = "round" ] && AVD_NAME="$AVD_ROUND"

        # Check if emulator is already running
        EXISTING=$(emulator_serial)
        if [ -n "$EXISTING" ]; then
            echo "✅ Emulator already running: $EXISTING"
            echo "   Use '$0 stop' first to restart."
            exit 0
        fi

        echo "🚀 Starting Wear OS emulator: $AVD_NAME"
        ensure_adb

        # Launch emulator in background
        "$EMULATOR" -avd "$AVD_NAME" -no-snapshot -no-audio -no-boot-anim \
            -netdelay none -netspeed full -gpu swiftshader_indirect &
        EMU_PID=$!
        echo "📟 Emulator PID: $EMU_PID"

        # Wait for the emulator to appear in adb
        for i in $(seq 1 30); do
            SERIAL=$(emulator_serial)
            if [ -n "$SERIAL" ]; then
                echo "📱 Emulator serial: $SERIAL"
                break
            fi
            sleep 2
        done

        if [ -z "${SERIAL:-}" ]; then
            echo "❌ Emulator not detected by adb after 60s"
            exit 1
        fi

        # Wait for full boot
        wait_for_boot "$SERIAL"
        ;;
    stop)
        echo "🛑 Stopping emulator..."
        ensure_adb
        SERIAL=$(emulator_serial)
        if [ -n "$SERIAL" ]; then
            "$ADB" -s "$SERIAL" emu kill 2>/dev/null || true
            echo "  Sent kill to $SERIAL"
        fi
        # Also kill any emulator processes
        pkill -f "emulator.*avd" 2>/dev/null || true
        echo "✅ Stopped"
        ;;
    build-only)
        echo "📦 Building PiMobile Wear APK..."
        cd "$BUILD_DIR"
        ./gradlew assembleDebug
        echo "✅ Build complete: $BUILD_DIR/app/build/outputs/apk/debug/app-debug.apk"
        ;;
    install)
        echo "📦 Building PiMobile Wear APK..."
        cd "$BUILD_DIR"
        ./gradlew assembleDebug

        SERIAL=$(emulator_serial)
        if [ -z "$SERIAL" ]; then
            echo "❌ No emulator running. Start one first:"
            echo "   ./scripts/wear-emu.sh start [round|square]"
            exit 1
        fi

        echo "📲 Installing APK to $SERIAL..."
        "$ADB" -s "$SERIAL" install -r "$BUILD_DIR/app/build/outputs/apk/debug/app-debug.apk"
        echo "✅ Installed (pimobile.wear)"
        ;;
    uninstall)
        SERIAL=$(emulator_serial)
        if [ -z "$SERIAL" ]; then
            echo "❌ No emulator running."
            exit 1
        fi
        echo "🗑️  Uninstalling pimobile.wear from $SERIAL..."
        "$ADB" -s "$SERIAL" uninstall pimobile.wear
        echo "✅ Uninstalled"
        ;;
    logcat)
        SERIAL=$(emulator_serial)
        if [ -z "$SERIAL" ]; then
            echo "❌ No emulator running."
            exit 1
        fi
        echo "📋 Tailing logcat (pimobile.wear)..."
        "$ADB" -s "$SERIAL" logcat -v time "pimobile.wear:* *:S"
        ;;
    shell)
        SERIAL=$(emulator_serial)
        if [ -z "$SERIAL" ]; then
            echo "❌ No emulator running."
            exit 1
        fi
        echo "📱 Opening shell on $SERIAL"
        exec "$ADB" -s "$SERIAL" shell
        ;;
    status)
        echo "=== Emulator Status ==="
        ensure_adb
        echo ""
        echo "Devices:"
        "$ADB" devices
        echo ""
        EMU=$(emulator_serial)
        if [ -n "$EMU" ]; then
            echo "Wear Emulator: ✅ $EMU"
            echo "  SDK: $("$ADB" -s "$EMU" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')"
            echo "  Release: $("$ADB" -s "$EMU" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')"
            echo "  App installed: $("$ADB" -s "$EMU" shell pm list packages pimobile.wear 2>/dev/null | grep -c pimobile || echo "no")"
        else
            echo "Wear Emulator: ❌ Not running"
        fi
        echo ""
        echo "Available AVDs:"
        "$AVDMANAGER" list avd 2>/dev/null || true
        ;;
    *)
        echo "Wear OS Emulator Helper for PiMobile"
        echo ""
        echo "Usage:"
        echo "  $0 start [round|square]   — Start emulator (default: round)"
        echo "  $0 stop                    — Stop emulator"
        echo "  $0 install                — Build & install APK"
        echo "  $0 build-only             — Build APK only (no install)"
        echo "  $0 uninstall              — Remove app from device"
        echo "  $0 logcat                 — Tail device logs (pimobile.wear)"
        echo "  $0 shell                  — Interactive adb shell"
        echo "  $0 status                 — Show device status"
        ;;
esac
