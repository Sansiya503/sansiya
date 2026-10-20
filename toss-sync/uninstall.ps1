# 산시야 · 토스증권 연동 끄기: 자동 실행을 지우고 이 컴퓨터에 저장한 키를 삭제해요
$ErrorActionPreference = 'Continue'
$Inst = Join-Path $env:LOCALAPPDATA 'Sansiya\TossSync'
Unregister-ScheduledTask -TaskName 'Sansiya Toss Sync' -Confirm:$false -ErrorAction SilentlyContinue
if (Test-Path $Inst) { Remove-Item -Recurse -Force $Inst }
Write-Host ''
Write-Host '  연동을 껐어요. 이 컴퓨터에 저장된 토스 키와 연결 코드를 지웠어요.' -ForegroundColor Green
Write-Host '  산시야 앱 → 설정 → 토스증권 연동에서 "연결 끊기"도 눌러 주세요.'
Write-Host '  토스증권 PC 웹 → 설정 → Open API에서 키를 삭제하면 완전히 끊겨요.'
