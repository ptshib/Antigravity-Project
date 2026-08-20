# ============================================================================
# SCRIPT DE RUNNER DE CONCURRENCE AUTOMATISÉ : PHASE FINANCE 1
# Fichier : supabase/tests/run_school_finance_concurrency_tests.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " EXÉCUTION DU TEST AUTOMATISÉ DE CONCURRENCE : PHASE FINANCE 1" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. CONTROLE STRICT ANTI-PRODUCTION ET BASE DISTANTE
if ($env:SUPABASE_URL -and $env:SUPABASE_URL -notmatch "localhost|127\.0\.0\.1") {
    Write-Error "REJET SÉCURITÉ : Le script de concurrence ne peut pas être exécuté sur un Supabase distant ($env:SUPABASE_URL)."
    exit 1
}

# 2. VÉRIFICATION STRICTE DU CONTENEUR DOCKER LOCAL EXCLUSIF
$containerName = "supabase_db_EcoleConnet"
Write-Host "[STEP 1/5] Vérification du conteneur local Docker '$containerName'..." -ForegroundColor Yellow

$containerRunning = (docker ps --filter "name=^/${containerName}$" --format "{{.Names}}").Trim()

if ($containerRunning -ne $containerName) {
    Write-Error "ERREUR CRITIQUE : Le conteneur Docker exact '$containerName' n'est pas actif. Obtenu: '$containerRunning'."
    exit 1
}
Write-Host "✓ Conteneur local '$containerName' confirmé et opérationnel." -ForegroundColor Green


# 3. DÉPLOIEMENT DES FIXTURES ET INJECTION DU MARQUEUR LOCAL OBLIGATOIRE
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$setupSqlPath = Join-Path $scriptDir "20260820110001_school_finance_concurrency_setup.sql"

if (-not (Test-Path $setupSqlPath)) {
    Write-Error "Fichier setup introuvable : $setupSqlPath"
    exit 1
}

Write-Host "[STEP 2/5] Injection du marqueur d'environnement local et déploiement des fixtures..." -ForegroundColor Yellow
docker cp "$setupSqlPath" "${containerName}:/tmp/concurrency_setup.sql"

$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    $setupOut = docker exec `
      -e "PGOPTIONS=-c ecoleconnect.finance_concurrency_environment=local_docker_EcoleConnet" `
      -i $containerName `
      psql -U postgres -d postgres -v ON_ERROR_STOP=1 `
      -f /tmp/concurrency_setup.sql 2>&1
    $setupExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($setupExitCode -ne 0) {
    Write-Error "ÉCHEC SETUP CONCURRENCE :`n$setupOut"
    exit 1
}
Write-Host "✓ Fixtures minimales déployées avec le marqueur de sécurité local." -ForegroundColor Green


# 4. SCÉNARIO 1 : CONCURRENCE CLÉ IDEMPOTENCE UNIQUE (DOUBLE CLIC / COURSE RÉSEAU)
Write-Host "[STEP 3/5] Exécution du Scénario 1 : Concurrence Clé d'Idempotence..." -ForegroundColor Yellow

$scen1_sql_a = @"
BEGIN;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.record_student_payment('77777777-7777-4777-a777-777777777771', 100.00, 'cash', 'IDEMP-CONC-001');
SELECT pg_sleep(2);
COMMIT;
"@

$scen1_sql_b = @"
SELECT pg_sleep(0.5);
BEGIN;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.record_student_payment('77777777-7777-4777-a777-777777777771', 100.00, 'cash', 'IDEMP-CONC-001');
COMMIT;
"@

$scen1_sql_a | docker exec -i $containerName bash -c "cat > /tmp/scen1_a.sql"
$scen1_sql_b | docker exec -i $containerName bash -c "cat > /tmp/scen1_b.sql"

$swB1 = [System.Diagnostics.Stopwatch]::StartNew()

$job1A = Start-Job -ScriptBlock {
    param($c)
    $out = docker exec -i $c psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/scen1_a.sql 2>&1
    return [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = ($out -join [Environment]::NewLine) }
} -ArgumentList $containerName

$job1B = Start-Job -ScriptBlock {
    param($c)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $out = docker exec -i $c psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/scen1_b.sql 2>&1
    $sw.Stop()
    return [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = ($out -join [Environment]::NewLine); DurationSec = $sw.Elapsed.TotalSeconds }
} -ArgumentList $containerName

$res1A = Receive-Job -Job $job1A -Wait -AutoRemoveJob
$res1B = Receive-Job -Job $job1B -Wait -AutoRemoveJob
$swB1.Stop()

$durationB1 = $res1B.DurationSec

# Contrôle de robustesse et d'attente effective du verrou
if ($res1A.ExitCode -ne 0) {
    Write-Error "ÉCHEC SCÉNARIO 1 : La session A a échoué. Output A: $($res1A.Output)"
    exit 1
}

if ($res1B.ExitCode -ne 0) {
    Write-Error "ÉCHEC SCÉNARIO 1 : La session B a échoué. Output B: $($res1B.Output)"
    exit 1
}

if ($durationB1 -lt 1.0) {
    Write-Error "ÉCHEC PREUVE VERROU SCÉNARIO 1 : La Session B est revenue immédiatement ($([math]::Round($durationB1, 2))s < 1.0s) sans attendre la libération du verrou advisory de A."
    exit 1
}

if ($res1B.Output -notmatch "is_idempotent_replay.*true") {
    Write-Error "ÉCHEC SCÉNARIO 1 : Le second appel idempotent n'a pas retourné is_idempotent_replay: true. Output B: $($res1B.Output)"
    exit 1
}

# Audit comptable Scénario 1
$verify1_sql = @"
SELECT 
  (SELECT COUNT(*) FROM public.student_payments WHERE idempotency_key = 'IDEMP-CONC-001') AS pay_count,
  (SELECT COUNT(*) FROM public.payment_receipts WHERE invoice_id = '77777777-7777-4777-a777-777777777771') AS rec_count,
  (SELECT paid_amount FROM public.student_invoices WHERE id = '77777777-7777-4777-a777-777777777771') AS paid_amt,
  (SELECT status FROM public.student_invoices WHERE id = '77777777-7777-4777-a777-777777777771') AS status;
"@

$verify1_sql | docker exec -i $containerName bash -c "cat > /tmp/verify1.sql"
$v1_out = docker exec -i $containerName psql -U postgres -d postgres -t -A -F "|" -f /tmp/verify1.sql

$v1_parts = $v1_out.Trim().Split("|")
if ($v1_parts[0] -ne "1" -or $v1_parts[1] -ne "1" -or [decimal]$v1_parts[2] -ne 100.00 -or $v1_parts[3] -ne "paid") {
    Write-Error "ÉCHEC COMPTABLE SCÉNARIO 1 : Attendu 1 paiement, 1 reçu, paid_amount=100.00, status=paid. Obtenu: $v1_out"
    exit 1
}
Write-Host "✓ Scénario 1 réussi : Attente réelle du verrou de $([math]::Round($durationB1, 2))s, 1 seul paiement & 1 seul reçu générés." -ForegroundColor Green


# 5. SCÉNARIO 2 : CONCURRENCE SUR DÉPASSEMENT DE SOLDE (ANTI-SURPAIEMENT)
Write-Host "[STEP 4/5] Exécution du Scénario 2 : Anti-surpaiement concurrent (2x 70 USD sur solde de 100 USD)..." -ForegroundColor Yellow

$scen2_sql_a = @"
BEGIN;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.record_student_payment('77777777-7777-4777-a777-777777777772', 70.00, 'cash', 'IDEMP-CONC-002A');
SELECT pg_sleep(2);
COMMIT;
"@

$scen2_sql_b = @"
SELECT pg_sleep(0.5);
BEGIN;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.record_student_payment('77777777-7777-4777-a777-777777777772', 70.00, 'cash', 'IDEMP-CONC-002B');
COMMIT;
"@

$scen2_sql_a | docker exec -i $containerName bash -c "cat > /tmp/scen2_a.sql"
$scen2_sql_b | docker exec -i $containerName bash -c "cat > /tmp/scen2_b.sql"

$job2A = Start-Job -ScriptBlock {
    param($c)
    $out = docker exec -i $c psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/scen2_a.sql 2>&1
    return [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = ($out -join [Environment]::NewLine) }
} -ArgumentList $containerName

$job2B = Start-Job -ScriptBlock {
    param($c)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $out = docker exec -i $c psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/scen2_b.sql 2>&1
    $sw.Stop()
    return [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = ($out -join [Environment]::NewLine); DurationSec = $sw.Elapsed.TotalSeconds }
} -ArgumentList $containerName

$res2A = Receive-Job -Job $job2A -Wait -AutoRemoveJob
$res2B = Receive-Job -Job $job2B -Wait -AutoRemoveJob

$durationB2 = $res2B.DurationSec

if ($res2A.ExitCode -ne 0) {
    Write-Error "ÉCHEC SCÉNARIO 2 : La session A a échoué. Output A: $($res2A.Output)"
    exit 1
}

if ($durationB2 -lt 1.0) {
    Write-Error "ÉCHEC PREUVE VERROU SCÉNARIO 2 : La Session B est revenue immédiatement ($([math]::Round($durationB2, 2))s < 1.0s) sans attendre la libération du verrou FOR UPDATE de A."
    exit 1
}

# La session B doit impérativement avoir un ExitCode non nul (échec attendu)
if ($res2B.ExitCode -eq 0) {
    Write-Error "ÉCHEC SCÉNARIO 2 : La session B aurait dû échouer pour surpaiement mais est revenue avec ExitCode 0. Output B: $($res2B.Output)"
    exit 1
}

# La session B doit impérativement échouer avec l'exception 22023 (Surpaiement)
if ($res2B.Output -notmatch "22023" -and $res2B.Output -notmatch "dépasse le solde") {
    Write-Error "ÉCHEC SCÉNARIO 2 : La seconde tentative concurrente n'a pas été rejetée pour surpaiement (SQLSTATE 22023 attendu). Output B: $($res2B.Output)"
    exit 1
}

# Audit comptable Scénario 2
$verify2_sql = @"
SELECT paid_amount, remaining_balance, status 
FROM public.student_invoices 
WHERE id = '77777777-7777-4777-a777-777777777772';
"@

$verify2_sql | docker exec -i $containerName bash -c "cat > /tmp/verify2.sql"
$v1_out2 = docker exec -i $containerName psql -U postgres -d postgres -t -A -F "|" -f /tmp/verify2.sql

$v2_parts = $v1_out2.Trim().Split("|")
if ([decimal]$v2_parts[0] -ne 70.00 -or [decimal]$v2_parts[1] -ne 30.00 -or $v2_parts[2] -ne "partially_paid") {
    Write-Error "ÉCHEC COMPTABLE SCÉNARIO 2 : Attendu paid_amount=70.00, remaining_balance=30.00, status=partially_paid. Obtenu: $v1_out2"
    exit 1
}
Write-Host "✓ Scénario 2 réussi : Attente réelle du verrou de $([math]::Round($durationB2, 2))s, second paiement rejeté avec SQLSTATE 22023 (paid_amount=70.00, remaining_balance=30.00)." -ForegroundColor Green


# 6. RAPPORT FINAL DE TEST AVEC PREUVES DE DURÉE DE VERROUILLAGE
Write-Host ""
Write-Host "[STEP 5/5] Rapport d'audit de concurrence..." -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor Green
Write-Host " RAPPORT FINAL : TOUS LES TESTS DE CONCURRENCE SONT PASS (2/2 SCÉNARIOS)" -ForegroundColor Green
Write-Host " --------------------------------------------------------------------" -ForegroundColor Green
Write-Host " - Durée d'attente de verrou Session B (Scénario 1) : $([math]::Round($durationB1, 2))s (>= 1.0s requis)" -ForegroundColor Green
Write-Host " - Durée d'attente de verrou Session B (Scénario 2) : $([math]::Round($durationB2, 2))s (>= 1.0s requis)" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
exit 0
