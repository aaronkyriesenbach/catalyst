#!/usr/bin/env bash
set -uo pipefail

ROOT=${ISO_ROOT:-/images}
KEEP=${ISO_KEEP:-3}
DEBIAN_EDITION=${DEBIAN_EDITION:-gnome}
NIXOS_EDITION=${NIXOS_EDITION:-minimal}
WINDOWS_LANGUAGE=${WINDOWS_LANGUAGE:-English (United States)}
QUICKGET_VERSION=4.9.9
QUICKGET_SHA256=c8448e4a22c21e6f05cf390e1a95b5b0e853ef6074fc8f918d42deb11b0e04fd

failed=()
csv=

# Run through bash because the image has no /usr/bin/env and a tmp volume may be noexec.
QUICKGET_BIN=${TMPDIR:-/tmp}/quickget
quickget() { bash "$QUICKGET_BIN" "$@"; }

# Exported so quickget's bash child sees it; only used for a Microsoft session id.
if ! command -v uuidgen >/dev/null; then
	uuidgen() { cat /proc/sys/kernel/random/uuid; }
	export -f uuidgen
fi

# Patched after the checksum so the pin still covers upstream. cdimage.debian.org has dead
# addresses on some networks and curl waits ~30s on each; listing Debian releases hits it dozens of times.
install_quickget() {
	curl -fsSL -o "$QUICKGET_BIN" \
		"https://raw.githubusercontent.com/quickemu-project/quickemu/$QUICKGET_VERSION/quickget" &&
		echo "$QUICKGET_SHA256  $QUICKGET_BIN" | sha256sum --check --status &&
		sed -i 's/curl --disable /curl --disable --connect-timeout 5 /g' "$QUICKGET_BIN"
}

releases() {
	local os=$1 edition=$2 _name id rel opt

	while IFS=, read -r _name id rel opt _; do
		[[ $id == "$os" && $rel =~ ^[0-9] && $opt == "$edition" ]] && echo "$rel"
	done <<<"$csv" | sort -rV | head -n "$KEEP"
}

remove_listed() {
	local f
	while IFS= read -r f; do rm -v -- "$f"; done
}

prune() {
	ls -1 -- *.iso 2>/dev/null | sort -rV | tail -n +"$((KEEP + 1))" | remove_listed
}

sync() {
	local dir=$1 os=$2 edition=$3
	shift 3
	local rels=("$@") rel ok=1

	mkdir -p "$ROOT/$dir" && cd "$ROOT/$dir" || {
		failed+=("$dir")
		return
	}

	if ((${#rels[@]} == 0)); then
		mapfile -t rels < <(releases "$os" "$edition")
	fi
	if ((${#rels[@]} == 0)); then
		echo "$dir: quickget listed no releases" >&2
		failed+=("$dir")
		return
	fi

	for rel in "${rels[@]}"; do
		quickget --download "$os" "$rel" ${edition:+"$edition"} || ok=0
	done

	# Pruning after a partial failure could delete the last good copy of a release.
	if ((ok)); then
		prune
	else
		failed+=("$dir")
	fi
}

sync_windows() {
	local dir=$ROOT/windows log output rc

	mkdir -p "$dir" && cd "$dir" || {
		failed+=(windows)
		return
	}
	log=$(mktemp)

	quickget --download windows 11 "$WINDOWS_LANGUAGE" 2>&1 | tee "$log"
	rc=${PIPESTATUS[0]}

	# quickget exits 0 even when Microsoft rejects the request.
	output=$(<"$log")
	if ((rc != 0)) || [[ $output == *'WARNING!'* || $output == *'servers gave us'* ]] || ! compgen -G '*.iso' >/dev/null; then
		failed+=(windows)
	else
		prune
	fi
	rm -f "$log"
}

main() {
	local os

	install_quickget || {
		echo "could not install quickget $QUICKGET_VERSION" >&2
		exit 1
	}

	# An empty list only fails the OSes that depend on it; arch and windows don't.
	csv=$(quickget --list-csv 2>/dev/null) || echo "quickget --list-csv failed" >&2

	for os in "$@"; do
		case $os in
		debian) sync debian debian "$DEBIAN_EDITION" ;;
		ubuntu) sync ubuntu ubuntu "" ;;
		nixos) sync nixos nixos "$NIXOS_EDITION" ;;
		arch) sync arch archlinux "" latest ;;
		windows) sync_windows ;;
		*)
			echo "unknown target: $os" >&2
			failed+=("$os")
			;;
		esac
	done

	# Deliberately exit 0: one OS failing shouldn't mark the whole run failed.
	if ((${#failed[@]} > 0)); then
		echo "WARNING: failed: ${failed[*]}" >&2
	fi
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
	main "$@"
fi
