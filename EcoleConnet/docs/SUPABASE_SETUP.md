# Configuration et Guide d'Installation Supabase — ÉcoleConnect (Phase 2A)

Ce guide détaille la procédure complète de configuration de Supabase pour l'application **ÉcoleConnect**.

---

## 1. Récupération des Clés d'API dans la Console Supabase

1. Connectez-vous à votre console Supabase : [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Sélectionnez votre projet ou créez un nouveau projet dédié à **ÉcoleConnect**.
3. Allez dans **Project Settings** (icône d'engrenage) > **API**.
4. Copiez les deux informations publiques :
   - **Project URL** (ex: `https://xyzcompany.supabase.co`)
   - **anon / public key** (ou **publishable key**)

> ⚠️ **AVERTISSEMENT SÉCURITÉ** : Ne copiez et ne divulguez **JAMAIS** la clé `service_role` (Secret Key). Ne l'inscrivez jamais dans le projet frontend ni dans le code source Git.

---

## 2. Configuration des Variables d'Environnement Locales

À la racine du projet frontend, créez un fichier `.env.local` (déjà ignoré par `.gitignore`) :

```env
# Fichier .env.local
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=votre-cle-publique-anon
```

L'application accepte également `VITE_SUPABASE_ANON_KEY` comme nom temporaire si nécessaire, mais privilégie `VITE_SUPABASE_PUBLISHABLE_KEY`.

---

## 3. Exécution de la Migration SQL Initiale

1. Dans la console Supabase, ouvrez l'onglet **SQL Editor**.
2. Créez une **New Query**.
3. Copiez et collez l'intégralité du fichier de migration :
   [`supabase/migrations/20260812220000_initial_school_auth_schema.sql`](../supabase/migrations/20260812220000_initial_school_auth_schema.sql)
4. Cliquez sur **Run** pour exécuter la requête.

### Ce que crée cette migration :
- 8 tables fondamentales : `schools`, `profiles`, `academic_years`, `school_terms`, `classes`, `students`, `parent_student_links`, `teacher_class_assignments`.
- Les 5 rôles scolaires : `super_admin`, `school_admin`, `teacher`, `parent`, `student`.
- Triggers d'intégrité inter-écoles (vérification que parents, élèves et enseignants appartiennent au même `school_id`).
- Protection des colonnes sensibles (`role`, `school_id`, `is_active`) contre les modifications non autorisées par `UPDATE`.
- Politiques **Row Level Security (RLS)** étanches sur chaque table.

---

## 4. Facultatif : Données Fictives de Test (Seed)

Si vous souhaitez peupler l'environnement de test avec l'école fictive de démonstration (*Complexe Scolaire Les Horizons*) :
- Exécutez le script séparé : [`supabase/seed_demo_school.sql`](../supabase/seed_demo_school.sql) dans le SQL Editor.

> 🚨 **Ne pas exécuter le seed sur une base de données de production réelle.**

---

## 5. Mode Démonstration vs Mode Réel

- **Mode Démonstration** : Accessible à l'adresse `/demo` ou depuis la landing page sans authentification et sans Supabase.
- **Mode Réel** : Requiert les variables dans `.env.local` et une session Auth valide.
