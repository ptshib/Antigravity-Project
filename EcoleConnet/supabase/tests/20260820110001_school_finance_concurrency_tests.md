# Protocole de Test de Concurrence Multi-Sessions - Phase Finance 1

**Fichier** : `supabase/tests/20260820110001_school_finance_concurrency_tests.md`  
**Cibles** : Sérialisation d'idempotence (`pg_advisory_xact_lock`), Verrou de solde (`FOR UPDATE`) & Prévention des surpaiements

---

> [!WARNING]
> **ENVIRONNEMENT D'EXÉCUTION OBLIGATOIRE : BASE LOCALE OU BRANCHE JETABLE UNIQUEMENT**
> Ce protocole nécessite deux sessions SQL PostgreSQL concurrentes indépendantes.
> Pour observer les effets réels de sérialisation et de déblocage après validation, la Session A doit effectuer un `COMMIT`. Par conséquent, ce test **ne peut pas être nettoyé par un simple ROLLBACK de la Session B** et **ne doit JAMAIS être exécuté sur un environnement de production ou une base partagée**. Le nettoyage s'effectue exclusivement par un reset de la base locale (`supabase db reset`) ou la suppression de la branche de prévisualisation jetable.

---

## 1. Objectifs Techniques du Protocole

1. **Vérification du Verrou Transactionnel Advisory (`pg_advisory_xact_lock`)** :
   Garantir que deux transactions concurrentes appelant `record_student_payment` avec la même clé d'idempotence pour un même établissement sont sérialisées sans conflit ni exception d'intégrité brute.
2. **Vérification du Rejeu Idempotent Transparent** :
   Confirmer que la deuxième transaction, une fois débloquée par le `COMMIT` de la première, renvoie exactement le snapshot du paiement existant avec `is_idempotent_replay = true` sans insérer de doublon de paiement ni de second reçu officiel.
3. **Vérification du Verrou Ligne Facture (`FOR UPDATE`) & Anti-Surpaiement** :
   Prouver que deux règlements concurrents distincts tentant d'enregistrer un total supérieur au solde restant dû sont sérialisés, la seconde tentative étant immédiatement rejetée avec le code d'erreur `22023` (Rejet Surpaiement).

---

## 2. Préparation des Deux Factures de Test Distinctes (Session Administrative Préalable)

Exécutez ce bloc préalable sous rôle authentifié pour créer et émettre deux factures distinctes :

```sql
BEGIN;

-- Configuration préalable du contexte d'authentification agent financier
SELECT set_config('request.jwt.claim.sub', '<AGENT_A_UUID>', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

-- A. Création et émission de la Facture 1 (100.00 USD) pour le Scénario 1
SELECT public.create_draft_student_invoice(
  '<STUDENT_UUID>',
  '<ACADEMIC_YEAR_UUID>',
  CURRENT_DATE + 30,
  'USD',
  jsonb_build_array(jsonb_build_object('fee_name', 'Frais Scénario 1', 'fee_type', 'autre', 'unit_price', 100.00, 'quantity', 1))
);
-- Noter l'UUID retourné -> '<INV_TEST_1_ID>'
SELECT public.issue_student_invoice('<INV_TEST_1_ID>');

-- B. Création et émission de la Facture 2 (100.00 USD) pour le Scénario 2
SELECT public.create_draft_student_invoice(
  '<STUDENT_UUID>',
  '<ACADEMIC_YEAR_UUID>',
  CURRENT_DATE + 30,
  'USD',
  jsonb_build_array(jsonb_build_object('fee_name', 'Frais Scénario 2', 'fee_type', 'autre', 'unit_price', 100.00, 'quantity', 1))
);
-- Noter l'UUID retourné -> '<INV_TEST_2_ID>'
SELECT public.issue_student_invoice('<INV_TEST_2_ID>');

COMMIT;
```

---

## 3. Scénario 1 : Concurrence sur Même Clé d'Idempotence (Double Clic / Conflit Réseau)

* **Facture ciblée** : `<INV_TEST_1_ID>` (Solde = 100.00 USD).

### Déroulement Pas à Pas entre Session A et Session B

| Étape | Session A (Terminal 1 - Caissier 1) | Session B (Terminal 2 - Caissier 2) | Observation & Comportement Attendu |
|---|---|---|---|
| **1** | `BEGIN;` | `BEGIN;` | Deux transactions distinctes ouvertes. |
| **2** | `SELECT set_config('request.jwt.claim.sub', '<AGENT_A_UUID>', true);`<br>`SELECT set_config('request.jwt.claim.role', 'authenticated', true);`<br>`SET LOCAL ROLE authenticated;` | `SELECT set_config('request.jwt.claim.sub', '<AGENT_A_UUID>', true);`<br>`SELECT set_config('request.jwt.claim.role', 'authenticated', true);`<br>`SET LOCAL ROLE authenticated;` | Authentification simulée agent financier. |
| **3** | `SELECT public.record_student_payment('<INV_TEST_1_ID>', 100.00, 'cash', 'IDEMP-RACE-001');` | -- | La Session A acquiert le verrou advisory exclusif `pg_advisory_xact_lock` et insère le paiement `confirmed`. |
| **4** | -- | `SELECT public.record_student_payment('<INV_TEST_1_ID>', 100.00, 'cash', 'IDEMP-RACE-001');` | **La Session B est instantanément mise en attente** sur le verrou advisory. La console reste bloquée. |
| **5** | `COMMIT;` | -- | La Session A valide la transaction et libère le verrou advisory. |
| **6** | -- | *(Se débloque automatiquement et retourne le résultat)* | **La Session B se débloque** : elle relit le paiement créé par la Session A et retourne `is_idempotent_replay: true` avec le même `payment_id`. |
| **7** | -- | `COMMIT;` | Fin de la Session B. |

### Vérification Comptable Finale Scénario 1
```sql
SELECT COUNT(*) FROM public.student_payments WHERE idempotency_key = 'IDEMP-RACE-001'; -- Attendu : EXACTEMENT 1
SELECT COUNT(*) FROM public.payment_receipts WHERE invoice_id = '<INV_TEST_1_ID>';       -- Attendu : EXACTEMENT 1
SELECT paid_amount, status FROM public.student_invoices WHERE id = '<INV_TEST_1_ID>';    -- Attendu : paid_amount = 100.00, status = 'paid'
```

---

## 4. Scénario 2 : Concurrence sur Clés Distinctes tentant un Surpaiement (Race Condition)

* **Facture ciblée** : `<INV_TEST_2_ID>` (Facture distincte, `total_amount = 100.00 USD`, `paid_amount = 0.00 USD`, `solde = 100.00 USD`).
* Session A tente de payer **70.00 USD** (Clé : `IDEMP-A`).
* Session B tente simultanément de payer **70.00 USD** (Clé : `IDEMP-B`).
* Montant cumulé tenté : **140.00 USD** (Dépassement de 40.00 USD).

### Déroulement Pas à Pas

| Étape | Session A (Terminal 1) | Session B (Terminal 2) | Observation & Comportement Attendu |
|---|---|---|---|
| **1** | `BEGIN;` | `BEGIN;` | Ouverture des transactions. |
| **2** | `SELECT set_config('request.jwt.claim.sub', '<AGENT_A_UUID>', true);`<br>`SELECT set_config('request.jwt.claim.role', 'authenticated', true);`<br>`SET LOCAL ROLE authenticated;` | `SELECT set_config('request.jwt.claim.sub', '<AGENT_A_UUID>', true);`<br>`SELECT set_config('request.jwt.claim.role', 'authenticated', true);`<br>`SET LOCAL ROLE authenticated;` | Authentification simulée agent financier. |
| **3** | `SELECT public.record_student_payment('<INV_TEST_2_ID>', 70.00, 'cash', 'IDEMP-A');` | -- | La Session A acquiert le verrou de ligne `FOR UPDATE` sur la facture `<INV_TEST_2_ID>`. |
| **4** | -- | `SELECT public.record_student_payment('<INV_TEST_2_ID>', 70.00, 'cash', 'IDEMP-B');` | **La Session B est mise en attente** sur le verrou de ligne de la facture `student_invoices`. |
| **5** | `COMMIT;` | -- | La Session A enregistre 70.00 USD. Le nouveau solde restant devient **30.00 USD**. |
| **6** | -- | *(Se débloque et lève immédiatement une exception SQL)* | **ÉCHEC CONTRÔLÉ REQUIS** : `ERROR: REJET SURPAIEMENT : Le montant du paiement (70.00) dépasse le solde restant dû (30.00). (SQLSTATE: 22023)` |
| **7** | -- | `ROLLBACK;` | La Session B annule sa transaction rejetée. |

### Vérification Comptable Finale Scénario 2
```sql
SELECT paid_amount, remaining_balance, status 
FROM public.student_invoices 
WHERE id = '<INV_TEST_2_ID>';
-- Attendu : paid_amount = 70.00, remaining_balance = 30.00, status = 'partially_paid'
```

---

## 5. Nettoyage de l'Environnement de Test
Les triggers d'immuabilité financière interdisant formellement les suppressions directes `DELETE` sur `student_payments` et `payment_receipts`, le nettoyage s'effectue via :
```bash
supabase db reset
```
ou par la suppression de la branche de test jetable.
