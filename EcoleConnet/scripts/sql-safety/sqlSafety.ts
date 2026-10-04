// Fichier : scripts/sql-safety/sqlSafety.ts
// Garde-fous des tests SQL : cible strictement locale et garanties de ROLLBACK.
//
// Incident du 04/10/2026 : un script de diagnostic a concaténé une migration (BEGIN; … COMMIT;) avec sa suite de
// tests (BEGIN; … ROLLBACK;) puis l'a exécutée avec `supabase db query --linked`. Le COMMIT interne a appliqué la
// migration en Production. Ce module refuse toute cible distante et toute instruction de contrôle transactionnel
// capable de terminer la transaction de test avant son ROLLBACK final.
//
// Module pur (aucune API Node) : il est importé par les tests Vitest et par run-sql-tests.ts.

export const LOCAL_DB_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

const FORBIDDEN_TARGET_FLAGS = ['--linked', '--project-ref'];

export interface TargetCheck {
  ok: boolean;
  reasons: string[];
}

/** Masque le mot de passe d'une URL de connexion avant tout affichage. */
export function redactDbUrl(dbUrl: string): string {
  return dbUrl.replace(/(\/\/[^:/@]+:)[^@]*@/, '$1***@');
}

/** Autorise uniquement une URL Postgres explicite vers un hôte local ; refuse toute option ciblant un projet distant. */
export function checkSqlTarget(input: { argv: string[]; dbUrl?: string | null }): TargetCheck {
  const reasons: string[] = [];

  for (const arg of input.argv) {
    const flag = arg.split('=')[0];
    if (FORBIDDEN_TARGET_FLAGS.includes(flag)) {
      reasons.push(`Option interdite « ${flag} » : elle cible un projet Supabase distant.`);
    }
  }

  if (!input.dbUrl) {
    reasons.push('Aucune URL de base locale fournie (--db-url postgresql://…@127.0.0.1:54322/postgres).');
    return { ok: false, reasons };
  }

  let url: URL;
  try {
    url = new URL(input.dbUrl);
  } catch {
    reasons.push('URL de base invalide.');
    return { ok: false, reasons };
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    reasons.push(`Protocole refusé « ${url.protocol} » : seul postgres:// ou postgresql:// est accepté.`);
  }

  const host = url.hostname.toLowerCase();
  if (!LOCAL_DB_HOSTS.includes(host)) {
    const hint = /supabase\.(co|com)$/.test(host) ? ' (projet Supabase hébergé)' : '';
    reasons.push(`Hôte refusé « ${host} »${hint} : seuls ${LOCAL_DB_HOSTS.join(', ')} sont autorisés.`);
  }

  return { ok: reasons.length === 0, reasons };
}

export interface SqlStatement {
  /** Texte de l'instruction, commentaires retirés et littéraux neutralisés. */
  text: string;
  /** Position du premier caractère du segment dans le SQL d'origine. */
  start: number;
  /** Position du `;` terminal (ou fin du texte). */
  end: number;
}

export interface SqlScan {
  statements: SqlStatement[];
  /** Corps entre délimiteurs dollar ($$ … $$, $tag$ … $tag$) : blocs DO, fonctions, EXECUTE dynamiques. */
  dollarBodies: string[];
}

/**
 * Découpe un script SQL en instructions de premier niveau. Les commentaires (--, /* *\/ imbriqués), les chaînes
 * ('…', E'…'), les identifiants ("…") et les corps dollar ne sont jamais interprétés comme des instructions.
 */
export function scanSql(sql: string): SqlScan {
  const statements: SqlStatement[] = [];
  const dollarBodies: string[] = [];
  const n = sql.length;
  let current = '';
  let segmentStart = 0;
  let i = 0;

  const pushStatement = (end: number) => {
    const text = current.replace(/\s+/g, ' ').trim();
    if (text) statements.push({ text, start: segmentStart, end });
    current = '';
    segmentStart = end + 1;
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      const lineEnd = sql.indexOf('\n', i);
      i = lineEnd === -1 ? n : lineEnd + 1;
      current += ' ';
      continue;
    }

    if (ch === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      current += ' ';
      continue;
    }

    if (ch === "'") {
      const isEscapeString = /[eE]/.test(sql[i - 1] ?? '') && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? '');
      i++;
      while (i < n) {
        if (isEscapeString && sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      current += "''";
      continue;
    }

    if (ch === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      current += '""';
      continue;
    }

    if (ch === '$' && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? '')) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length);
        dollarBodies.push(sql.slice(i + tag.length, close === -1 ? n : close));
        i = close === -1 ? n : close + tag.length;
        current += '$$';
        continue;
      }
    }

    if (ch === ';') {
      pushStatement(i);
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  pushStatement(n);
  return { statements, dollarBodies };
}

export type TransactionKeyword =
  | 'BEGIN'
  | 'START TRANSACTION'
  | 'COMMIT'
  | 'COMMIT PREPARED'
  | 'END'
  | 'ABORT'
  | 'ROLLBACK'
  | 'ROLLBACK PREPARED'
  | 'PREPARE TRANSACTION';

const TRANSACTION_PATTERNS: Array<[RegExp, TransactionKeyword | null]> = [
  [/^BEGIN(\s+(TRANSACTION|WORK|ISOLATION|READ|NOT|DEFERRABLE)\b.*)?$/, 'BEGIN'],
  [/^START\s+TRANSACTION\b/, 'START TRANSACTION'],
  [/^COMMIT\s+PREPARED\b/, 'COMMIT PREPARED'],
  [/^COMMIT\b/, 'COMMIT'],
  [/^END(\s+(TRANSACTION|WORK))?(\s+AND\s+(NO\s+)?CHAIN)?$/, 'END'],
  [/^ABORT\b/, 'ABORT'],
  [/^ROLLBACK\s+PREPARED\b/, 'ROLLBACK PREPARED'],
  // ROLLBACK TO SAVEPOINT ne termine pas la transaction.
  [/^ROLLBACK(\s+(TRANSACTION|WORK))?\s+TO\b/, null],
  [/^ROLLBACK\b/, 'ROLLBACK'],
  [/^PREPARE\s+TRANSACTION\b/, 'PREPARE TRANSACTION']
];

/** Retourne le mot-clé de contrôle transactionnel d'une instruction de premier niveau, ou null. */
export function transactionKeyword(statementText: string): TransactionKeyword | null {
  const normalized = statementText.replace(/\s+/g, ' ').trim().toUpperCase();
  for (const [pattern, keyword] of TRANSACTION_PATTERNS) {
    if (pattern.test(normalized)) return keyword;
  }
  return null;
}

/** COMMIT / ROLLBACK dans un corps PL/pgSQL (y compris EXECUTE imbriqués) : refusés, ils terminent la transaction. */
export function findTransactionControlInBodies(dollarBodies: string[]): string[] {
  const found: string[] = [];
  const visit = (body: string) => {
    const inner = scanSql(body);
    for (const statement of inner.statements) {
      const match = /\b(COMMIT|ROLLBACK)\b(?!\s+(TO|PREPARED)\b)/i.exec(statement.text);
      if (match) found.push(statement.text.slice(0, 120));
    }
    inner.dollarBodies.forEach(visit);
  };
  dollarBodies.forEach(visit);
  return found;
}

export interface SqlViolation {
  code:
    | 'MISSING_OUTER_BEGIN'
    | 'MISSING_FINAL_ROLLBACK'
    | 'TOP_LEVEL_TRANSACTION_CONTROL'
    | 'TRANSACTION_CONTROL_IN_BODY';
  source: string;
  detail: string;
}

/**
 * Un script de test exécutable doit : commencer par BEGIN, se terminer par ROLLBACK, et ne contenir aucun autre
 * contrôle transactionnel (ni au premier niveau, ni dans un corps dollar).
 */
export function validateTestScript(sql: string, source = 'script'): SqlViolation[] {
  const { statements, dollarBodies } = scanSql(sql);
  const violations: SqlViolation[] = [];
  const keywords = statements.map(s => transactionKeyword(s.text));
  const last = statements.length - 1;

  if (keywords[0] !== 'BEGIN' && keywords[0] !== 'START TRANSACTION') {
    violations.push({ code: 'MISSING_OUTER_BEGIN', source, detail: 'La première instruction doit être BEGIN.' });
  }
  if (last < 0 || keywords[last] !== 'ROLLBACK') {
    violations.push({ code: 'MISSING_FINAL_ROLLBACK', source, detail: 'La dernière instruction doit être ROLLBACK.' });
  }
  keywords.forEach((keyword, index) => {
    if (keyword && index !== 0 && index !== last) {
      violations.push({
        code: 'TOP_LEVEL_TRANSACTION_CONTROL',
        source,
        detail: `Instruction n°${index + 1} « ${keyword} » : elle termine ou imbrique la transaction de test.`
      });
    }
  });
  for (const statement of findTransactionControlInBodies(dollarBodies)) {
    violations.push({ code: 'TRANSACTION_CONTROL_IN_BODY', source, detail: `COMMIT/ROLLBACK dans un corps PL/pgSQL : ${statement}` });
  }
  return violations;
}

/**
 * Retire l'enveloppe transactionnelle externe (BEGIN … COMMIT d'une migration, BEGIN … ROLLBACK d'un test).
 * Un script sans contrôle transactionnel est accepté tel quel ; tout autre contrôle transactionnel est refusé.
 */
export function unwrapTransaction(
  sql: string,
  expectedEnd: 'COMMIT' | 'ROLLBACK',
  source: string
): { inner: string | null; violations: SqlViolation[] } {
  const { statements, dollarBodies } = scanSql(sql);
  const violations: SqlViolation[] = [];
  for (const statement of findTransactionControlInBodies(dollarBodies)) {
    violations.push({ code: 'TRANSACTION_CONTROL_IN_BODY', source, detail: `COMMIT/ROLLBACK dans un corps PL/pgSQL : ${statement}` });
  }

  const controls = statements
    .map((statement, index) => ({ statement, index, keyword: transactionKeyword(statement.text) }))
    .filter(c => c.keyword !== null);

  if (controls.length === 0) {
    return { inner: violations.length ? null : sql, violations };
  }

  const first = statements[0];
  const last = statements[statements.length - 1];
  const wrapped =
    controls.length === 2 &&
    controls[0].index === 0 &&
    (controls[0].keyword === 'BEGIN' || controls[0].keyword === 'START TRANSACTION') &&
    controls[1].index === statements.length - 1 &&
    controls[1].keyword === expectedEnd;

  if (!wrapped) {
    for (const c of controls) {
      violations.push({
        code: 'TOP_LEVEL_TRANSACTION_CONTROL',
        source,
        detail: `Instruction n°${c.index + 1} « ${c.keyword} » : seule une enveloppe BEGIN … ${expectedEnd} externe est acceptée.`
      });
    }
    return { inner: null, violations };
  }

  return { inner: violations.length ? null : sql.slice(first.end + 1, last.start), violations };
}

export interface SqlSource {
  name: string;
  sql: string;
}

/**
 * Assemble les migrations et la suite de tests dans une unique transaction BEGIN … ROLLBACK, puis revalide le
 * résultat. Toute violation empêche l'exécution.
 */
export function composeLocalTestRun(input: { migrations: SqlSource[]; test: SqlSource }): { sql: string | null; violations: SqlViolation[] } {
  const violations: SqlViolation[] = [];
  const parts: string[] = [];

  for (const migration of input.migrations) {
    const { inner, violations: v } = unwrapTransaction(migration.sql, 'COMMIT', migration.name);
    violations.push(...v);
    if (inner !== null) parts.push(`-- >>> migration : ${migration.name}\n${inner}`);
  }

  const testViolations = validateTestScript(input.test.sql, input.test.name);
  violations.push(...testViolations);
  if (testViolations.length === 0) {
    const { inner, violations: v } = unwrapTransaction(input.test.sql, 'ROLLBACK', input.test.name);
    violations.push(...v);
    if (inner !== null) parts.push(`-- >>> tests : ${input.test.name}\n${inner}`);
  }

  if (violations.length > 0) return { sql: null, violations };

  const composed = `BEGIN;\n${parts.join('\n;\n')}\n;\nROLLBACK;\n`;
  const finalViolations = validateTestScript(composed, 'assemblage final');
  if (finalViolations.length > 0) return { sql: null, violations: finalViolations };
  return { sql: composed, violations: [] };
}
