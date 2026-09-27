#!/usr/bin/env bash
# Собирает снимок ветки release из проверенного main.
#
#   scripts/release-check.sh            # релизные проверки (обязательно до выпуска)
#   scripts/make-release.sh 0.1.0       # коммит в release + тег v0.1.0
#   git push origin release v0.1.0
#
# Рабочее дерево не трогается: дерево release строится во временном индексе
# из main минус пути из scripts/release-exclude.txt. Коммит release имеет двух
# родителей (прошлый release и main), поэтому история main остаётся видна.
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <major.minor.patch>" >&2
  exit 2
fi

root="$(git rev-parse --show-toplevel)"
cd "$root"

if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
  echo "tag v$version already exists" >&2
  exit 1
fi

source_ref="${RELEASE_SOURCE:-main}"
source_commit="$(git rev-parse --verify "$source_ref^{commit}")"

index_file="$(mktemp)"
trap 'rm -f "$index_file"' EXIT
export GIT_INDEX_FILE="$index_file"

git read-tree "$source_commit"
while IFS= read -r pattern; do
  [[ -z "$pattern" || "$pattern" == \#* ]] && continue
  git rm -r --cached --quiet --ignore-unmatch -- "$pattern"
done <scripts/release-exclude.txt

tree="$(git write-tree)"
unset GIT_INDEX_FILE

parents=()
if previous="$(git rev-parse -q --verify refs/heads/release)"; then
  parents+=(-p "$previous")
fi
parents+=(-p "$source_commit")

message="release: v$version from $source_ref@${source_commit:0:7}"
commit="$(git commit-tree "$tree" "${parents[@]}" -m "$message")"

git update-ref refs/heads/release "$commit"
git tag -a "v$version" "$commit" -m "VSM Moscow v$version"

echo "release -> ${commit:0:7} ($message)"
echo "next: git push origin release v$version"
