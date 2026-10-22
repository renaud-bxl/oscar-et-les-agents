#!/bin/sh
# macOS / Linux. No administrator access or global package installation.
set -eu
umask 077

oscar_engine=''
oscar_dir="${HOME:?Le dossier personnel est introuvable.}/.local/share/oscar-et-les-agents"
oscar_dir_explicit=0
oscar_data_dir=''
oscar_skip_login=0
oscar_no_open=0
oscar_dry_run=0
oscar_temp=''

oscar_fail() { printf '%s\n' "Installation interrompue : $*" >&2; exit 1; }
oscar_help() {
  cat <<'HELP'
Oscar et les agents — installation macOS et Linux

  sh install.sh [--engine codex|claude|both] [--dir /chemin/absolu]
                [--data-dir /chemin/absolu]
                [--skip-login] [--no-open] [--dry-run]

  --engine       ChatGPT avec Codex, Claude, ou les deux moteurs.
  --dir          Dossier d’installation ; les missions existantes sont conservées.
                 Sans cette option, un assistant propose les disques disponibles.
  --data-dir     Dossier des missions, documents et voix, mémorisé pour les relances.
                 Un SSD doit être monté. Aucun ancien dossier n’est déplacé.
  --skip-login   Reporter la connexion à votre abonnement.
  --no-open      Installer sans ouvrir le bureau.
  --dry-run      Montrer les opérations sans rien installer.
HELP
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --engine) [ "$#" -ge 2 ] || oscar_fail 'Précisez le moteur après --engine.'; oscar_engine=$2; shift 2 ;;
    --engine=*) oscar_engine=${1#*=}; shift ;;
    --dir) [ "$#" -ge 2 ] || oscar_fail 'Précisez le dossier après --dir.'; oscar_dir=$2; oscar_dir_explicit=1; shift 2 ;;
    --dir=*) oscar_dir=${1#*=}; oscar_dir_explicit=1; shift ;;
    --data-dir) [ "$#" -ge 2 ] || oscar_fail 'Précisez le dossier après --data-dir.'; oscar_data_dir=$2; shift 2 ;;
    --data-dir=*) oscar_data_dir=${1#*=}; shift ;;
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

# Never read answers from a downloaded script's stdin. The controlling terminal
# remains separate from the pipe, and no directory is created before consent.
oscar_has_terminal=0
if [ -t 0 ]; then
  exec 3<&0
  oscar_has_terminal=1
elif ( : </dev/tty ) 2>/dev/null; then
  exec 3</dev/tty
  oscar_has_terminal=1
fi
oscar_ask() {
  [ "$oscar_has_terminal" -eq 1 ] || oscar_fail 'Aucun terminal interactif. Indiquez --dir et, si nécessaire, --data-dir avec les chemins choisis.'
  printf '%s' "$1" >&2
  IFS= read -r oscar_answer <&3 || oscar_fail 'Choix interrompu. Aucun emplacement n’a été accepté.'
}
oscar_offer_disk() {
  [ -d "$oscar_disk" ] && [ ! -L "$oscar_disk" ] && [ -w "$oscar_disk" ] || return 0
  # Multi-line and control-character names cannot be a safe terminal choice.
  case "$oscar_disk" in *'
'*|*'\'*|*"$(printf '\r')"*|*"$(printf '\t')"*) return 0 ;; esac
  if printf '%s' "$oscar_disk" | LC_ALL=C grep -q '[[:cntrl:]]'; then return 0; fi
  if [ "$oscar_system" = darwin ]; then
    oscar_device=$(stat -f %d "$oscar_disk" 2>/dev/null) || return 0
    oscar_parent_device=$(stat -f %d "$(dirname "$oscar_disk")" 2>/dev/null) || return 0
  else
    oscar_device=$(stat -c %d "$oscar_disk" 2>/dev/null) || return 0
    oscar_parent_device=$(stat -c %d "$(dirname "$oscar_disk")" 2>/dev/null) || return 0
  fi
  [ "$oscar_device" != "$oscar_parent_device" ] || return 0
  oscar_disk_index=$((oscar_disk_index + 1))
  printf '  %s. %s — %s\n' "$oscar_disk_index" "$(basename "$oscar_disk")" "$oscar_disk"
  oscar_disk_choices="${oscar_disk_choices}${oscar_device}$(printf '\t')${oscar_disk}
"
}
oscar_disks() {
  oscar_disk_index=1
  oscar_disk_choices=''
  if [ "$oscar_system" = darwin ]; then
    for oscar_disk in /Volumes/*; do oscar_offer_disk; done
  else
    for oscar_disk in /media/* /media/*/* /run/media/*/* /mnt/*; do oscar_offer_disk; done
  fi
}
oscar_location_wizard=0
if [ "$oscar_dir_explicit" -eq 0 ] && [ "$oscar_dry_run" -eq 0 ]; then
  [ "$oscar_has_terminal" -eq 1 ] || oscar_fail 'Choisissez le disque d’installation dans un terminal, ou fournissez --dir et --data-dir. Aucun fichier n’a été installé.'
  oscar_location_wizard=1
  printf '\n%s\n%s\n' 'Où installer Oscar et les agents ?' 'Le logiciel, les missions, les documents et les outils facultatifs peuvent rester sur le même disque.'
  oscar_internal_name='Disque de cet ordinateur'
  if [ "$oscar_system" = darwin ] && command -v diskutil >/dev/null 2>&1 && command -v plutil >/dev/null 2>&1; then
    oscar_internal_label=$(diskutil info -plist / 2>/dev/null | plutil -extract VolumeName raw -o - - 2>/dev/null) || oscar_internal_label=''
    if printf '%s' "$oscar_internal_label" | LC_ALL=C grep -q '[[:cntrl:]]'; then oscar_internal_label=''; fi
    [ -z "$oscar_internal_label" ] || oscar_internal_name=$oscar_internal_label
  fi
  printf '  1. %s — %s\n' "$oscar_internal_name" "$HOME"
  oscar_disks
  oscar_other_index=$((oscar_disk_index + 1))
  printf '  %s. Choisir un autre dossier ou disque\n' "$oscar_other_index"
  printf '%s\n' 'Un disque absent de cette liste doit être branché et monté avant de relancer l’installation.'
  oscar_ask 'Votre choix [1] : '
  [ -n "$oscar_answer" ] || oscar_answer=1
  oscar_selected_disk=''
  case "$oscar_answer" in *[!0-9]*|0) oscar_fail 'Choisissez le numéro d’un emplacement proposé.' ;; esac
  if [ "$oscar_answer" != 1 ]; then
    if [ "$oscar_answer" = "$oscar_other_index" ]; then
      if [ "$oscar_system" = darwin ] && command -v osascript >/dev/null 2>&1; then
        printf '%s\n' 'Choisissez un disque ou dossier dans la fenêtre. Un sous-dossier « Oscar et les agents » y sera créé.'
        oscar_selected_disk=$(osascript -e 'POSIX path of (choose folder with prompt "Où installer Oscar et les agents ? Choisissez le disque ou dossier parent ; le logiciel et ses données seront dans un sous-dossier Oscar et les agents.")' 2>/dev/null) || oscar_fail 'Sélection annulée. Aucun fichier n’a été installé.'
      else
        oscar_ask 'Chemin absolu du disque ou dossier parent : '
        oscar_selected_disk=$oscar_answer
      fi
    else
      # Keep the exact menu snapshot: removing another disk must not renumber
      # the selection and silently install on a different device.
      oscar_disk_index=1
      while IFS="$(printf '\t')" read -r oscar_listed_device oscar_disk; do
        [ -n "$oscar_disk" ] || continue
        oscar_disk_index=$((oscar_disk_index + 1))
        if [ "$oscar_answer" = "$oscar_disk_index" ]; then
          oscar_selected_disk=$oscar_disk
          oscar_selected_device=$oscar_listed_device
        fi
      done <<OSCAR_DISK_CHOICES
$oscar_disk_choices
OSCAR_DISK_CHOICES
      [ -n "$oscar_selected_disk" ] || oscar_fail 'Ce disque n’est plus disponible. Rebranchez-le et relancez l’installation.'
    fi
    while [ "$oscar_selected_disk" != / ] && [ "${oscar_selected_disk%/}" != "$oscar_selected_disk" ]; do oscar_selected_disk=${oscar_selected_disk%/}; done
    case "$oscar_selected_disk" in /*) ;; *) oscar_fail 'Choisissez un disque ou un dossier avec un chemin absolu.' ;; esac
    oscar_dir="$oscar_selected_disk/Oscar et les agents/Logiciel"
    if [ -z "$oscar_data_dir" ] && [ ! -e "$oscar_dir/.runtime/installation.json" ]; then
      oscar_data_dir="$oscar_selected_disk/Oscar et les agents/Donnees"
    fi
  elif [ -z "$oscar_data_dir" ] && [ ! -e "$oscar_dir/.runtime/installation.json" ] && [ -z "${OSCAR_DATA_DIR:-}${ATELIER_DATA_DIR:-}" ]; then
    oscar_data_dir="$HOME/Documents/Oscar et les agents"
  fi
fi

if [ -z "$oscar_engine" ]; then
  printf '\n%s\n%s\n%s\n%s\n' 'Quel abonnement souhaitez-vous utiliser ?' '  1. ChatGPT avec Codex' '  2. Claude' '  3. Les deux'
  oscar_ask 'Votre choix [1] : '
  case "$oscar_answer" in
    ''|1|codex|chatgpt|ChatGPT) oscar_engine=codex ;;
    2|claude|Claude) oscar_engine=claude ;;
    3|both|deux) oscar_engine=both ;;
    *) oscar_fail 'Choisissez 1, 2 ou 3, puis relancez l’installation.' ;;
  esac
fi
case "$oscar_engine" in codex|claude|both) ;; *) oscar_fail 'Le moteur doit être codex, claude ou both.' ;; esac

# Reject ambiguous paths and symbolic-link parents before creating anything.
oscar_clean_path() {
  case "$1" in *'
'*|*'\'*|*"$(printf '\r')"*|*"$(printf '\t')"*) oscar_fail 'Le chemin contient un caractère non pris en charge. Choisissez un autre dossier.' ;; esac
  if printf '%s' "$1" | LC_ALL=C grep -q '[[:cntrl:]]'; then oscar_fail 'Le chemin contient un caractère non pris en charge. Choisissez un autre dossier.'; fi
}
oscar_clean_path "$oscar_dir"
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
oscar_check_volume() {
  case "$1" in
    /Volumes/*) [ "$oscar_system" = darwin ] || return 0; oscar_tail=${1#/Volumes/}; oscar_anchor="/Volumes/${oscar_tail%%/*}" ;;
    /media/*|/mnt/*|/run/media/*)
      [ "$oscar_system" = linux ] || return 0
      oscar_anchor=$1
      while [ "$oscar_anchor" != / ]; do
        if [ -d "$oscar_anchor" ] && [ "$(stat -c %d "$oscar_anchor")" != "$(stat -c %d "$(dirname "$oscar_anchor")")" ]; then break; fi
        oscar_anchor=$(dirname "$oscar_anchor")
      done
      ;;
    *) return 0 ;;
  esac
  [ "$oscar_anchor" != / ] && [ -d "$oscar_anchor" ] && [ ! -L "$oscar_anchor" ] || oscar_fail 'Le disque externe choisi n’est pas monté. Rebranchez-le ; aucun dossier de remplacement ne sera créé.'
  if [ "$oscar_system" = darwin ]; then
    [ "$(stat -f %d "$oscar_anchor")" != "$(stat -f %d "$(dirname "$oscar_anchor")")" ] || oscar_fail 'Le disque externe choisi n’est pas monté. Aucun dossier de remplacement ne sera créé.'
  fi
  [ "$1" != "$oscar_anchor" ] || oscar_fail 'Choisissez un sous-dossier du disque réservé à Oscar.'
}
oscar_check_volume "$oscar_dir"
if [ -n "$oscar_data_dir" ]; then
  oscar_clean_path "$oscar_data_dir"
  while [ "$oscar_data_dir" != / ] && [ "${oscar_data_dir%/}" != "$oscar_data_dir" ]; do oscar_data_dir=${oscar_data_dir%/}; done
  case "$oscar_data_dir" in /*) ;; *) oscar_fail 'Le dossier des données doit être un chemin absolu.' ;; esac
  case "$oscar_data_dir/" in *'/../'*|*'/./'*|*'//'*) oscar_fail 'Le chemin des données contient un raccourci ambigu.' ;; esac
  case "$oscar_data_dir" in
    /|"$HOME"|/Users|/Volumes|/private|/private/tmp|/private/var|/private/var/tmp|/tmp|/var|/var/tmp|/opt|/home|/mnt|/media|/run/media|/Applications|/Library|/System|/usr|/usr/local|/bin|/sbin|/etc|/dev|/proc|/sys|/root|/System/*|/Library/*|/Applications/*|/usr/*|/bin/*|/sbin/*|/etc/*|/private/etc|/private/etc/*|/dev/*|/proc/*|/sys/*|/root/*)
      oscar_fail 'Choisissez un sous-dossier réservé aux données d’Oscar.' ;;
  esac
  oscar_check_parents "$oscar_data_dir"
  oscar_check_volume "$oscar_data_dir"
  case "$oscar_data_dir" in "$oscar_dir"|"$oscar_dir"/*)
    [ "$oscar_data_dir" = "$oscar_dir/data" ] || oscar_fail 'Séparez le dossier des données du logiciel.' ;;
  esac
  case "$oscar_dir" in "$oscar_data_dir"/*) oscar_fail 'Ne placez pas le logiciel à l’intérieur du dossier de ses données.' ;; esac
fi
for oscar_internal in .runtime .runtime/bin .tools .tools/node_modules .tools/node_modules/.bin data; do
  [ ! -L "$oscar_dir/$oscar_internal" ] || oscar_fail 'Un dossier interne est un lien symbolique. Utilisez un dossier d’installation sain.'
done

if [ "$oscar_location_wizard" -eq 1 ]; then
  printf '\n%s\n%s\n' 'Vos emplacements :' "  Logiciel : $oscar_dir"
  if [ -n "$oscar_data_dir" ]; then
    printf '  Missions, documents, voix et outils : %s\n' "$oscar_data_dir"
  else
    printf '%s\n' '  Données : l’emplacement déjà mémorisé ou configuré sera conservé et vérifié.'
  fi
  printf '%s\n' 'Aucun ancien dossier ne sera déplacé. Le disque choisi doit rester branché pour utiliser Oscar.'
  oscar_ask 'Confirmer ces emplacements [o/N] : '
  case "$oscar_answer" in o|O|oui|Oui|OUI|y|Y|yes|YES) ;; *) printf '%s\n' 'Installation annulée. Aucun fichier n’a été installé.'; exit 0 ;; esac
  if [ -n "${oscar_selected_device:-}" ]; then
    if [ "$oscar_system" = darwin ]; then oscar_now_device=$(stat -f %d "$oscar_selected_disk" 2>/dev/null) || oscar_now_device='';
    else oscar_now_device=$(stat -c %d "$oscar_selected_disk" 2>/dev/null) || oscar_now_device=''; fi
    [ "$oscar_now_device" = "$oscar_selected_device" ] || oscar_fail 'Le disque choisi a changé ou a été débranché. Aucun fichier n’a été installé.'
  fi
fi

if [ "$oscar_dry_run" -eq 1 ]; then
  printf '\n%s\n%s\n%s\n' "Simulation : installer Oscar et les agents dans $oscar_dir." "Moteur choisi : $oscar_engine." 'Le programme vérifiera Node.js, installera les moteurs manquants localement et ouvrira leur connexion officielle. Aucun changement effectué.'
  [ -z "$oscar_data_dir" ] || printf '%s\n' "Données choisies : $oscar_data_dir. Aucun dossier existant ne sera déplacé."
  exit 0
fi

mkdir -p "$oscar_dir"
oscar_check_parents "$oscar_dir"
oscar_check_volume "$oscar_dir"
[ -z "$oscar_data_dir" ] || oscar_check_volume "$oscar_data_dir"
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
  if [ -e "$oscar_dir/.runtime/installation.json" ] || [ -L "$oscar_dir/.runtime/installation.json" ]; then
    [ -f "$oscar_dir/.runtime/installation.json" ] && [ ! -L "$oscar_dir/.runtime/installation.json" ] || oscar_fail 'La configuration locale de l’installation n’est pas un fichier sûr.'
    [ "$(wc -c < "$oscar_dir/.runtime/installation.json")" -le 16384 ] || oscar_fail 'La configuration locale de l’installation dépasse sa taille autorisée.'
    cp "$oscar_dir/.runtime/installation.json" "$oscar_temp/runtime/installation.json"
    chmod 600 "$oscar_temp/runtime/installation.json"
  fi
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
# A piped online installer always downloads the current source. Reusing PWD
# here would silently reinstall an old version when run from its own folder.
if [ -z "$oscar_source" ]; then
  printf '\n%s\n' 'Téléchargement de Oscar et les agents…'
  oscar_download 'https://codeload.github.com/renaud-bxl/oscar-et-les-agents/tar.gz/refs/heads/main' "$oscar_temp/source.tar.gz"
  mkdir "$oscar_temp/source"
  tar -xzf "$oscar_temp/source.tar.gz" -C "$oscar_temp/source" --strip-components=1 || oscar_fail 'Impossible de décompresser le logiciel.'
  oscar_source="$oscar_temp/source"
  oscar_valid_source "$oscar_source" || oscar_fail 'Le téléchargement ne contient pas une installation valide.'
fi

# Older releases do not have the in-app update handshake. A manual reinstall
# must never overwrite their live modules, even when no mission is running.
if oscar_valid_source "$oscar_dir"; then
  "$oscar_node" --input-type=module - "${PORT:-4850}" <<'CHECK_RUNNING'
const port=Number(process.argv[2]);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Le port choisi est invalide.');
const {createConnection}=await import('node:net');
const listening=await new Promise((resolve,reject)=>{
  const socket=createConnection({host:'127.0.0.1',port});
  socket.setTimeout(1500);
  socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('error',error=>{socket.destroy();if(error.code==='ECONNREFUSED')resolve(false);else reject(error);});
  socket.once('timeout',()=>{socket.destroy();reject(new Error('Impossible de vérifier si le bureau est fermé. Aucun fichier n’a été remplacé.'));});
});
if(listening){
  console.error('Un bureau ou un service est encore ouvert sur ce port. Utilisez la mise à jour dans les réglages d’Oscar, ou terminez les missions puis fermez son serveur avant de relancer cette installation. Aucun fichier du logiciel n’a été remplacé.');
  process.exit(1);
}
CHECK_RUNNING
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
[ -z "$oscar_data_dir" ] || set -- "$@" --data-dir "$oscar_data_dir"
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
