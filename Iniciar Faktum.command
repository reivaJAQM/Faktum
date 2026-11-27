#!/bin/zsh
set -euo pipefail

# Ir a la carpeta del proyecto (donde vive este archivo .command)
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

on_error() {
  echo ""
  echo "❌ Ocurrió un error al iniciar Faktum."
  echo "Presiona Enter para cerrar esta ventana..."
  read -r
}
trap on_error ERR

echo "========================================"
echo "        Iniciando Faktum..."
echo "========================================"

# Cargar rutas comunes y gestores de Node (Finder abre shell no interactivo)
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.volta/bin:$PATH"

if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell zsh)"
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  source "$HOME/.nvm/nvm.sh"
elif ! command -v node >/dev/null 2>&1 && [ -f "$HOME/.zshrc" ]; then
  source "$HOME/.zshrc" >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "❌ No se encontró Node.js o npm en el PATH."
  echo "Verifica tu instalación de Node/fnm."
  exit 1
fi

# Instalar dependencias solo si falta node_modules
if [ ! -d "node_modules" ] || [ ! -x "node_modules/.bin/electron" ]; then
  echo "📦 Instalando dependencias..."
  npm install
fi

# Asegurar que el nombre e ícono en el Dock de macOS sea "Faktum"
if [ -f "scripts/brand-mac-dev.sh" ]; then
  bash scripts/brand-mac-dev.sh >/dev/null 2>&1 || true
fi

# Modo desarrollo opcional si se ejecuta con --dev
if [[ "${1:-}" == "--dev" ]]; then
  echo "🛠️  Iniciando en modo desarrollo..."
  npm run dev
  exit 0
fi

# Compilar solo si falta dist/ o si hubo cambios en src/ o configuración
NEEDS_BUILD=0

if [[ "${1:-}" == "--build" || "${1:-}" == "-b" ]]; then
  NEEDS_BUILD=1
elif [ ! -f "dist/main/index.js" ] || [ ! -f "dist/preload/index.js" ] || [ ! -f "dist/renderer/index.html" ]; then
  NEEDS_BUILD=1
elif [ -n "$(find src -type f \( -newer dist/main/index.js -o -newer dist/renderer/index.html \) -print -quit 2>/dev/null)" ]; then
  NEEDS_BUILD=1
elif [ "package.json" -nt "dist/main/index.js" ] || [ "vite.config.ts" -nt "dist/renderer/index.html" ] || [ "tsconfig.main.json" -nt "dist/main/index.js" ]; then
  NEEDS_BUILD=1
fi

if [ "$NEEDS_BUILD" -eq 1 ]; then
  echo "🔨 Compilando cambios recientes..."
  npm run build
else
  echo "⚡ Sin cambios pendientes, iniciando directamente..."
fi

echo "🚀 Abriendo Faktum..."
./node_modules/.bin/electron .
