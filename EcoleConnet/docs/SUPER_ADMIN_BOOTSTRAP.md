# Procédure de Bootstrap du Premier Super-Administrateur PaTShi-Digital

Ce document décrit la méthode sécurisée pour promouvoir le premier compte utilisateur Auth Supabase en **Super-Administrateur PaTShi-Digital** (`super_admin`) et déployer le module de supervision.

> 🔒 **SÉCURITÉ STRICTE** : Aucun compte super-admin ou mot de passe n'est codé en dur dans le code frontend ni dans les scripts de migration. Cette opération est réalisée manuellement et directement au niveau de la base de données par l'ingénieur PaTShi-Digital.

---

## 1. Ordre d'Exécution des Migrations SQL (Obligatoire)

Dans le **SQL Editor** de votre projet Supabase ([https://supabase.com/dashboard](https://supabase.com/dashboard)), exécutez les fichiers de migration suivants dans cet **ordre exact** :

1. **`supabase/migrations/20260812220000_initial_school_auth_schema.sql`** :
   - Crée la structure des 8 tables fondamentales et les politiques RLS initiales.

2. **`supabase/migrations/20260812230000_school_suspension_audit_schema.sql`** *(Dernière version)* :
   - Ajoute les colonnes de suspension (`suspension_reason`, `suspended_at`, `suspended_by`) à la table `public.schools`.
   - Crée la table d'audit `public.school_audit_logs`.
   - Crée la fonction RPC `public.create_school_admin_profile` pour la création sécurisée d'administrateurs d'écoles.

---

## 2. Déploiement de l'Edge Function `create-school-admin`

Le fichier de l'Edge Function est prêt dans `supabase/functions/create-school-admin/index.ts`.

Pour la déployer sur votre projet Supabase distant :

```bash
# 1. Connectez la CLI Supabase à votre projet (ex: project-ref)
npx supabase login
npx supabase link --project-ref VOTRE_PROJECT_REF

# 2. Déployez l'Edge Function
npx supabase functions deploy create-school-admin
```

> **Remarque** : Si l'Edge Function n'est pas encore déployée, l'application frontend bascule automatiquement et de manière transparente sur la fonction SQL RPC `create_school_admin_profile` ou la création de profil en base pour ne pas bloquer les tests locaux ou de démonstration.

---

## 3. Promotion Étape par Étape du Premier Super-Admin

### Étape 1 : Création du Compte Utilisateur dans Supabase Auth
1. Ouvrez votre console Supabase : [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Allez dans **Authentication** > **Users**.
3. Cliquez sur **Add User** > **Create User**.
4. Renseignez l'adresse email professionnelle (ex: `admin@patshi-digital.com`) et un mot de passe sécurisé.
5. Cliquez sur **Create User**.
6. Dans la liste des utilisateurs, copiez l'**User UID** (ex: `e4b5c7d8-1234-5678-9abc-def012345678`).

---

### Étape 2 : Promotion du Profil en `super_admin` via le SQL Editor

Dans le SQL Editor, exécutez :

```sql
-- Promotion sécurisée d'un utilisateur Auth en Super-Admin PaTShi-Digital
INSERT INTO public.profiles (
  id,
  school_id,
  role,
  first_name,
  last_name,
  display_name,
  is_active
)
VALUES (
  'VOTRE_USER_UUID_ICI'::uuid,  -- Remplacer par l'UUID de auth.users
  NULL,                         -- NULL obligatoire pour le super_admin
  'super_admin',
  'Ingénieur',
  'PaTShi-Digital',
  'PaTShi-Digital Admin',
  true
)
ON CONFLICT (id) DO UPDATE SET
  role = 'super_admin',
  school_id = NULL,
  is_active = true,
  updated_at = now();
```

---

### Étape 3 : Connexion et Supervision Plein Écran
1. Ouvrez l'application web à la route `/connexion`.
2. Connectez-vous avec le compte `super_admin`.
3. Cliquez sur n'importe quel bouton **« Superviser »** d'un établissement pour ouvrir la **Console de Supervision Plein Écran** sur `/app/superadmin/ecoles/:schoolId`.
