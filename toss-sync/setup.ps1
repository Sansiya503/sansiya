# 산시야 · 토스증권 연동 설치 (조회 전용)
# 1) 이 컴퓨터의 IP를 보여 줘요  2) 토스 Open API 키와 산시야 연결 코드를 입력받아요
# 3) 키를 이 Windows 계정에서만 풀리게 암호화해 저장해요  4) 첫 동기화를 하고 30분마다 자동 실행을 등록해요
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
$Inst = Join-Path $env:LOCALAPPDATA 'Sansiya\TossSync'
$TaskName = 'Sansiya Toss Sync'
$SupabaseUrl = 'https://inaloiiabxzhdiivfkoj.supabase.co'
$SupabaseKey = 'sb_publishable_5iFx97QCdmF-MxrsOeXKIg_I4GfOVVq'

function Read-Value([string]$label, [switch]$Secret) {
  while ($true) {
    if ($Secret) {
      $ss = Read-Host -Prompt $label -AsSecureString
      $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
      try { $v = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
    } else { $v = Read-Host -Prompt $label }
    $v = ($v -replace '\s', '')
    if ($v) { return $v }
    Write-Host '   비어 있어요. 다시 붙여넣어 주세요.' -ForegroundColor Yellow
  }
}
function Protect-Text([string]$plain) { ConvertTo-SecureString $plain -AsPlainText -Force | ConvertFrom-SecureString }

Write-Host ''
Write-Host '  산시야 · 토스증권 연동 설치 (조회 전용)' -ForegroundColor Cyan
Write-Host '  토스증권에서 보유 종목·수량·평균 단가만 읽어 산시야 "내 주식"에 맞춰요. 주문은 하지 않아요.'
Write-Host ''

$ip = ''
try { $ip = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 15 -UseBasicParsing).ToString().Trim() } catch {}
Write-Host '[1/4] 이 컴퓨터의 인터넷 주소(IP)' -ForegroundColor Cyan
if ($ip) { Write-Host ('      ' + $ip) -ForegroundColor Green } else { Write-Host '      확인하지 못했어요. 인터넷 연결을 확인해 주세요.' -ForegroundColor Yellow }
Write-Host '      토스증권 PC 웹 → 설정 → Open API → 아래쪽 "허용 IP 관리"에 이 주소를 등록해 주세요.'
Write-Host ''
Write-Host '[2/4] 토스증권 Open API 키 (같은 화면에서 발급, 복사 버튼으로 붙여넣기)' -ForegroundColor Cyan
$clientId = Read-Value '      client_id'
$clientSecret = Read-Value '      client_secret (붙여넣어도 화면에 안 보여요)' -Secret
Write-Host ''
Write-Host '[3/4] 산시야 연결 코드 (산시야 앱 → 설정 → 토스증권 연동 → 연결 코드 만들기)' -ForegroundColor Cyan
Write-Host '      (이 컴퓨터에서 산시야 앱을 열어 "복사"를 누른 뒤, 여기서 마우스 오른쪽 클릭 또는 Ctrl+V로 붙여넣으세요)'
while ($true) {
  $link = Read-Value '      연결 코드'
  if ($link -match '^ssy_[A-Za-z0-9_\-]{20,}$') { break }
  $head = $link.Substring(0, [Math]::Min(6, $link.Length))
  Write-Host ("      ssy_ 로 시작하는 코드가 아니에요. 지금 들어간 값: '" + $head + "…' (" + $link.Length + "자). 연결 코드는 ssy_ 로 시작하는 47자예요.") -ForegroundColor Yellow
  Write-Host '      앱에서 "복사"를 다시 누르고 붙여넣어 주세요. 폰에서 복사했다면 이 컴퓨터의 클립보드에는 없어요.' -ForegroundColor Yellow
}
Write-Host ''
Write-Host '[4/4] 설치하고 첫 동기화를 해 볼게요...' -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $Inst | Out-Null
Copy-Item -Force (Join-Path $Src 'sync.ps1') $Inst
Copy-Item -Force (Join-Path $Src 'run-hidden.vbs') $Inst
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Inst 'token.dat')
$cfg = [ordered]@{ clientId = (Protect-Text $clientId); clientSecret = (Protect-Text $clientSecret); link = (Protect-Text $link);
                   supabaseUrl = $SupabaseUrl; supabaseKey = $SupabaseKey; installedAt = (Get-Date).ToString('s') }
Set-Content -Path (Join-Path $Inst 'config.json') -Value ($cfg | ConvertTo-Json) -Encoding UTF8
$clientSecret = $null; $link = $null

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Inst 'sync.ps1') -Interactive
$ok = ($LASTEXITCODE -eq 0)

# every 30 minutes while signed in (missed runs catch up when the PC wakes), plus at sign-in when Windows allows it
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
if (Test-Path $wscript) { $action = New-ScheduledTaskAction -Execute $wscript -Argument ('"' + (Join-Path $Inst 'run-hidden.vbs') + '"') }
else { $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $Inst 'sync.ps1') + '"') }
$daily = New-ScheduledTaskTrigger -Daily -At '00:00'
$daily.Repetition = (New-ScheduledTaskTrigger -Once -At '00:00' -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 23 -Minutes 59)).Repetition
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
$desc = '산시야: 토스증권 보유 종목을 30분마다 읽어 산시야 내 주식에 맞춰요 (조회 전용).'
try {
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $me
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($daily, $logon) -Settings $settings -Principal $principal -Description $desc -Force | Out-Null
} catch {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $daily -Settings $settings -Principal $principal -Description $desc -Force | Out-Null
}

Write-Host ''
if ($ok) {
  Write-Host '  설치를 마쳤어요. 이제 컴퓨터가 켜져 있으면 30분마다 자동으로 맞춰져요.' -ForegroundColor Green
  Write-Host '  산시야 앱 → 주식 → 내 주식에서 확인해 보세요.'
} else {
  Write-Host '  설치는 됐지만 첫 동기화가 실패했어요. 위 메시지대로 고친 뒤 "2-sync-now"를 더블클릭해 주세요.' -ForegroundColor Yellow
  Write-Host '  (30분마다 자동으로 다시 시도해요.)'
}
Write-Host ('  설치 위치: ' + $Inst + '  (기록: sync.log)')
