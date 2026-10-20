# 지금 바로 한 번 동기화
$Inst = Join-Path $env:LOCALAPPDATA 'Sansiya\TossSync'
if (-not (Test-Path (Join-Path $Inst 'config.json'))) { Write-Host '  아직 설치되지 않았어요. "1-install"을 먼저 더블클릭해 주세요.' -ForegroundColor Yellow; exit 1 }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Inst 'sync.ps1') -Interactive
