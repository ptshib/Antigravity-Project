// Fichier : scripts/sql-safety/run-sql-tests.ts
// Lanceur de tests SQL limité à une base Postgres locale explicitement autorisée.
//
// Usage :
//   node scripts/sql-safety/run-sql-tests.ts --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//     --migration supabase/migrations/<version>_<nom>.sql --test supabase/tests/<version>_<nom>_tests.sql [--execute]
//
// Garanties :
//   - `--linked`, `--project-ref` et tout hôte non local sont refusés avant toute lecture de fichier ;
//   - migrations et tests sont assemblés dans une seule transaction BEGIN … ROLLBACK, revalidée après assemblage ;
//   - tout COMMIT / END / ABORT / ROLLBACK interne (premier niveau ou corps PL/pgSQL) bloque l'exécution ;
//   - sans `--execute`, rien n'est exécuté (DRY-RUN) ; avec `--execute`, la variable
//     ECOLELINK_ALLOW_LOCAL_SQL_TESTS=1 est en plus exigée.
//
// Codes de sortie : 0 succès, 1 usage, 2 cible ou autorisation refusée, 3 SQL refusé, 4 échec d'exécution.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkSqlTarget, composeLocalTestRun, redactDbUrl } from './sqlSafety.ts';

const EXIT = { OK: 0, USAGE: 1, REFUSED: 2, SQL_REFUSED: 3, EXECUTION_FAILED: 4 } as const;
const ALLOW_ENV = 'ECOLELINK_ALLOW_LOCAL_SQL_TESTS';

function parseArgs(argv: string[]) {
  const options = { dbUrl: null as string | null, test: null as string | null, migrations: [] as string[], execute: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => inlineValue ?? argv[++i] ?? null;
    if (flag === '--db-url') options.dbUrl = value();
    else if (flag === '--test') options.test = value();
    else if (flag === '--migration') { const v = value(); if (v) options.migrations.push(v); }
    else if (flag === '--execute') options.execute = true;
    else if (flag === '--help' || flag === '-h') options.help = true;
  }
  return options;
}

function main(): number {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);

  const target = checkSqlTarget({ argv, dbUrl: options.dbUrl });
  if (!target.ok) {
    console.error('REFUS — cible non autorisée :');
    for (const reason of target.reasons) console.error(`  - ${reason}`);
    return EXIT.REFUSED;
  }

  if (options.help || !options.test) {
    console.error('Usage : node scripts/sql-safety/run-sql-tests.ts --db-url <url locale> [--migration <fichier>]... --test <fichier> [--execute]');
    return EXIT.USAGE;
  }

  const composed = composeLocalTestRun({
    migrations: options.migrations.map(name => ({ name, sql: readFileSync(name, 'utf8') })),
    test: { name: options.test, sql: readFileSync(options.test, 'utf8') }
  });
  if (composed.sql === null) {
    console.error('REFUS — SQL incompatible avec la garantie de ROLLBACK :');
    for (const v of composed.violations) console.error(`  - [${v.code}] ${v.source} : ${v.detail}`);
    return EXIT.SQL_REFUSED;
  }

  const runFile = join(mkdtempSync(join(tmpdir(), 'ecolelink-sql-test-')), 'run.sql');
  writeFileSync(runFile, composed.sql, 'utf8');
  console.log(`Cible : ${redactDbUrl(options.dbUrl!)}`);
  console.log(`Script assemblé (BEGIN … ROLLBACK) : ${runFile}`);

  if (!options.execute) {
    console.log('DRY-RUN — aucune requête exécutée. Ajouter --execute pour lancer les tests sur la base locale.');
    return EXIT.OK;
  }

  if (process.env[ALLOW_ENV] !== '1') {
    console.error(`REFUS — exécution non autorisée : définir ${ALLOW_ENV}=1 pour confirmer la base locale.`);
    return EXIT.REFUSED;
  }

  const result = spawnSync('npx', ['supabase', 'db', 'query', '--db-url', options.dbUrl!, '-f', runFile], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  return result.status === 0 ? EXIT.OK : EXIT.EXECUTION_FAILED;
}

process.exitCode = main();
