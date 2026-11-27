#!/usr/bin/env bash
set -euo pipefail

REPO="reivaJAQM/Faktum"
APP_NAME="Faktum"
OS="$(uname -s)"
ARCH="$(uname -m)"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

download_asset() {
  local asset="$1"
  local dest="$2"
  local url="https://github.com/${REPO}/releases/latest/download/${asset}"
  echo "Descargando ${asset}..."
  curl -fL --progress-bar "$url" -o "$dest"
}

install_macos() {
  local asset
  case "$ARCH" in
    arm64|aarch64) asset="Faktum-mac-arm64.zip" ;;
    x86_64|amd64)  asset="Faktum-mac-x64.zip" ;;
    *)
      echo "Arquitectura no soportada en macOS: $ARCH" >&2
      exit 1
      ;;
  esac

  local zip_path="${TMP_DIR}/${asset}"
  local extract_dir="${TMP_DIR}/extract"
  mkdir -p "$extract_dir"

  download_asset "$asset" "$zip_path"

  echo "Extrayendo ${APP_NAME}.app..."
  ditto -xk "$zip_path" "$extract_dir"

  local app_src
  app_src="$(find "$extract_dir" -maxdepth 2 -name "${APP_NAME}.app" -type d | head -n 1)"
  if [ -z "$app_src" ] || [ ! -d "$app_src" ]; then
    echo "No se encontró ${APP_NAME}.app en el paquete descargado." >&2
    exit 1
  fi

  local target_dir="/Applications"
  if [ ! -w "$target_dir" ]; then
    target_dir="${HOME}/Applications"
    mkdir -p "$target_dir"
  fi
  local target_app="${target_dir}/${APP_NAME}.app"

  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
  sleep 0.5

  rm -rf "$target_app"
  mv "$app_src" "$target_app"
  xattr -cr "$target_app" 2>/dev/null || true

  local lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  if [ -x "$lsregister" ]; then
    "$lsregister" -f "$target_app" >/dev/null 2>&1 || true
  fi

  echo "${APP_NAME} instalado correctamente en: ${target_app}"
}

install_linux() {
  case "$ARCH" in
    x86_64|amd64) ;;
    *)
      echo "Arquitectura no soportada en Linux: $ARCH" >&2
      exit 1
      ;;
  esac

  local asset="Faktum-linux-x64.tar.gz"
  local tar_path="${TMP_DIR}/${asset}"
  local extract_dir="${TMP_DIR}/extract"
  mkdir -p "$extract_dir"

  download_asset "$asset" "$tar_path"

  echo "Extrayendo archivos..."
  tar -xzf "$tar_path" -C "$extract_dir"

  local bin_file
  bin_file="$(find "$extract_dir" -maxdepth 3 -name "faktum" -type f | head -n 1)"
  if [ -z "$bin_file" ]; then
    echo "No se encontró el binario de ${APP_NAME} en el paquete descargado." >&2
    exit 1
  fi
  local src_dir
  src_dir="$(dirname "$bin_file")"

  local install_dir="${HOME}/.local/opt/faktum"
  local bin_dir="${HOME}/.local/bin"
  local apps_dir="${HOME}/.local/share/applications"

  mkdir -p "$(dirname "$install_dir")" "$bin_dir" "$apps_dir"
  rm -rf "$install_dir"
  mv "$src_dir" "$install_dir"
  chmod +x "${install_dir}/faktum"

  ln -sf "${install_dir}/faktum" "${bin_dir}/faktum"

  local icon_path="${install_dir}/resources/icon.png"
  cat > "${apps_dir}/faktum.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=${APP_NAME}
Comment=Descargador masivo de comprobantes electrónicos del SRI
Exec="${install_dir}/faktum" %U
Icon=${icon_path}
Terminal=false
Categories=Office;Finance;
StartupNotify=true
StartupWMClass=Faktum
EOF
  chmod +x "${apps_dir}/faktum.desktop"

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$apps_dir" >/dev/null 2>&1 || true
  fi

  echo "${APP_NAME} instalado correctamente en: ${install_dir}"
}

case "$OS" in
  Darwin) install_macos ;;
  Linux)  install_linux ;;
  *)
    echo "Sistema operativo no soportado por este script: $OS" >&2
    exit 1
    ;;
esac
