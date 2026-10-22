#!/bin/zsh
cd "${0:A:h}" || { print -u2 'Le dossier du logiciel est indisponible. Rebranchez son disque puis réessayez.'; exit 1; }
if [[ -x .runtime/bin/node ]]; then
  exec .runtime/bin/node launch.mjs
elif [[ -x /opt/homebrew/bin/node ]]; then
  exec /opt/homebrew/bin/node launch.mjs
elif command -v node >/dev/null 2>&1; then
  exec node launch.mjs
else
  print -u2 'Node.js est introuvable. Relancez install.sh pour préparer le logiciel et son moteur.'
  exit 1
fi
