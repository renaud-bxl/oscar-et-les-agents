#!/bin/sh
# macOS / Linux. No administrator access or global package installation.
set -eu
umask 077

oscar_engine=''
oscar_dir="${HOME:?Le dossier personnel est introuvable.}/.local/share/oscar-et-les-agents"
oscar_skip_login=0
oscar_no_open=0
oscar_dry_run=0
oscar_temp=''

oscar_fail() { printf '%s\n' "Installation interrompue : $*" >&2; exit 1; }
oscar_help() {
  cat <<'HELP'
Oscar et les agents — installation macOS et Linux

  sh install.sh [--engine codex|claude|both] [--dir /chemin/absolu]
                [--skip-login] [--no-open] [--dry-run]

  --engine       ChatGPT avec Codex, Claude, ou les deux moteurs.
  --dir          Dossier d’installation ; les missions existantes sont conservées.
  --skip-login   Reporter la connexion à votre abonnement.
  --no-open      Installer sans ouvrir le bureau.
  --dry-run      Montrer les opérations sans rien installer.
HELP
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --engine) [ "$#" -ge 2 ] || oscar_fail 'Précisez le moteur après --engine.'; oscar_engine=$2; shift 2 ;;
    --engine=*) oscar_engine=${1#*=}; shift ;;
    --dir) [ "$#" -ge 2 ] || oscar_fail 'Précisez le dossier après --dir.'; oscar_dir=$2; shift 2 ;;
    --dir=*) oscar_dir=${1#*=}; shift ;;
    --skip-login) oscar_skip_login=1; shift ;;
    --no-open) oscar_no_open=1; shift ;;
    --dry-run) oscar_dry_run=1; shift ;;
    --help|-h) oscar_help; exit 0 ;;
    *) oscar_fail "Option inconnue : $1. Utilisez --help." ;;
  esac
done

case "$(uname -s)" in
  Darwin) oscar_system=darwin ;;
  Linux) oscar_system=linux ;;
  *) oscar_fail 'Cet installateur automatique fonctionne sur macOS et Linux.' ;;
esac

if [ -z "$oscar_engine" ]; then
  printf '\n%s\n%s\n%s\n%s\n' 'Quel abonnement souhaitez-vous utiliser ?' '  1. ChatGPT avec Codex' '  2. Claude' '  3. Les deux'
  if [ -t 0 ]; then
    printf '%s' 'Votre choix [1] : '
    IFS= read -r oscar_answer || oscar_fail 'Choix interrompu.'
  elif ( : </dev/tty ) 2>/dev/null; then
    printf '%s' 'Votre choix [1] : ' >/dev/tty
    IFS= read -r oscar_answer </dev/tty || oscar_fail 'Choix interrompu.'
  else
    oscar_fail 'Aucun terminal interactif. Ajoutez --engine codex, --engine claude ou --engine both.'
  fi
  case "$oscar_answer" in
    ''|1|codex|chatgpt|ChatGPT) oscar_engine=codex ;;
    2|claude|Claude) oscar_engine=claude ;;
    3|both|deux) oscar_engine=both ;;
    *) oscar_fail 'Choisissez 1, 2 ou 3, puis relancez l’installation.' ;;
  esac
fi
case "$oscar_engine" in codex|claude|both) ;; *) oscar_fail 'Le moteur doit être codex, claude ou both.' ;; esac

# Reject ambiguous paths and symbolic-link parents before creating anything.
while [ "$oscar_dir" != / ] && [ "${oscar_dir%/}" != "$oscar_dir" ]; do oscar_dir=${oscar_dir%/}; done
case "$oscar_dir" in
  /*) ;;
  *) oscar_fail 'Le dossier d’installation doit être un chemin absolu.' ;;
esac
case "${oscar_dir#/}" in
  */*) ;;
  *) oscar_fail 'Choisissez un sous-dossier réservé à Oscar et les agents.' ;;
esac
case "$oscar_dir/" in
  *'/../'*|*'/./'*|*'//'*) oscar_fail 'Le chemin contient un raccourci de dossier ambigu.' ;;
esac
case "$oscar_dir" in
  /|"$HOME"|/Users|/Volumes|/private|/private/tmp|/private/var|/private/var/tmp|/tmp|/var|/var/tmp|/opt|/home|/Applications|/Library|/System|/usr|/usr/local|/bin|/sbin|/etc|/dev|/proc|/sys|/root)
    oscar_fail 'Choisissez un sous-dossier réservé à Oscar et les agents.' ;;
  /System/*|/Library/*|/Applications/*|/usr/*|/bin/*|/sbin/*|/etc/*|/private/etc|/private/etc/*|/dev/*|/proc/*|/sys/*|/root/*)
    oscar_fail 'Ce dossier système ne peut pas servir à l’installation.' ;;
esac
oscar_check_parents() {
  oscar_check=$1
  while [ "$oscar_check" != / ]; do
    [ ! -L "$oscar_check" ] || oscar_fail 'Le dossier ou un de ses parents est un lien symbolique. Choisissez son chemin réel.'
    [ ! -e "$oscar_check" ] || [ -d "$oscar_check" ] || oscar_fail 'Un fichier occupe le chemin du dossier d’installation.'
    oscar_check=$(dirname "$oscar_check")
  done
}
oscar_check_parents "$oscar_dir"
for oscar_internal in .runtime .runtime/bin .tools .tools/node_modules .tools/node_modules/.bin data; do
  [ ! -L "$oscar_dir/$oscar_internal" ] || oscar_fail 'Un dossier interne est un lien symbolique. Utilisez un dossier d’installation sain.'
done

if [ "$oscar_dry_run" -eq 1 ]; then
  printf '\n%s\n%s\n%s\n' "Simulation : installer Oscar et les agents dans $oscar_dir." "Moteur choisi : $oscar_engine." 'Le programme vérifiera Node.js, installera les moteurs manquants localement et ouvrira leur connexion officielle. Aucun changement effectué.'
  exit 0
fi

mkdir -p "$oscar_dir"
oscar_check_parents "$oscar_dir"
oscar_temp=$(mktemp -d "${TMPDIR:-/tmp}/oscar-install.XXXXXXXX") || oscar_fail 'Impossible de préparer un dossier temporaire.'
oscar_cleanup() { [ -z "$oscar_temp" ] || rm -rf "$oscar_temp"; }
trap oscar_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

oscar_node_usable() {
  [ -x "$1" ] && "$1" -e 'var v=process.versions.node.split(".").map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=18)?0:1)' >/dev/null 2>&1
}
oscar_node=''
if oscar_node_usable "$oscar_dir/.runtime/bin/node"; then
  oscar_node="$oscar_dir/.runtime/bin/node"
elif [ ! -e "$oscar_dir/.runtime/bin/node" ]; then
  oscar_system_node=$(command -v node 2>/dev/null || true)
  if [ -n "$oscar_system_node" ] && oscar_node_usable "$oscar_system_node"; then oscar_node=$oscar_system_node; fi
fi

oscar_download() {
  command -v curl >/dev/null 2>&1 || oscar_fail 'Le programme curl est nécessaire pour télécharger les fichiers officiels.'
  curl --fail --location --silent --show-error --retry 2 --connect-timeout 20 --max-time 300 --proto '=https' --proto-redir '=https' --tlsv1.2 "$1" -o "$2" || oscar_fail 'Le téléchargement a échoué. Vérifiez votre connexion Internet.'
}

if [ -z "$oscar_node" ]; then
  case "$(uname -m)" in
    arm64|aarch64) oscar_arch=arm64 ;;
    x86_64|amd64) oscar_arch=x64 ;;
    *) oscar_fail 'Cette architecture ne dispose pas du programme Node.js portable prévu par cet installateur.' ;;
  esac
  printf '\n%s\n' 'Préparation de Node.js 24 depuis le site officiel…'
  oscar_download 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' "$oscar_temp/SHASUMS256.txt"
  oscar_suffix="-$oscar_system-$oscar_arch.tar.gz"
  oscar_archive=$(awk -v suffix="$oscar_suffix" '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-/ && substr($2,length($2)-length(suffix)+1)==suffix {print $2;exit}' "$oscar_temp/SHASUMS256.txt")
  [ -n "$oscar_archive" ] || oscar_fail 'La version officielle de Node.js pour cet ordinateur est introuvable.'
  oscar_expected=$(awk -v archive="$oscar_archive" '$2==archive {print $1;exit}' "$oscar_temp/SHASUMS256.txt")
  [ "${#oscar_expected}" -eq 64 ] || oscar_fail 'La somme de vérification officielle est invalide.'
  case "$oscar_expected" in *[!0-9a-fA-F]*) oscar_fail 'La somme de vérification officielle est invalide.' ;; esac
  oscar_download "https://nodejs.org/dist/latest-v24.x/$oscar_archive" "$oscar_temp/node.tar.gz"
  if command -v shasum >/dev/null 2>&1; then
    oscar_actual=$(shasum -a 256 "$oscar_temp/node.tar.gz" | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    oscar_actual=$(sha256sum "$oscar_temp/node.tar.gz" | awk '{print $1}')
  else
    oscar_fail 'Un outil de vérification SHA-256 est nécessaire : shasum ou sha256sum.'
  fi
  [ "$oscar_actual" = "$oscar_expected" ] || oscar_fail 'Le téléchargement de Node.js ne correspond pas à sa somme officielle. Aucun programme téléchargé n’a été exécuté.'
  mkdir "$oscar_temp/runtime"
  tar -xzf "$oscar_temp/node.tar.gz" -C "$oscar_temp/runtime" --strip-components=1 || oscar_fail 'Impossible de décompresser Node.js.'
  oscar_node_usable "$oscar_temp/runtime/bin/node" || oscar_fail 'Le programme Node.js téléchargé ne fonctionne pas sur cet ordinateur.'
  if [ -e "$oscar_dir/.runtime" ]; then mv "$oscar_dir/.runtime" "$oscar_temp/previous-runtime"; fi
  if ! mv "$oscar_temp/runtime" "$oscar_dir/.runtime"; then
    if [ -d "$oscar_temp/previous-runtime" ]; then mv "$oscar_temp/previous-runtime" "$oscar_dir/.runtime"; fi
    oscar_fail 'Impossible de mettre Node.js en place.'
  fi
  oscar_node="$oscar_dir/.runtime/bin/node"
fi
PATH="$(dirname "$oscar_node"):$PATH"
export PATH

oscar_valid_source() {
  [ -f "$1/package.json" ] && [ -f "$1/server.mjs" ] && [ -f "$1/scripts/install.mjs" ] && "$oscar_node" -e 'try {var fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[1]+"/package.json","utf8"));process.exit(p&&typeof p==="object"&&!Array.isArray(p)&&["oscar-et-les-agents","atelier-des-agents"].indexOf(p.name)>=0?0:1)}catch(e){process.exit(1)}' "$1" >/dev/null 2>&1
}
oscar_source=''
if [ -f "$0" ]; then
  oscar_script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
  if oscar_valid_source "$oscar_script_dir"; then oscar_source=$oscar_script_dir; fi
fi
if [ -z "$oscar_source" ] && oscar_valid_source "$PWD"; then oscar_source=$PWD; fi
if [ -z "$oscar_source" ]; then
  printf '\n%s\n' 'Téléchargement de Oscar et les agents…'
  oscar_download 'https://codeload.github.com/renaud-bxl/oscar-et-les-agents/tar.gz/refs/heads/main' "$oscar_temp/source.tar.gz"
  mkdir "$oscar_temp/source"
  tar -xzf "$oscar_temp/source.tar.gz" -C "$oscar_temp/source" --strip-components=1 || oscar_fail 'Impossible de décompresser le logiciel.'
  oscar_source="$oscar_temp/source"
  oscar_valid_source "$oscar_source" || oscar_fail 'Le téléchargement ne contient pas une installation valide.'
fi

printf '\n%s\n' 'Mise en place du bureau ; vos missions existantes sont conservées…'
"$oscar_node" - "$oscar_source" "$oscar_dir" <<'COPY_SOURCE'
const fs = require('node:fs');
const path = require('node:path');
try {
  const source = fs.realpathSync(process.argv[2]);
  const destination = fs.realpathSync(process.argv[3]);
  if (source === destination) process.exit(0);
  if (destination.startsWith(source + path.sep) || source.startsWith(destination + path.sep)) throw new Error('Choisissez un dossier d’installation extérieur au dossier source.');
  const entries = [];
  const excluded = new Set(['data', 'node_modules', '.runtime', '.tools', '__pycache__']);
  const list = (relative = '') => {
    for (const name of fs.readdirSync(path.join(source, relative))) {
      if ((name.startsWith('.') && name !== '.gitignore') || excluded.has(name) || name.endsWith('.log')) continue;
      const child = path.join(relative, name);
      const from = path.join(source, child);
      const to = path.join(destination, child);
      const info = fs.lstatSync(from);
      if (info.isSymbolicLink()) throw new Error('Un lien symbolique est présent dans les fichiers source. Installation arrêtée.');
      let target;
      try { target = fs.lstatSync(to); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (target?.isSymbolicLink()) throw new Error('Un fichier de destination est un lien symbolique. Installation arrêtée.');
      if (target && info.isDirectory() !== target.isDirectory()) throw new Error('Un fichier existant empêche la mise à jour du logiciel.');
      if (!info.isDirectory() && !info.isFile()) throw new Error('Un fichier source ne peut pas être copié.');
      entries.push({ from, to, directory: info.isDirectory(), mode: info.mode & 0o777 });
      if (info.isDirectory()) list(child);
    }
  };
  list();
  for (const entry of entries) {
    if (entry.directory) fs.mkdirSync(entry.to, { recursive: true });
    else { fs.copyFileSync(entry.from, entry.to); fs.chmodSync(entry.to, entry.mode); }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
COPY_SOURCE

set -- --engine "$oscar_engine"
[ "$oscar_skip_login" -eq 0 ] || set -- "$@" --skip-login
[ "$oscar_no_open" -eq 0 ] || set -- "$@" --no-open
# A piped bootstrap must give the official browser login its own terminal input.
if [ -t 0 ] || [ "$oscar_skip_login" -eq 1 ]; then
  "$oscar_node" "$oscar_dir/scripts/install.mjs" "$@"
elif ( : </dev/tty ) 2>/dev/null; then
  "$oscar_node" "$oscar_dir/scripts/install.mjs" "$@" </dev/tty
else
  oscar_fail 'La connexion nécessite un terminal interactif. Relancez depuis un terminal ou ajoutez --skip-login pour la reporter.'
fi
