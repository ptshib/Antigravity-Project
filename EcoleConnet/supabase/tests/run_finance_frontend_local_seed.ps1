$ErrorActionPreference = "Stop"

Write-Host "======================================================================"
Write-Host " LOCAL FINANCE FRONTEND SEED RUNNER"
Write-Host "======================================================================"

if ($env:SUPABASE_URL -and $env:SUPABASE_URL -notmatch "localhost|127\.0\.0\.1") {
    Write-Error "ERROR: Script cannot run against distant Supabase URL ($env:SUPABASE_URL)."
    exit 1
}

$containerName = "supabase_db_EcoleConnet"
Write-Host "[1/3] Checking Docker container '$containerName'..."

$containerRunning = (docker ps --filter "name=^/${containerName}$" --format "{{.Names}}").Trim()
if ($containerRunning -ne $containerName) {
    Write-Error "ERROR: Required Docker container '$containerName' is not running."
    exit 1
}
Write-Host "Container verified: $containerName"

$seedSqlPath = Join-Path $PSScriptRoot "finance_frontend_local_seed.sql"
if (-not (Test-Path $seedSqlPath)) {
    Write-Error "ERROR: Seed SQL file not found at $seedSqlPath"
    exit 1
}

Write-Host "[2/3] Copying SQL file to container..."
docker cp "$seedSqlPath" "${containerName}:/tmp/finance_frontend_local_seed.sql"
if ($LASTEXITCODE -ne 0) {
    Write-Error "ERROR: Failed to copy SQL file to container."
    exit 1
}

Write-Host "[3/3] Executing local frontend seed script..."
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    docker exec -e "PGOPTIONS=-c ecoleconnect.finance_frontend_environment=local_docker_EcoleConnet" -i $containerName psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/finance_frontend_local_seed.sql
    $setupExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($setupExitCode -ne 0) {
    Write-Error "ERROR: Seed script failed with exit code $setupExitCode"
    exit 1
}

Write-Host "======================================================================"
Write-Host " SEED COMPLETED SUCCESSFULLY"
Write-Host "======================================================================"
exit 0
