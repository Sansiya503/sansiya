#!/usr/bin/env bash
# 산시야 브라우저 테스트 실행기 (Playwright + Chromium 필요: pip install playwright)
#   bash tests/run_e2e.sh                 # 전부
#   bash tests/run_e2e.sh e2e_menubar     # 하나 또는 여러 개만
# 저장소 루트를 http://localhost:8768 에서 띄우고, Supabase 라이브러리는 가짜(mock)로 바꿔 끼워서 돌려요.
# 진짜 Supabase나 실제 계정에는 절대 접속하지 않아요. 스크린샷은 tests/out/shots 에 남아요.
set -u
cd "$(dirname "$0")/.."
OUT="$PWD/tests/out"
mkdir -p "$OUT/shots" "$OUT/imgs"
cp tests/fixtures/* "$OUT/imgs/"

python3 -m http.server 8768 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1

if [ $# -gt 0 ]; then names=("$@"); else names=($(cd tests/e2e && ls e2e_*.py | sed 's/\.py$//')); fi

total=0
for t in "${names[@]}"; do
  log=$(timeout 600 python3 "tests/e2e/$t.py" "$OUT" 2>&1)
  code=$?
  fails=$(printf '%s\n' "$log" | grep -c '^FAIL  ')
  if [ $code -ne 0 ]; then
    echo "✗ $t — 실행 오류 (exit $code)"; printf '%s\n' "$log" | tail -5
    total=$((total + 1))
  elif [ "$fails" -gt 0 ]; then
    echo "✗ $t — FAIL $fails"; printf '%s\n' "$log" | grep '^FAIL  '
    total=$((total + fails))
  else
    echo "✓ $t"
  fi
done
echo "합계 FAIL: $total  (e2e_stocks의 'sort by return puts Apple first' 1건은 예전부터 알려진 실패예요)"
