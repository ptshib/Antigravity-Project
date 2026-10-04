// @vitest-environment node
// Fichier : src/tests/sqlSafetyGuard.test.ts
// Garde-fous des tests SQL (scripts/sql-safety) — aucune requête SQL n'est exécutée par cette suite.

import { describe, it, expect } from 'vitest';
// @ts-ignore
import fs from 'fs';
// @ts-ignore
import path from 'path';
// @ts-ignore
import { spawnSync } from 'child_process';
import {
  checkSqlTarget,
  redactDbUrl,
  scanSql,
  transactionKeyword,
  findTransactionControlInBodies,
  validateTestScript,
  unwrapTransaction,
  composeLocalTestRun
} from '../../scripts/sql-safety/sqlSafety.ts';

declare const process: { cwd: () => string; execPath: string; env: Record<string, string | undefined> };

const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const MIGRATION_FILE = path.join('supabase', 'migrations', '20261004150000_cash_register_journal_rpc.sql');
const TEST_FILE = path.join('supabase', 'tests', '20261004150000_cash_register_journal_rpc_tests.sql');
const readRepoFile = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf-8');

describe('Garde-fous des tests SQL — aucune exécution contre Production', () => {
  describe('1. Cible de connexion', () => {
    it.each(['--linked', '--project-ref', '--project-ref=jgxfzujrsplbgzwouxak'])('refuse l’option %s', (flag) => {
      const check = checkSqlTarget({ argv: [flag], dbUrl: LOCAL_URL });
      expect(check.ok).toBe(false);
      expect(check.reasons.join(' ')).toContain('Option interdite');
    });

    it.each([
      'postgresql://postgres:secret@db.jgxfzujrsplbgzwouxak.supabase.co:5432/postgres',
      'postgresql://postgres.jgxfzujrsplbgzwouxak:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
      'postgresql://postgres:secret@10.0.0.12:5432/postgres',
      'postgresql://postgres:secret@localhost.evil.example:5432/postgres'
    ])('refuse l’hôte distant %s', (dbUrl) => {
      const check = checkSqlTarget({ argv: [], dbUrl });
      expect(check.ok).toBe(false);
      expect(check.reasons.join(' ')).toContain('Hôte refusé');
    });

    it('refuse une URL absente, invalide ou non Postgres', () => {
      expect(checkSqlTarget({ argv: [], dbUrl: null }).ok).toBe(false);
      expect(checkSqlTarget({ argv: [], dbUrl: 'pas une url' }).ok).toBe(false);
      expect(checkSqlTarget({ argv: [], dbUrl: 'https://127.0.0.1:54322/postgres' }).ok).toBe(false);
    });

    it.each([
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      'postgres://postgres:postgres@localhost:54322/postgres',
      'postgresql://postgres:postgres@[::1]:54322/postgres'
    ])('accepte la base locale %s', (dbUrl) => {
      expect(checkSqlTarget({ argv: ['--execute'], dbUrl })).toEqual({ ok: true, reasons: [] });
    });

    it('masque le mot de passe dans les messages', () => {
      expect(redactDbUrl('postgresql://postgres:TopSecret@127.0.0.1:54322/postgres')).toBe('postgresql://postgres:***@127.0.0.1:54322/postgres');
    });
  });

  describe('2. Analyse du SQL', () => {
    it('ignore les mots-clés dans les commentaires, chaînes, identifiants et corps dollar', () => {
      const sql = `-- COMMIT;\n/* ROLLBACK; /* imbriqué COMMIT; */ */\nSELECT 'COMMIT;', E'a\\'; COMMIT;', "COMMIT;" FROM t;\nDO $$ BEGIN RAISE NOTICE 'x'; END $$;`;
      const { statements, dollarBodies } = scanSql(sql);
      expect(statements).toHaveLength(2);
      expect(statements.map(s => transactionKeyword(s.text))).toEqual([null, null]);
      expect(dollarBodies).toHaveLength(1);
    });

    it.each([
      ['BEGIN', 'BEGIN'], ['begin transaction isolation level serializable', 'BEGIN'], ['START TRANSACTION', 'START TRANSACTION'],
      ['COMMIT', 'COMMIT'], ['commit and chain', 'COMMIT'], ['END', 'END'], ['END WORK', 'END'], ['ABORT', 'ABORT'],
      ['ROLLBACK', 'ROLLBACK'], ['COMMIT PREPARED \'x\'', 'COMMIT PREPARED'], ['PREPARE TRANSACTION \'x\'', 'PREPARE TRANSACTION']
    ])('détecte « %s » comme %s', (statement, keyword) => {
      expect(transactionKeyword(statement)).toBe(keyword);
    });

    it('n’assimile pas ROLLBACK TO SAVEPOINT ni les instructions ordinaires à une fin de transaction', () => {
      expect(transactionKeyword('ROLLBACK TO SAVEPOINT avant_test')).toBeNull();
      expect(transactionKeyword('SAVEPOINT avant_test')).toBeNull();
      expect(transactionKeyword('SELECT 1')).toBeNull();
    });

    it('détecte un COMMIT ou ROLLBACK dans un corps PL/pgSQL, y compris dans un EXECUTE imbriqué', () => {
      expect(findTransactionControlInBodies([' BEGIN INSERT INTO t VALUES (1); COMMIT; END '])).toHaveLength(1);
      expect(findTransactionControlInBodies([` BEGIN EXECUTE $q$ ROLLBACK $q$; END `])).toHaveLength(1);
      expect(findTransactionControlInBodies([" BEGIN RAISE NOTICE 'pas de COMMIT ici'; EXCEPTION WHEN OTHERS THEN NULL; END "])).toHaveLength(0);
    });
  });

  describe('3. Garantie de ROLLBACK', () => {
    it('accepte un script BEGIN … ROLLBACK sans contrôle interne', () => {
      expect(validateTestScript('BEGIN; INSERT INTO t VALUES (1); SELECT * FROM t; ROLLBACK;')).toEqual([]);
    });

    it.each([
      ['sans BEGIN initial', 'INSERT INTO t VALUES (1); ROLLBACK;', 'MISSING_OUTER_BEGIN'],
      ['terminé par COMMIT', 'BEGIN; INSERT INTO t VALUES (1); COMMIT;', 'MISSING_FINAL_ROLLBACK'],
      ['avec COMMIT interne', 'BEGIN; INSERT INTO t VALUES (1); COMMIT; BEGIN; SELECT 1; ROLLBACK;', 'TOP_LEVEL_TRANSACTION_CONTROL'],
      ['avec END interne', 'BEGIN; SELECT 1; END; SELECT 2; ROLLBACK;', 'TOP_LEVEL_TRANSACTION_CONTROL'],
      ['avec COMMIT dans un bloc DO', 'BEGIN; DO $$ BEGIN COMMIT; END $$; ROLLBACK;', 'TRANSACTION_CONTROL_IN_BODY']
    ])('refuse un script %s', (_label, sql, code) => {
      expect(validateTestScript(sql).map(v => v.code)).toContain(code);
    });

    it('retire uniquement l’enveloppe externe d’une migration BEGIN … COMMIT', () => {
      const { inner, violations } = unwrapTransaction('BEGIN;\nCREATE TABLE t (id int);\nCOMMIT;\n', 'COMMIT', 'm');
      expect(violations).toEqual([]);
      expect(inner?.trim()).toBe('CREATE TABLE t (id int);');
      expect(unwrapTransaction('CREATE TABLE t (id int);', 'COMMIT', 'm').inner).toBe('CREATE TABLE t (id int);');
    });

    it('refuse une migration contenant plusieurs transactions', () => {
      const { inner, violations } = unwrapTransaction('BEGIN; CREATE TABLE a (id int); COMMIT; BEGIN; CREATE TABLE b (id int); COMMIT;', 'COMMIT', 'm');
      expect(inner).toBeNull();
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  describe('4. Reproduction de l’incident du 04/10/2026 avec les fichiers réels', () => {
    it('détecte la concaténation brute migration + tests (COMMIT interne avant le ROLLBACK)', () => {
      const raw = `${readRepoFile(MIGRATION_FILE)}\n${readRepoFile(TEST_FILE)}`;
      const codes = validateTestScript(raw, 'full_test.sql').map(v => v.code);
      expect(codes).toContain('TOP_LEVEL_TRANSACTION_CONTROL');
    });

    it('assemble migration + tests dans une seule transaction terminée par ROLLBACK', () => {
      const { sql, violations } = composeLocalTestRun({
        migrations: [{ name: MIGRATION_FILE, sql: readRepoFile(MIGRATION_FILE) }],
        test: { name: TEST_FILE, sql: readRepoFile(TEST_FILE) }
      });
      expect(violations).toEqual([]);
      expect(sql).not.toBeNull();
      const keywords = scanSql(sql!).statements.map(s => transactionKeyword(s.text)).filter(Boolean);
      expect(keywords).toEqual(['BEGIN', 'ROLLBACK']);
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_school_cash_register_journal');
    });
  });

  describe('5. Lanceur run-sql-tests.ts (processus isolé, aucune exécution SQL)', () => {
    const runner = path.join(process.cwd(), 'scripts', 'sql-safety', 'run-sql-tests.ts');
    const run = (args: string[]) => {
      const env = { ...process.env };
      delete env.ECOLELINK_ALLOW_LOCAL_SQL_TESTS;
      const result = spawnSync(process.execPath, [runner, ...args], { cwd: process.cwd(), env, encoding: 'utf-8' });
      return { status: result.status as number, output: `${result.stdout}${result.stderr}` };
    };

    it('refuse --linked avant toute lecture de fichier', () => {
      const { status, output } = run(['--linked', '--test', 'fichier-inexistant.sql']);
      expect(status).toBe(2);
      expect(output).toContain('Option interdite');
    });

    it('refuse une URL Supabase hébergée même avec --execute', () => {
      const { status, output } = run(['--db-url', 'postgresql://postgres:x@db.jgxfzujrsplbgzwouxak.supabase.co:5432/postgres', '--test', TEST_FILE, '--execute']);
      expect(status).toBe(2);
      expect(output).toContain('Hôte refusé');
      expect(output).not.toContain('postgres:x@');
    });

    it('refuse un script de test contenant un COMMIT interne', () => {
      const { status, output } = run(['--db-url', LOCAL_URL, '--test', MIGRATION_FILE]);
      expect(status).toBe(3);
      expect(output).toContain('MISSING_FINAL_ROLLBACK');
    });

    it('fonctionne en DRY-RUN par défaut sur une cible locale', () => {
      const { status, output } = run(['--db-url', LOCAL_URL, '--migration', MIGRATION_FILE, '--test', TEST_FILE]);
      expect(status).toBe(0);
      expect(output).toContain('DRY-RUN — aucune requête exécutée');
      expect(output).toContain('postgresql://postgres:***@127.0.0.1:54322/postgres');
    });

    it('exige ECOLELINK_ALLOW_LOCAL_SQL_TESTS=1 pour exécuter, même sur une base locale', () => {
      const { status, output } = run(['--db-url', LOCAL_URL, '--migration', MIGRATION_FILE, '--test', TEST_FILE, '--execute']);
      expect(status).toBe(2);
      expect(output).toContain('exécution non autorisée');
    });
  });
});
