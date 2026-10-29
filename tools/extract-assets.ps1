param([string[]]$Names = @('tuna','hacker','fries','cross','emerald'))
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$decompiler = Join-Path $PSScriptRoot 'ffdec/ffdec.jar'
if (-not (Test-Path -LiteralPath $decompiler)) { throw 'Run tools/fetch-sources.ps1 first.' }

$javaCandidates = @(
    'C:/Program Files/Java/jdk-23/bin/java.exe',
    'C:/Program Files/Java/openlogic-openjdk-17.0.13+11-windows-x64/bin/java.exe'
)
$javaBin = $javaCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $javaBin) { $javaBin = (Get-Command java -ErrorAction Stop).Source }

foreach ($name in $Names) {
    $original = Join-Path $projectRoot "assets/originals/$name.swf"
    $output = Join-Path $PSScriptRoot "export-$name"
    $xml = Join-Path $PSScriptRoot "$name.xml"
    & $javaBin '-Djava.awt.headless=true' -jar $decompiler -export shape,sound $output $original 2>&1 | Out-File -LiteralPath (Join-Path $PSScriptRoot "extract-$name.log") -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "Export failed for $name. See tools/extract-$name.log." }
    & $javaBin '-Djava.awt.headless=true' -jar $decompiler -swf2xml $original $xml 2>&1 | Out-File -LiteralPath (Join-Path $PSScriptRoot "xml-$name.log") -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "XML export failed for $name." }
    Write-Output "Extracted original vectors and audio: $name"
}
