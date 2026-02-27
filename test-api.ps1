# LedgerPay API Test Script
$ErrorActionPreference = "Continue"

Write-Host "`n🔐 TESTING AUTH ENDPOINTS" -ForegroundColor Cyan
Write-Host "========================`n"

# Login
Write-Host "📝 Logging in..." -ForegroundColor Yellow
$loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" `
    -Method POST `
    -Body (@{email="john@test.com";password="password123"} | ConvertTo-Json) `
    -ContentType "application/json"

$token = $loginResponse.token
$userId = $loginResponse.userId
Write-Host "✅ Login successful!" -ForegroundColor Green
Write-Host "UserId: $userId`n"

# Get wallet account info from database
Write-Host "💼 GETTING WALLET INFO" -ForegroundColor Cyan
Write-Host "========================`n"

$query = "SELECT la.id as account_id FROM `"Wallet`" w JOIN `"LedgerAccount`" la ON la.`"walletId`" = w.id WHERE w.`"userId`" = '$userId' LIMIT 1"
$queryFile = "C:\Users\91914\Desktop\LedgerPay\temp-query.sql"
$query | Out-File -FilePath $queryFile -Encoding utf8 -NoNewline

$accountInfo = npx --yes @databases/pg-sql --connection-string "postgresql://postgres:password@localhost:5433/wallet_db" --query $query 2>&1 | Out-String

# Parse account ID (fallback: use a test ID if query fails)
if ($accountInfo -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
    $accountId = $matches[1]
    Write-Host "✅ Found account: $accountId" -ForegroundColor Green
} else {
    Write-Host "⚠️  Couldn't fetch from DB, we'll check balance endpoint instead" -ForegroundColor Yellow
}

Remove-Item $queryFile -ErrorAction SilentlyContinue

Write-Host "`n"
