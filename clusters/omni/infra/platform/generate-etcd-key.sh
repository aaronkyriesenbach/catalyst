#!/bin/sh
# Prints Omni's etcd encryption key (armored); pipe it straight into
# `pulumi config set --secret etcdEncryptionKey`, never to a file.
set -eu

GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
trap 'rm -rf "$GNUPGHOME"' EXIT

gpg --batch --passphrase '' --quick-generate-key \
  "Omni (etcd data encryption) aaron@lab53.net" rsa4096 cert never 2>/dev/null

fingerprint="$(gpg --with-colons --list-keys aaron@lab53.net |
  awk -F: '$1 == "fpr" { print $10; exit }')"

gpg --batch --passphrase '' --quick-add-key "$fingerprint" rsa4096 encr never \
  2>/dev/null

gpg --batch --passphrase '' --export-secret-key --armor aaron@lab53.net
