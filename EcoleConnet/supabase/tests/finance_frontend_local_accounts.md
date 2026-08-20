# Guide des Comptes et Fixtures Frontend Locales (Phase Finance 2)

> [!CAUTION]
> **AVERTISSEMENT SÉCURITÉ : ENVIRONNEMENT LOCAL DOCKER EXCLUSIF**
> Ces identifiants et fixtures sont strictement réservés aux tests en environnement local Supabase (`127.0.0.1`).
> Ne jamais utiliser ces comptes ou mots de passe sur une instance de production ou un projet Supabase Cloud distant.

---

## 1. Paramètres de Connexion

- **URL API Supabase Locale** : `http://127.0.0.1:54321`
- **URL Application Frontend (Vite)** : `http://localhost:5173`
- **Mot de Passe Local Commun** : `FinanceLocal2026!`

---

## 2. Table des 4 Comptes de Test Auth

| Rôle Métier | Email de Connexion | Mot de Passe Local | Profil & École | Scénario d'Épreuve & Attentes UI |
| :--- | :--- | :--- | :--- | :--- |
| **`school_admin`** | `admin.finance.local@ecoleconnect.test` | `FinanceLocal2026!` | Admin Principal<br>*École Finance Locale* | Connexion sur `http://localhost:5173`. Accès au portail admin complet et à l'onglet *"Finance & Frais"*. Doit voir tous les onglets académiques ET les KPIs financiers globaux USD et CDF. |
| **`finance_agent`** | `agent.finance.local@ecoleconnect.test` | `FinanceLocal2026!` | Agent Financier<br>*École Finance Locale* | Connexion sur `http://localhost:5173`. **Cloisonnement Strict** : Doit être redirigé directement sur l'onglet Finance. Tous les autres onglets administratifs (élèves, cours, calendrier) doivent être masqués. Tester la création de factures brouillons, l'émission et l'encaissement. |
| **`parent`** | `parent.finance.local@ecoleconnect.test` | `FinanceLocal2026!` | Parent d'Élève<br>`ELV-LOC-001` | Connexion au Portail Parent. Consultation de la situation financière de l'enfant. Doit visualiser le solde restant dû (USD et CDF), l'historique des factures et télécharger/imprimer les reçus de paiement sans pouvoir modifier. |
| **`teacher`** | `teacher.finance.local@ecoleconnect.test` | `FinanceLocal2026!` | Enseignant Titulaire<br>*6ème Scientifique Locale* | Connexion au Portail Enseignant. Consultation du widget financier de la classe. Doit visualiser les statistiques globales de conformité (`statut à jour`, `en retard`) **sans voir les montants exacts** (`allow_teacher_finance_amounts = false`). AUCUN bouton d'encaissement ou d'émission. |

---

## 3. Données Financières Pré-Générées (Seed)

Le script de seed injecte les enregistrements initiaux suivants pour l'élève `ELV-LOC-001` :

1. **Facture Brouillon (USD)** : 150.00 USD (Non émise).
2. **Facture Émise Impayée (USD)** : 150.00 USD (Émise via RPC, solde restant 150.00 USD).
3. **Facture Partiellement Payée (CDF)** : 50.000 CDF émises, avec acompte de 20.000 CDF encaissé via `record_student_payment`.
4. **Reçu Officiel** : Reçu généré automatiquement par la RPC pour l'acompte de 20.000 CDF.

---

## 4. Mode d'Emploi et Réinitialisation

- **Pour déployer les fixtures locales** :
  ```powershell
  .\supabase\tests\run_finance_frontend_local_seed.ps1
  ```
- **Pour réinitialiser complètement la base locale en cas de nouveau test** :
  ```bash
  npx supabase db reset
  ```
  *(Ensuite, ré-exécuter le script de runner ci-dessus pour recharger des fixtures neuves).*
