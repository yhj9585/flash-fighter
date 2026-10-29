param(
    [string[]]$Names = @('tuna','hacker','fries','cross','emerald'),
    [switch]$AssetsOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$originalDir = Join-Path $projectRoot 'assets/originals'
$fontDir = Join-Path $projectRoot 'assets/fonts'
New-Item -ItemType Directory -Force -Path $originalDir,$fontDir | Out-Null

$sources = @(
    @{ id = 'tuna'; page = 'https://vidkidz.tistory.com/9936'; title = '고추참치송'; animation = '사스케야' },
    @{ id = 'hacker'; page = 'https://vidkidz.tistory.com/5113'; title = '해킹송1'; animation = '황산맛콜라' },
    @{ id = 'fries'; page = 'https://vidkidz.tistory.com/5832'; title = '감자튀김송'; animation = 'みやざわ'; music = '돌카스' },
    @{ id = 'cross'; page = 'https://vidkidz.tistory.com/6780'; title = '썩던콩'; animation = '넬피엘'; music = '403 Forbidden / Southern Cross' },
    @{ id = 'emerald'; page = 'https://vidkidz.tistory.com/5198'; title = '에메랄드 소드'; animation = '로아'; music = 'Rhapsody / Emerald Sword'; creditNote = '보관소 소개는 로아, 표는 오센·부콘스틱게임즈로 서로 다르게 표기.' }
)
foreach ($source in $sources) {
    $destination = Join-Path $originalDir ($source.id + '.swf')
    if ($Names -contains $source.id) {
        $response = Invoke-WebRequest -Uri $source.page -UseBasicParsing -TimeoutSec 45
        [IO.File]::WriteAllText((Join-Path $PSScriptRoot ($source.id + '-source.html')), $response.Content)
        $match = [regex]::Match($response.Content, 'href="([^"\s]+\.swf[^"\s]*)"')
        if (-not $match.Success) { throw "No SWF attachment found: $($source.page)" }
        $attachment = [Net.WebUtility]::HtmlDecode($match.Groups[1].Value)
        Invoke-WebRequest -Uri $attachment -OutFile $destination -TimeoutSec 60
    }
    if (-not (Test-Path -LiteralPath $destination)) { continue }
    $source.sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLower()
    $source.bytes = (Get-Item -LiteralPath $destination).Length
    Write-Output "$($source.id): $($source.bytes) bytes, SHA256 $($source.sha256)"
}
$sources | Where-Object { $_.ContainsKey('sha256') } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $originalDir 'sources.json') -Encoding utf8

if ($AssetsOnly) { return }

Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/google/fonts/main/ofl/gaegu/Gaegu-Regular.ttf' -OutFile (Join-Path $fontDir 'Gaegu-Regular.ttf')
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/google/fonts/main/ofl/gaegu/OFL.txt' -OutFile (Join-Path $fontDir 'OFL.txt')

$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/jindrapetrik/jpexs-decompiler/releases/tags/version26.4.0' -Headers @{ 'User-Agent' = 'FlashVersus-asset-build' }
$archive = $release.assets | Where-Object { $_.name -match '^ffdec_.*\.zip$' } | Select-Object -First 1
if (-not $archive) { throw 'JPEXS portable ZIP not found' }
$archivePath = Join-Path $PSScriptRoot 'ffdec.zip'
Invoke-WebRequest -Uri $archive.browser_download_url -OutFile $archivePath
Expand-Archive -LiteralPath $archivePath -DestinationPath (Join-Path $PSScriptRoot 'ffdec') -Force
Write-Output "JPEXS $($release.tag_name) downloaded for local asset extraction."
