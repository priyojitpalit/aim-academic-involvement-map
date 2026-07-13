$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$port = 8000
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)

function Get-MimeType([string]$path) {
    switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.htm'  { 'text/html; charset=utf-8' }
        '.js'   { 'text/javascript; charset=utf-8' }
        '.mjs'  { 'text/javascript; charset=utf-8' }
        '.css'  { 'text/css; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.svg'  { 'image/svg+xml' }
        '.png'  { 'image/png' }
        '.jpg'  { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        '.gif'  { 'image/gif' }
        '.ico'  { 'image/x-icon' }
        '.webp' { 'image/webp' }
        '.txt'  { 'text/plain; charset=utf-8' }
        default { 'application/octet-stream' }
    }
}

function Send-Response($stream, [int]$statusCode, [string]$statusText, [byte[]]$body, [string]$contentType, [bool]$headOnly = $false) {
    $header = "HTTP/1.1 $statusCode $statusText`r`n" +
              "Content-Type: $contentType`r`n" +
              "Content-Length: $($body.Length)`r`n" +
              "Cache-Control: no-store`r`n" +
              "Connection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if (-not $headOnly -and $body.Length -gt 0) {
        $stream.Write($body, 0, $body.Length)
    }
    $stream.Flush()
}

try {
    $listener.Start()
    $url = "http://localhost:$port/preview.html"
    Write-Host ""
    Write-Host "AIM preview is running at:" -ForegroundColor Green
    Write-Host $url -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Keep this window open. Press Ctrl+C to stop the preview."
    Start-Process $url

    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

            while ($true) {
                $line = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($line)) { break }
            }

            $parts = $requestLine.Split(' ')
            if ($parts.Length -lt 2) { continue }
            $method = $parts[0].ToUpperInvariant()
            $rawPath = $parts[1].Split('?')[0]
            $path = [System.Uri]::UnescapeDataString($rawPath)
            if ($path -eq '/') { $path = '/preview.html' }
            $relative = $path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

            if (-not $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes('403 Forbidden')
                Send-Response $stream 403 'Forbidden' $body 'text/plain; charset=utf-8'
                continue
            }

            if ($method -ne 'GET' -and $method -ne 'HEAD') {
                $body = [System.Text.Encoding]::UTF8.GetBytes('405 Method Not Allowed')
                Send-Response $stream 405 'Method Not Allowed' $body 'text/plain; charset=utf-8'
                continue
            }

            if (-not [System.IO.File]::Exists($fullPath)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
                Send-Response $stream 404 'Not Found' $body 'text/plain; charset=utf-8' ($method -eq 'HEAD')
                continue
            }

            $body = [System.IO.File]::ReadAllBytes($fullPath)
            Send-Response $stream 200 'OK' $body (Get-MimeType $fullPath) ($method -eq 'HEAD')
        }
        catch {
            Write-Warning $_.Exception.Message
        }
        finally {
            if ($reader) { $reader.Dispose() }
            if ($stream) { $stream.Dispose() }
            $client.Close()
        }
    }
}
catch {
    Write-Host ""
    Write-Host "Could not start the preview server." -ForegroundColor Red
    Write-Host $_.Exception.Message
    Write-Host ""
    Write-Host "Another program may already be using port 8000."
    Read-Host "Press Enter to close"
}
finally {
    if ($listener) { $listener.Stop() }
}
