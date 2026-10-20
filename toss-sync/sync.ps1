# 산시야 · 토스증권 보유 종목 동기화 (조회 전용)
# 토스증권 Open API에서 보유 주식을 읽어 산시야 '내 주식'에 맞춰요. 주문 기능은 쓰지 않아요.
# 설정(config.json)의 키와 연결 코드는 이 컴퓨터의 Windows 계정으로만 풀리게 암호화돼 있어요.
param([switch]$Interactive)

$ErrorActionPreference = 'Stop'
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Dir 'config.json'
$TokenPath = Join-Path $Dir 'token.dat'
$LogPath = Join-Path $Dir 'sync.log'
$OnWindows = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows

try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
Add-Type -AssemblyName System.Net.Http
$Http = New-Object System.Net.Http.HttpClient
$Http.Timeout = [TimeSpan]::FromSeconds(25)

function Write-Log([string]$msg) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
  if ($Interactive) { Write-Host $msg }
  try {
    $old = @(); if (Test-Path $LogPath) { $old = @(Get-Content $LogPath -Encoding UTF8 -Tail 300) }
    Set-Content -Path $LogPath -Value ($old + $line) -Encoding UTF8
  } catch {}
}

function Protect-Text([string]$plain) {
  if ($OnWindows) { return (ConvertTo-SecureString $plain -AsPlainText -Force | ConvertFrom-SecureString) }
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain))   # test runs off Windows only
}
function Unprotect-Text([string]$enc) {
  if ($OnWindows) {
    $ss = ConvertTo-SecureString $enc
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
  }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($enc))
}

# one HTTP call -> @{ Status = 200; Json = <object or $null>; Text = '...' }   (never throws on 4xx/5xx)
function Invoke-Http([string]$Method, [string]$Url, [hashtable]$Headers, $Body, [string]$Kind) {
  $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), $Url)
  if ($Headers) { foreach ($k in $Headers.Keys) { [void]$req.Headers.TryAddWithoutValidation($k, [string]$Headers[$k]) } }
  if ($Kind -eq 'form') {
    $d = New-Object 'System.Collections.Generic.Dictionary[string,string]'
    foreach ($k in $Body.Keys) { $d.Add($k, [string]$Body[$k]) }
    $req.Content = [System.Net.Http.FormUrlEncodedContent]::new($d)
  } elseif ($Kind -eq 'json') {
    $req.Content = [System.Net.Http.StringContent]::new([string]$Body, [Text.Encoding]::UTF8, 'application/json')
  }
  $resp = $Http.SendAsync($req).GetAwaiter().GetResult()
  $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
  $text = [Text.Encoding]::UTF8.GetString($bytes)
  $json = $null
  if ($text) { try { $json = $text | ConvertFrom-Json } catch {} }
  return @{ Status = [int]$resp.StatusCode; Json = $json; Text = $text }
}

function Get-ErrorCode($r) {
  if ($r.Json -and $r.Json.error) {
    if ($r.Json.error -is [string]) { return $r.Json.error }   # OAuth2 style
    if ($r.Json.error.code) { return [string]$r.Json.error.code }
  }
  return ('http-' + $r.Status)
}

function Get-PublicIp {
  try {
    $u = 'https://api.ipify.org'; if ($cfg.ipUrl) { $u = [string]$cfg.ipUrl }
    $r = Invoke-Http 'GET' $u @{} $null ''
    if ($r.Status -eq 200 -and $r.Text -match '^[0-9a-fA-F:.]{3,45}$') { return $r.Text.Trim() }
  } catch {}
  return ''
}

if (-not (Test-Path $ConfigPath)) { Write-Log '설정 파일이 없어요. 먼저 설치를 해 주세요.'; exit 2 }
$cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$TossBase = 'https://openapi.tossinvest.com'
if ($cfg.tossBase) { $TossBase = [string]$cfg.tossBase }
$ClientId = Unprotect-Text $cfg.clientId
$ClientSecret = Unprotect-Text $cfg.clientSecret
$LinkCode = Unprotect-Text $cfg.link
$Ip = Get-PublicIp

function Send-ToSansiya($payload) {
  if ($Ip) { $payload['ip'] = $Ip }
  $body = @{ p_token = $LinkCode; p_payload = $payload } | ConvertTo-Json -Depth 8 -Compress
  $h = @{ apikey = $cfg.supabaseKey; Authorization = ('Bearer ' + $cfg.supabaseKey) }
  return Invoke-Http 'POST' ($cfg.supabaseUrl.TrimEnd('/') + '/rest/v1/rpc/broker_sync') $h $body 'json'
}
function Fail([string]$code, [string]$message) {
  Write-Log $message
  try { [void](Send-ToSansiya @{ status = 'error'; error = $code }) } catch {}
  exit 1
}

# --- access token: Toss keeps only one valid token per key, so reuse it until it is about to expire ---
function Get-Token([switch]$Fresh) {
  if (-not $Fresh -and (Test-Path $TokenPath)) {
    try {
      $t = (Unprotect-Text (Get-Content $TokenPath -Raw)) | ConvertFrom-Json
      if ([double]$t.exp -gt ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 300)) { return [string]$t.token }
    } catch {}
  }
  $r = Invoke-Http 'POST' ($TossBase + '/oauth2/token') @{} @{ grant_type = 'client_credentials'; client_id = $ClientId; client_secret = $ClientSecret } 'form'
  if ($r.Status -eq 200 -and $r.Json.access_token) {
    $exp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + [int]$r.Json.expires_in
    Set-Content -Path $TokenPath -Value (Protect-Text ((@{ token = $r.Json.access_token; exp = $exp }) | ConvertTo-Json -Compress)) -Encoding ASCII
    return [string]$r.Json.access_token
  }
  $code = Get-ErrorCode $r
  if ($r.Status -eq 403) { Fail 'ip-not-allowed' ("토스가 이 컴퓨터의 IP($Ip)를 막았어요. 토스증권 PC 웹 → 설정 → Open API → 허용 IP 관리에 등록해 주세요.") }
  if ($code -eq 'invalid_client' -or $r.Status -eq 401) { Fail 'invalid-client' '토스 Open API 키(client_id/secret)가 맞지 않아요. 키를 다시 확인해 주세요.' }
  if ($r.Status -eq 429) { Fail 'rate-limit' '토스 요청 한도에 걸렸어요. 잠시 뒤 다시 해요.' }
  Fail ('token-' + $code) ("토스 로그인 토큰을 받지 못했어요 ($code).")
}

# GET with the token; re-issues the token once if Toss says it expired or was replaced
$script:Token = Get-Token
function Toss-Get([string]$path, [hashtable]$extra) {
  for ($i = 0; $i -lt 2; $i++) {
    $h = @{ Authorization = ('Bearer ' + $script:Token) }
    if ($extra) { foreach ($k in $extra.Keys) { $h[$k] = $extra[$k] } }
    $r = Invoke-Http 'GET' ($TossBase + $path) $h $null ''
    if ($r.Status -eq 401 -and $i -eq 0) { $script:Token = Get-Token -Fresh; continue }
    if ($r.Status -eq 429 -and $i -eq 0) { Start-Sleep -Seconds 2; continue }
    return $r
  }
  return $r
}
function Check($r, [string]$what) {
  if ($r.Status -eq 200) { return }
  $code = Get-ErrorCode $r
  if ($r.Status -eq 403) { Fail 'ip-not-allowed' ("토스가 이 컴퓨터의 IP($Ip)를 막았어요. 허용 IP 관리에 등록해 주세요.") }
  Fail ($what + '-' + $code) ("토스에서 $what 정보를 읽지 못했어요 ($code).")
}

# --- accounts -> holdings -> stock info ---
$r = Toss-Get '/api/v1/accounts' $null
Check $r 'accounts'
$acct = @($r.Json.result | Where-Object { $_.accountType -eq 'BROKERAGE' }) | Select-Object -First 1
if (-not $acct) { Fail 'no-account' '토스증권 종합매매 계좌를 찾지 못했어요.' }
$seq = [string]$acct.accountSeq
$tail = ''
if ($acct.accountNo) { $no = [string]$acct.accountNo; $tail = $no.Substring([Math]::Max(0, $no.Length - 4)) }

$r = Toss-Get '/api/v1/holdings' @{ 'X-Tossinvest-Account' = $seq }
Check $r 'holdings'
$items = @($r.Json.result.items)

$info = @{}
$syms = @($items | ForEach-Object { [string]$_.symbol } | Where-Object { $_ -match '^[A-Za-z0-9.\-]+$' } | Select-Object -Unique)
for ($i = 0; $i -lt $syms.Count; $i += 200) {
  $chunk = $syms[$i..([Math]::Min($i + 199, $syms.Count - 1))] -join ','
  $s = Toss-Get ('/api/v1/stocks?symbols=' + [Uri]::EscapeDataString($chunk)) $null
  if ($s.Status -eq 200) { foreach ($x in @($s.Json.result)) { $info[[string]$x.symbol] = $x } }
}

$holdings = @()
foreach ($it in $items) {
  $sym = [string]$it.symbol
  $x = $info[$sym]
  $name = [string]$it.name
  $exchange = ''
  if ($x) { if ($x.name) { $name = [string]$x.name }; $exchange = [string]$x.market }
  $holdings += @{ symbol = $sym; name = $name; country = [string]$it.marketCountry; exchange = $exchange;
                  currency = [string]$it.currency; quantity = [string]$it.quantity; avgPrice = [string]$it.averagePurchasePrice }
}

$res = Send-ToSansiya @{ status = 'ok'; account = $tail; holdings = $holdings }
if ($res.Status -ge 200 -and $res.Status -lt 300) {
  Write-Log ("동기화 완료: 보유 종목 $($holdings.Count)개 (새로 $($res.Json.added), 갱신 $($res.Json.updated), 정리 $($res.Json.cleared))")
  exit 0
}
if ($res.Text -match 'invalid link') { Write-Log '산시야 연결 코드가 맞지 않아요. 앱 설정에서 새 연결 코드를 만들어 다시 설치해 주세요.'; exit 1 }
Write-Log ("산시야에 저장하지 못했어요 (HTTP $($res.Status)): " + $res.Text.Substring(0, [Math]::Min(200, $res.Text.Length)))
exit 1
