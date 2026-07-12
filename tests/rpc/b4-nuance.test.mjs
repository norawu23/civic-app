#!/usr/bin/env node
// tests/rpc/b4-nuance.test.mjs
//
// B4 nuance RPC suite (docs/specs/B4-nuance-rpcs.md "Required tests"):
//
//   1. scoring unit-level (direct nuance_score calls as owner): each rubric
//      rule in isolation; 39/40/41 boundary; gs-09/gs-10 threshold pins
//      (D-013: 0.55, strict >); failed structured -> 2; empty other_side -> 2;
//      gibberish pair -> 3; D-015 pins (whitespace-padded agreement + gs-18
//      char_length() = 40 on live SQL)
//   2. all-20 golden-set SQL-vs-reference agreement (the escalation guard;
//      the full through-the-RPC run is tests/nuance/calibration.test.js in
//      CALIBRATION_TARGET=rpc mode — the calibration harness is the vehicle)
//   3. signature conformance: names/args/returns/SECURITY DEFINER + the
//      grant matrix incl. anon-ONLY grants and the PUBLIC revoke
//   4. invalid_params vs invalid_answers boundary (both sides, both RPC
//      audiences, incl. kind='session' — the D-010-rejected third value)
//   5. grant wall: authed caller on an anon RPC (and vice versa) is stopped
//      by missing EXECUTE, before the body runs
//   6. resubmission battery: authed baseline x2, anon baseline x2, authed +
//      anon day-30 x2 — second call acks, no new row, no 23505
//   7. anon_id_linked [r2] on both anon RPCs
//   8. day-30 preconditions: baseline_missing / 27d -> baseline_too_recent /
//      28d -> accepted with elapsed_days = 28 / authed day-30 against an
//      import-linked baseline (created_at manipulated via SQL — never sleep)
//   9. rate limits [r5]: classroom burst (30/10min OK), 200-in-the-hour ->
//      rate_limited after the 60th, hot-window replay still acks
//      (order pin: duplicate-check BEFORE rate limit), window rollover,
//      missing x-forwarded-for -> shared 'unknown' bucket still limits,
//      first-hop parsing of a multi-hop header
//  10. masking (D-011 ruling 2): own-row column grants both directions;
//      admin also denied direct score SELECT; ack shape carries no score
//
// Requires Docker (supabase CLI stack) or CIVIC_TEST_DB_URL pointing at a
// database prepared with tests/lib/pg-local-stub.sql + the full migration
// chain (incl. 0007). SKIPs (exit 0), not fails, when neither is available —
// per the repo-wide D-017 convention.
//
// Run: node tests/rpc/b4-nuance.test.mjs

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  hasDocker, hasExternalDb, acquireDb, psql,
} from '../lib/supabase-stack.mjs'
import { score as refScore } from '../nuance/reference-scorer.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const GOLDEN_SET = JSON.parse(readFileSync(join(REPO_ROOT, 'tests', 'nuance', 'golden-set.json'), 'utf8'))

function hasPsql() {
  return spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0
}

if (!hasExternalDb() && !hasDocker()) {
  console.log('SKIP rpc/b4-nuance: Docker is not available (required for the supabase CLI local stack) and CIVIC_TEST_DB_URL is not set. Run in CI, a Docker-capable environment, or against a prepared database (tests/lib/pg-local-stub.sql + migrations).')
  process.exit(0)
}
if (!hasPsql()) {
  console.log('SKIP rpc/b4-nuance: psql is not available on PATH.')
  process.exit(0)
}

// ── fixture identities (fixed, readable; cleaned up at start for reruns) ────
const U_BASE = 'b4000000-0000-4000-8000-000000000001'   // authed resubmission
const U_D30 = 'b4000000-0000-4000-8000-000000000002'    // authed day-30 (+ import-linked baseline)
const U_D30_NONE = 'b4000000-0000-4000-8000-000000000003' // authed day-30, no baseline
const U_D30_FRESH = 'b4000000-0000-4000-8000-000000000004' // authed baseline today -> day30 too recent
const U_LINKOWNER = 'b4000000-0000-4000-8000-000000000005' // owns the linked anon_id
const U_PARAMS = 'b4000000-0000-4000-8000-000000000006'  // invalid_params/answers probes
const U_MASK = 'b4000000-0000-4000-8000-000000000007'    // masking assertions
const U_ADMIN = 'b4000000-0000-4000-8000-000000000008'   // admin masking assertion
const ALL_USERS = [U_BASE, U_D30, U_D30_NONE, U_D30_FRESH, U_LINKOWNER, U_PARAMS, U_MASK, U_ADMIN]

const A_RESUB = 'a4000000-0000-4000-8000-000000000001'   // anon resubmission
const A_D30 = 'a4000000-0000-4000-8000-000000000002'     // anon day-30 clock tests
const A_LINKED = 'a4000000-0000-4000-8000-000000000003'  // linked to U_LINKOWNER
const A_PAD = 'a4000000-0000-4000-8000-000000000004'     // D-015 padded input via live RPC
const A_HOPS = 'a4000000-0000-4000-8000-000000000005'    // x-forwarded-for first-hop probe
const A_ROLL = 'a4000000-0000-4000-8000-000000000006'    // window rollover
const ANON_LIKE = 'a4000000-0000-4000-8000-%'            // cleanup pattern
const BURST_LIKE = '%-b4b4-4b4b-8b4b-%'                  // burst anon ids

const TAP_ANSWERS = '[{"question_id":"q1","response_type":"tap","position":"yes"}]'
const HDR = ip => `{"x-forwarded-for":"${ip}"}`

let failed = false
let nPass = 0
let nFail = 0
function check(name, ok, detail) {
  if (ok) { nPass++; console.log(`PASS rpc/b4-nuance: ${name}`) }
  else {
    nFail++; failed = true
    console.error(`FAIL rpc/b4-nuance: ${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`)
  }
}

const esc = s => s.replace(/'/g, "''")

let stack
try {
  stack = acquireDb({ repoRoot: REPO_ROOT, withMigrations: true })
  const dbUrl = stack.dbUrl

  // Superuser query, -t -A (tuples only). Multiple statements run in one
  // implicit transaction; non-zero exit on any error.
  const su = sql => spawnSync('psql', [dbUrl, '-t', '-A', '-c', sql], { encoding: 'utf8' })
  const lastLine = r => {
    const ls = r.stdout.trim().split('\n').filter(l => l.trim() !== '')
    return ls.length ? ls[ls.length - 1].trim() : ''
  }
  // Runs `sql` as a client role, with optional JWT sub + request.headers
  // (mirrors PostgREST's per-request GUCs; same technique as tests/rls/).
  const asRole = (role, jwtSub, headers, sql) => {
    let pre = `set role ${role};`
    if (jwtSub) pre += ` set request.jwt.claims = '{"sub":"${jwtSub}","role":"${role}"}';`
    if (headers) pre += ` set request.headers = '${headers}';`
    return spawnSync('psql', [dbUrl, '-t', '-A', '-c', `${pre} ${sql}`], { encoding: 'utf8' })
  }
  const expectCode = (name, r, code) =>
    check(name, r.status !== 0 && r.stderr.includes(code), `status=${r.status} ${r.stdout} ${r.stderr}`)
  // Success + the return is EXACTLY {accepted: true} (single key) — the
  // information-free S2 ack; a score can never ride it.
  const ackSql = call =>
    `select (r = '{"accepted":true}'::jsonb) and (select count(*) = 1 from jsonb_object_keys(r) k) from (select ${call} as r) s;`
  const expectAck = (name, r) =>
    check(name, r.status === 0 && lastLine(r) === 't', `status=${r.status} ${r.stdout} ${r.stderr}`)

  // ── rerun-safety cleanup (this suite's fixtures only) ─────────────────────
  {
    const r = su(`
      delete from public.nuance_sessions where anon_id like '${ANON_LIKE}' or anon_id like '${BURST_LIKE}' or user_id = any('{${ALL_USERS.join(',')}}'::uuid[]);
      delete from auth.users where id = any('{${ALL_USERS.join(',')}}'::uuid[]);
      delete from public.nuance_rate_limits;
    `)
    if (r.status !== 0) throw new Error(`cleanup failed: ${r.stderr}`)
  }

  // ── seed authed fixture users (fires the 0002 trigger) ────────────────────
  {
    const inserts = ALL_USERS.map(id => `
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
        '${id}@b4-test.local', '', now(), now(), now(), '{}', '{}', '', '', '', ''
      );`).join('\n')
    // U_ADMIN: the 0003 profiles_restrict_update trigger pins is_admin to
    // OLD on every UPDATE (even as superuser), so an UPDATE cannot flag the
    // admin — replace the trigger-created row with a direct INSERT instead
    // (same recipe as tests/rls/policies.test.mjs).
    const r = su(`${inserts}
      delete from public.profiles where id = '${U_ADMIN}';
      insert into public.profiles (id, username, is_admin) values ('${U_ADMIN}', 'b4_mask_admin', true);`)
    if (r.status !== 0) throw new Error(`fixture seed failed: ${r.stderr}`)
  }

  // ═══ 1. scoring unit-level (direct nuance_score calls as owner) ═══════════
  {
    const unit = (name, answersJson, expected) => {
      const r = su(`select public.nuance_score('${esc(answersJson)}'::jsonb);`)
      check(`scoring: ${name}`, r.status === 0 && lastLine(r) === String(expected), `expected ${expected}, got ${lastLine(r)} ${r.stderr}`)
    }
    const s = (position, other) => JSON.stringify([{ question_id: 'q1', response_type: 'structured', position, other_side: other }])
    const LONG = 'Some teens break curfew but most families already follow reasonable house rules.'

    unit("tap 'yes' scores 1", '[{"question_id":"q1","response_type":"tap","position":"yes"}]', 1)
    unit("tap 'no' scores 1", '[{"question_id":"q1","response_type":"tap","position":"no"}]', 1)
    unit("'complicated' scores 2", '[{"question_id":"q1","response_type":"complicated"}]', 2)
    unit('structured, both long + distinct scores 3', s('A'.repeat(50), 'B'.repeat(50)), 3)
    unit('39-char field falls to 2', s('X'.repeat(39), LONG), 2)
    unit('40-char field qualifies for 3', s('X'.repeat(40), LONG), 3)
    unit('41-char field qualifies for 3', s('X'.repeat(41), LONG), 3)
    unit('empty other_side on structured attempt scores 2', s('A'.repeat(50), ''), 2)
    unit('missing other_side key on structured attempt scores 2', JSON.stringify([{ question_id: 'q1', response_type: 'structured', position: 'A'.repeat(50) }]), 2)
    unit('both fields empty on structured attempt scores 2 (never 1)', s('', ''), 2)
    unit('identical copy-paste pair scores 2 (similarity 1.0)', s('Z'.repeat(45), 'Z'.repeat(45)), 2)
    unit('multi-question sum 1+2+3 = 6', JSON.stringify([
      { question_id: 'q1', response_type: 'tap', position: 'yes' },
      { question_id: 'q2', response_type: 'complicated' },
      { question_id: 'q3', response_type: 'structured', position: 'A'.repeat(50), other_side: 'B'.repeat(50) },
    ]), 6)

    // Threshold boundary pins (D-013): gs-09 just above 0.55 -> 2,
    // gs-10 just below -> 3; and the raw similarity values themselves.
    const gs = id => GOLDEN_SET.fixtures.find(f => f.id === id)
    const g9 = gs('gs-09').answers[0]; const g10 = gs('gs-10').answers[0]
    unit('gs-09 (similarity 0.5683 > 0.55) is near-duplicate -> 2', JSON.stringify(gs('gs-09').answers), 2)
    unit('gs-10 (similarity 0.5297 < 0.55) is distinct -> 3', JSON.stringify(gs('gs-10').answers), 3)
    {
      const r = su(`select round(extensions.similarity('${esc(g9.position)}', '${esc(g9.other_side)}')::numeric, 4), round(extensions.similarity('${esc(g10.position)}', '${esc(g10.other_side)}')::numeric, 4);`)
      check('scoring: live pg_trgm similarity pins — gs-09 = 0.5683, gs-10 = 0.5297', r.status === 0 && lastLine(r) === '0.5683|0.5297', `got ${lastLine(r)} ${r.stderr}`)
    }
    {
      const r = su(`select public.nuance_trgm_threshold(), public.nuance_rate_limit_per_hour();`)
      check('parameter slots: nuance_trgm_threshold() = 0.55 (ratified D-013), nuance_rate_limit_per_hour() = 60 [r5]', r.status === 0 && lastLine(r) === '0.55|60', `got ${lastLine(r)} ${r.stderr}`)
    }
    {
      // The values exist ONLY in their slot functions: no other 0.55 / 60
      // literal in the migration's scoring/rate-limit logic.
      const migration = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', '0007_rpc_nuance.sql'), 'utf8')
      const code = migration.split('\n').map(l => l.replace(/--.*$/, '')).join('\n') // comments may cite D-013; CODE may not carry the constant
      const bodyOutsideSlots = code.replace(/create function public\.nuance_trgm_threshold[\s\S]*?\$\$;/, '').replace(/create function public\.nuance_rate_limit_per_hour[\s\S]*?\$\$;/, '')
      check('parameter slots: 0.55 appears in no 0007 CODE outside nuance_trgm_threshold()', !/0\.55/.test(bodyOutsideSlots))
    }

    unit('gibberish pair (gs-11, documented limitation) mechanically scores 3', JSON.stringify(gs('gs-11').answers), 3)

    // ── D-015 pin (a): untrimmed whitespace — padded input agreement ────────
    // A sub-40 field padded with spaces past 40 must score IDENTICALLY
    // through the SQL scorer, the live RPC, and the reference scorer
    // (no trim()/btrim() anywhere in the scoring path).
    {
      const padded = 'Curfews are bad.' + ' '.repeat(30) // 16 content chars + 30 spaces = 46 as stored
      const answers = [{ question_id: 'q1', response_type: 'structured', position: padded, other_side: LONG }]
      const ref = refScore(answers) // reference-scorer verdict (untrimmed: 46 >= 40 -> 3)
      const r = su(`select public.nuance_score('${esc(JSON.stringify(answers))}'::jsonb);`)
      check(`D-015(a): whitespace-padded field — SQL scorer (${lastLine(r)}) agrees with reference scorer (${ref})`, r.status === 0 && lastLine(r) === String(ref), r.stderr)

      const rpc = asRole('anon', null, HDR('192.0.2.15'), ackSql(`public.submit_nuance_baseline_anon('${A_PAD}', '${esc(JSON.stringify(answers))}'::jsonb)`))
      expectAck('D-015(a): padded input through the live anon RPC acks', rpc)
      const stored = su(`select score from public.nuance_sessions where anon_id = '${A_PAD}' and kind = 'baseline';`)
      check(`D-015(a): score stored by the RPC (${lastLine(stored)}) equals the reference scorer (${ref})`, stored.status === 0 && lastLine(stored) === String(ref), stored.stderr)

      const trimCheck = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', '0007_rpc_nuance.sql'), 'utf8')
      const scoringFn = trimCheck.match(/create function public\.nuance_score[\s\S]*?\$\$;/)[0]
      check('D-015(a): no trim()/btrim() anywhere in the nuance_score scoring path', !/\b(btrim|ltrim|rtrim|trim)\s*\(/.test(scoringFn))
    }

    // ── D-015 pin (b): code points are the unit — gs-18 forty-emoji ─────────
    {
      const g18 = gs('gs-18').answers[0]
      const r = su(`select char_length('${esc(g18.position)}');`)
      check('D-015(b): char_length() of gs-18 forty-emoji (U+1F642) position = exactly 40 on live SQL', r.status === 0 && lastLine(r) === '40', `got ${lastLine(r)} ${r.stderr}`)
      unit('D-015(b): gs-18 scores 3 through the SQL scorer (code points, not UTF-16 units)', JSON.stringify(gs('gs-18').answers), 3)
    }
  }

  // ═══ 2. all-20 golden set: SQL scorer vs reference scorer (escalation guard)
  {
    let mismatches = []
    for (const fx of GOLDEN_SET.fixtures) {
      const r = su(`select public.nuance_score('${esc(JSON.stringify(fx.answers))}'::jsonb);`)
      const sqlScore = r.status === 0 ? Number(lastLine(r)) : NaN
      const ref = refScore(fx.answers)
      if (sqlScore !== ref || sqlScore !== fx.expected_score) {
        mismatches.push({ id: fx.id, sql: sqlScore, ref, expected: fx.expected_score })
      }
    }
    check(`golden set: SQL scorer agrees with reference scorer AND expected_score on all ${GOLDEN_SET.fixtures.length} fixtures (any mismatch here is an ESCALATION, never a patch)`, mismatches.length === 0, JSON.stringify(mismatches))
  }

  // ═══ 3. signature conformance + grant matrix ═══════════════════════════════
  {
    const sig = su(`
      select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' secdef=' || p.prosecdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('submit_nuance_session','submit_nuance_baseline_anon','submit_nuance_day30_anon')
      order by p.proname;`)
    const got = sig.stdout.trim().split('\n').map(l => l.trim()).sort()
    const want = [
      'submit_nuance_baseline_anon(anon_id text, answers jsonb) -> jsonb secdef=true',
      'submit_nuance_day30_anon(anon_id text, answers jsonb) -> jsonb secdef=true',
      'submit_nuance_session(kind text, answers jsonb) -> jsonb secdef=true',
    ]
    check('signatures: names, param names/types, returns jsonb, SECURITY DEFINER — verbatim vs frozen contract', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))

    const grants = [
      ['submit_nuance_session(text, jsonb)', 'authenticated', 't'],
      ['submit_nuance_session(text, jsonb)', 'anon', 'f'],
      ['submit_nuance_baseline_anon(text, jsonb)', 'anon', 't'],
      ['submit_nuance_baseline_anon(text, jsonb)', 'authenticated', 'f'],
      ['submit_nuance_day30_anon(text, jsonb)', 'anon', 't'],
      ['submit_nuance_day30_anon(text, jsonb)', 'authenticated', 'f'],
      ['nuance_score(jsonb)', 'anon', 'f'],
      ['nuance_score(jsonb)', 'authenticated', 'f'],
      ['nuance_validate_answers(jsonb)', 'anon', 'f'],
      ['nuance_validate_answers(jsonb)', 'authenticated', 'f'],
      ['nuance_consume_rate_limit()', 'anon', 'f'],
      ['nuance_consume_rate_limit()', 'authenticated', 'f'],
      ['nuance_trgm_threshold()', 'anon', 'f'],
      ['nuance_trgm_threshold()', 'authenticated', 'f'],
      ['nuance_rate_limit_per_hour()', 'anon', 'f'],
      ['nuance_rate_limit_per_hour()', 'authenticated', 'f'],
    ]
    for (const [fn, role, expected] of grants) {
      const r = su(`select has_function_privilege('${role}', 'public.${fn}', 'execute');`)
      check(`grants: ${role} EXECUTE on ${fn} = ${expected === 't' ? 'granted' : 'DENIED'}`, r.status === 0 && lastLine(r) === expected, `got ${lastLine(r)} ${r.stderr}`)
    }

    // PUBLIC revoke on every B4 function: no acl entry with grantee 0 (public).
    const pub = su(`
      select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname = 'public'
        and p.proname in ('submit_nuance_session','submit_nuance_baseline_anon','submit_nuance_day30_anon','nuance_score','nuance_validate_answers','nuance_consume_rate_limit','nuance_trgm_threshold','nuance_rate_limit_per_hour')
        and a.grantee = 0;`)
    check('grants: PUBLIC has EXECUTE on none of the eight B4 functions (grant wall incl. PUBLIC revoke)', pub.status === 0 && lastLine(pub) === '0', `${lastLine(pub)} ${pub.stderr}`)

    // nuance_rate_limits: RLS on, zero policies, zero client grants.
    const rl = su(`
      select (select relrowsecurity from pg_class where oid = 'public.nuance_rate_limits'::regclass),
             (select count(*) from pg_policies where schemaname = 'public' and tablename = 'nuance_rate_limits'),
             has_table_privilege('anon', 'public.nuance_rate_limits', 'select'),
             has_table_privilege('authenticated', 'public.nuance_rate_limits', 'select');`)
    check('nuance_rate_limits: RLS enabled, zero policies, no anon/authenticated SELECT (server-internal)', rl.status === 0 && lastLine(rl) === 't|0|f|f', `${lastLine(rl)} ${rl.stderr}`)
  }

  // ═══ 4. invalid_params vs invalid_answers boundary ═════════════════════════
  {
    const authed = sql => asRole('authenticated', U_PARAMS, null, sql)
    const anon = sql => asRole('anon', null, HDR('192.0.2.30'), sql)
    const FRESH = 'a4000000-0000-4000-8000-0000000000f1' // never inserted: all calls below error first

    // invalid_params side (type/arity breakage).
    expectCode("params: kind='session' (the D-010-rejected third value) -> invalid_params",
      authed(`select public.submit_nuance_session('session', '${TAP_ANSWERS}'::jsonb);`), 'invalid_params')
    expectCode('params: kind=NULL -> invalid_params',
      authed(`select public.submit_nuance_session(null, '${TAP_ANSWERS}'::jsonb);`), 'invalid_params')
    expectCode('params: answers = jsonb object (not an array) -> invalid_params (authed)',
      authed(`select public.submit_nuance_session('baseline', '{"question_id":"q1"}'::jsonb);`), 'invalid_params')
    expectCode('params: answers = jsonb string (not an array) -> invalid_params (authed)',
      authed(`select public.submit_nuance_session('baseline', '"tap"'::jsonb);`), 'invalid_params')
    expectCode('params: answers = NULL -> invalid_params (authed)',
      authed(`select public.submit_nuance_session('baseline', null);`), 'invalid_params')
    expectCode('params: answers = jsonb object -> invalid_params (anon baseline)',
      anon(`select public.submit_nuance_baseline_anon('${FRESH}', '{}'::jsonb);`), 'invalid_params')
    expectCode('params: anon_id not UUID-format -> invalid_params (anon baseline)',
      anon(`select public.submit_nuance_baseline_anon('not-a-uuid', '${TAP_ANSWERS}'::jsonb);`), 'invalid_params')
    expectCode('params: anon_id empty string -> invalid_params (anon day30)',
      anon(`select public.submit_nuance_day30_anon('', '${TAP_ANSWERS}'::jsonb);`), 'invalid_params')
    expectCode('params: anon_id NULL -> invalid_params (anon baseline)',
      anon(`select public.submit_nuance_baseline_anon(null, '${TAP_ANSWERS}'::jsonb);`), 'invalid_params')

    // invalid_answers side (well-formed array, bad content).
    const badContent = [
      ['bad response_type', '[{"question_id":"q1","response_type":"bogus"}]'],
      ['missing question_id', '[{"response_type":"complicated"}]'],
      ['empty-string question_id', '[{"question_id":"","response_type":"complicated"}]'],
      ['non-string question_id', '[{"question_id":7,"response_type":"complicated"}]'],
      ['tap without position', '[{"question_id":"q1","response_type":"tap"}]'],
      ["tap position not literal yes/no", '[{"question_id":"q1","response_type":"tap","position":"maybe"}]'],
      ['non-object array element', '["tap"]'],
      ['duplicate question_id', '[{"question_id":"q1","response_type":"complicated"},{"question_id":"q1","response_type":"complicated"}]'],
      ['empty array (length 0 < 1)', '[]'],
      ['non-string structured position', '[{"question_id":"q1","response_type":"structured","position":42,"other_side":"x"}]'],
    ]
    for (const [name, json] of badContent) {
      expectCode(`answers content: ${name} -> invalid_answers (authed)`,
        authed(`select public.submit_nuance_session('baseline', '${json}'::jsonb);`), 'invalid_answers')
    }
    // Length 13 > 12 and serialized > 8 KB.
    const thirteen = JSON.stringify(Array.from({ length: 13 }, (_, i) => ({ question_id: `q${i}`, response_type: 'complicated' })))
    expectCode('answers content: 13 entries (length > 12) -> invalid_answers',
      authed(`select public.submit_nuance_session('baseline', '${thirteen}'::jsonb);`), 'invalid_answers')
    const huge = JSON.stringify([{ question_id: 'q1', response_type: 'structured', position: 'A'.repeat(9000), other_side: 'B'.repeat(50) }])
    expectCode('answers content: serialized size > 8 KB -> invalid_answers',
      authed(`select public.submit_nuance_session('baseline', '${huge}'::jsonb);`), 'invalid_answers')
    // Same boundary on the anon side.
    expectCode('answers content: bad response_type -> invalid_answers (anon baseline)',
      anon(`select public.submit_nuance_baseline_anon('${FRESH}', '[{"question_id":"q1","response_type":"bogus"}]'::jsonb);`), 'invalid_answers')
    expectCode('answers content: tap without position -> invalid_answers (anon day30)',
      anon(`select public.submit_nuance_day30_anon('${FRESH}', '[{"question_id":"q1","response_type":"tap"}]'::jsonb);`), 'invalid_answers')

    const noRows = su(`select count(*) from public.nuance_sessions where user_id = '${U_PARAMS}' or anon_id = '${FRESH}';`)
    check('boundary probes wrote zero rows', noRows.status === 0 && lastLine(noRows) === '0', noRows.stderr)
  }

  // ═══ 5. grant wall ═════════════════════════════════════════════════════════
  {
    const r1 = asRole('authenticated', U_PARAMS, HDR('192.0.2.31'), `select public.submit_nuance_baseline_anon('a4000000-0000-4000-8000-0000000000f2', '${TAP_ANSWERS}'::jsonb);`)
    check('grant wall: AUTHED caller on submit_nuance_baseline_anon -> permission denied (anon-only grant, D-011)', r1.status !== 0 && /permission denied for function/i.test(r1.stderr), r1.stdout + r1.stderr)
    const r2 = asRole('authenticated', U_PARAMS, HDR('192.0.2.31'), `select public.submit_nuance_day30_anon('a4000000-0000-4000-8000-0000000000f2', '${TAP_ANSWERS}'::jsonb);`)
    check('grant wall: AUTHED caller on submit_nuance_day30_anon -> permission denied (anon-only grant, D-011)', r2.status !== 0 && /permission denied for function/i.test(r2.stderr), r2.stdout + r2.stderr)
    const r3 = asRole('anon', null, HDR('192.0.2.31'), `select public.submit_nuance_session('baseline', '${TAP_ANSWERS}'::jsonb);`)
    check('grant wall: anon caller on submit_nuance_session -> permission denied', r3.status !== 0 && /permission denied for function/i.test(r3.stderr), r3.stdout + r3.stderr)
    const r4 = asRole('anon', null, null, `select public.nuance_score('${TAP_ANSWERS}'::jsonb);`)
    check('grant wall: anon caller on internal nuance_score -> permission denied', r4.status !== 0 && /permission denied for function/i.test(r4.stderr), r4.stdout + r4.stderr)
    const r5 = asRole('authenticated', U_PARAMS, null, `select public.nuance_trgm_threshold();`)
    check('grant wall: authed caller on nuance_trgm_threshold -> permission denied (threshold undisclosed, D-014)', r5.status !== 0 && /permission denied for function/i.test(r5.stderr), r5.stdout + r5.stderr)
  }

  // ═══ 6. resubmission battery (D-011 ruling 4: idempotent success) ══════════
  {
    const count = where => lastLine(su(`select count(*) from public.nuance_sessions where ${where};`))

    // authed baseline x2
    expectAck('resubmission: authed baseline 1st call acks {accepted: true} (exact single-key shape)',
      asRole('authenticated', U_BASE, null, ackSql(`public.submit_nuance_session('baseline', '${TAP_ANSWERS}'::jsonb)`)))
    check('resubmission: authed baseline 1st call wrote exactly 1 row', count(`user_id = '${U_BASE}' and kind = 'baseline'`) === '1')
    expectAck('resubmission: authed baseline 2nd call acks (no error, no 23505)',
      asRole('authenticated', U_BASE, null, ackSql(`public.submit_nuance_session('baseline', '${TAP_ANSWERS}'::jsonb)`)))
    check('resubmission: authed baseline 2nd call wrote NO new row', count(`user_id = '${U_BASE}' and kind = 'baseline'`) === '1')

    // anon baseline x2 — and the replay must not consume rate limit (order
    // pin 4-before-5): counter for this IP unchanged by the 2nd call.
    expectAck('resubmission: anon baseline 1st call acks',
      asRole('anon', null, HDR('192.0.2.40'), ackSql(`public.submit_nuance_baseline_anon('${A_RESUB}', '${TAP_ANSWERS}'::jsonb)`)))
    const rlBefore = lastLine(su(`select coalesce(sum(count), 0) from public.nuance_rate_limits where ip = '192.0.2.40';`))
    expectAck('resubmission: anon baseline 2nd call acks (no error, no 23505)',
      asRole('anon', null, HDR('192.0.2.40'), ackSql(`public.submit_nuance_baseline_anon('${A_RESUB}', '${TAP_ANSWERS}'::jsonb)`)))
    check('resubmission: anon baseline 2nd call wrote NO new row', count(`anon_id = '${A_RESUB}' and user_id is null and kind = 'baseline'`) === '1')
    const rlAfter = lastLine(su(`select coalesce(sum(count), 0) from public.nuance_rate_limits where ip = '192.0.2.40';`))
    check('resubmission: anon replay consumed NO rate-limit budget (duplicate pre-check runs BEFORE rate limit, D-012 §9)', rlBefore === '1' && rlAfter === '1', `before=${rlBefore} after=${rlAfter}`)
  }

  // ═══ 7. anon_id_linked [r2] ════════════════════════════════════════════════
  {
    // Simulated B5 import: a nuance row whose anon_id is now linked (user_id set).
    const r = su(`insert into public.nuance_sessions (user_id, anon_id, kind, answers, score) values ('${U_LINKOWNER}', '${A_LINKED}', 'baseline', '${TAP_ANSWERS}'::jsonb, 1);`)
    if (r.status !== 0) throw new Error(`linked-row seed failed: ${r.stderr}`)
    expectCode('anon_id_linked: linked anon_id rejected on submit_nuance_baseline_anon',
      asRole('anon', null, HDR('192.0.2.50'), `select public.submit_nuance_baseline_anon('${A_LINKED}', '${TAP_ANSWERS}'::jsonb);`), 'anon_id_linked')
    expectCode('anon_id_linked: linked anon_id rejected on submit_nuance_day30_anon',
      asRole('anon', null, HDR('192.0.2.50'), `select public.submit_nuance_day30_anon('${A_LINKED}', '${TAP_ANSWERS}'::jsonb);`), 'anon_id_linked')
  }

  // ═══ 8. day-30 preconditions (clock via SQL created_at — never sleep) ══════
  {
    const anonCall = () => asRole('anon', null, HDR('192.0.2.60'), ackSql(`public.submit_nuance_day30_anon('${A_D30}', '${TAP_ANSWERS}'::jsonb)`))
    const anonErr = () => asRole('anon', null, HDR('192.0.2.60'), `select public.submit_nuance_day30_anon('${A_D30}', '${TAP_ANSWERS}'::jsonb);`)

    expectCode('day-30: no baseline -> baseline_missing (anon)', anonErr(), 'baseline_missing')

    const b = asRole('anon', null, HDR('192.0.2.60'), ackSql(`public.submit_nuance_baseline_anon('${A_D30}', '${TAP_ANSWERS}'::jsonb)`))
    expectAck('day-30 setup: anon baseline accepted', b)
    expectCode('day-30: same-day baseline -> baseline_too_recent (anon)', anonErr(), 'baseline_too_recent')

    su(`update public.nuance_sessions set created_at = now() - interval '27 days' where anon_id = '${A_D30}' and kind = 'baseline';`)
    expectCode('day-30: baseline 27 days old -> baseline_too_recent (anon)', anonErr(), 'baseline_too_recent')

    su(`update public.nuance_sessions set created_at = now() - interval '28 days' where anon_id = '${A_D30}' and kind = 'baseline';`)
    expectAck('day-30: baseline exactly 28 days old -> accepted (anon)', anonCall())
    const el = su(`select elapsed_days from public.nuance_sessions where anon_id = '${A_D30}' and kind = 'day30';`)
    check('day-30: stored elapsed_days = 28', el.status === 0 && lastLine(el) === '28', `got ${lastLine(el)} ${el.stderr}`)

    // day-30 x2 (resubmission battery, day-30 leg — anon).
    expectAck('resubmission: anon day-30 2nd call acks, idempotent', anonCall())
    const c = su(`select count(*) from public.nuance_sessions where anon_id = '${A_D30}' and kind = 'day30';`)
    check('resubmission: anon day-30 2nd call wrote NO new row', lastLine(c) === '1')

    // Authed day-30: no baseline -> baseline_missing.
    expectCode('day-30: authed with no baseline -> baseline_missing',
      asRole('authenticated', U_D30_NONE, null, `select public.submit_nuance_session('day30', '${TAP_ANSWERS}'::jsonb);`), 'baseline_missing')

    // Authed day-30: fresh authed baseline -> too recent.
    expectAck('day-30 setup: authed baseline accepted (U_D30_FRESH)',
      asRole('authenticated', U_D30_FRESH, null, ackSql(`public.submit_nuance_session('baseline', '${TAP_ANSWERS}'::jsonb)`)))
    expectCode('day-30: authed baseline today -> baseline_too_recent',
      asRole('authenticated', U_D30_FRESH, null, `select public.submit_nuance_session('day30', '${TAP_ANSWERS}'::jsonb);`), 'baseline_too_recent')

    // Authed day-30 against an IMPORT-LINKED baseline (the §4.6 point): a
    // linked row (user_id set, anon_id kept) 30 days old is U_D30's earliest
    // baseline; an authed baseline submitted today must not displace it.
    su(`insert into public.nuance_sessions (user_id, anon_id, kind, answers, score, created_at) values ('${U_D30}', 'a4000000-0000-4000-8000-0000000000d3', 'baseline', '${TAP_ANSWERS}'::jsonb, 1, now() - interval '30 days');`)
    expectAck('day-30 setup: authed baseline TODAY also accepted for U_D30 (identity (uid, NULL, baseline) is free)',
      asRole('authenticated', U_D30, null, ackSql(`public.submit_nuance_session('baseline', '${TAP_ANSWERS}'::jsonb)`)))
    expectAck('day-30: authed day-30 against the import-linked baseline works (earliest baseline = the linked 30-day-old row)',
      asRole('authenticated', U_D30, null, ackSql(`public.submit_nuance_session('day30', '${TAP_ANSWERS}'::jsonb)`)))
    const el2 = su(`select elapsed_days from public.nuance_sessions where user_id = '${U_D30}' and kind = 'day30';`)
    check('day-30: authed elapsed_days = 30 (clock from the LINKED baseline, not today\'s)', el2.status === 0 && lastLine(el2) === '30', `got ${lastLine(el2)} ${el2.stderr}`)

    // day-30 x2 (resubmission battery, day-30 leg — authed).
    expectAck('resubmission: authed day-30 2nd call acks, idempotent',
      asRole('authenticated', U_D30, null, ackSql(`public.submit_nuance_session('day30', '${TAP_ANSWERS}'::jsonb)`)))
    const c2 = su(`select count(*) from public.nuance_sessions where user_id = '${U_D30}' and kind = 'day30';`)
    check('resubmission: authed day-30 2nd call wrote NO new row', lastLine(c2) === '1')
  }

  // ═══ 9. rate limits [r5] ═══════════════════════════════════════════════════
  {
    // Classroom burst + saturation, inside ONE rolled-back transaction so
    // now() is frozen (a single hourly window, no wall-clock flake) and no
    // fixture rows persist. Subtransactions (begin/exception) isolate each
    // call exactly like separate requests for error purposes.
    const burst = spawnSync('psql', [dbUrl, '-c', `
      begin;
      select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9"}', true);
      do $burst$
      declare
        i int; ok int := 0; limited int := 0; unexpected int := 0;
        classroom_ok int := 0;
        replay jsonb;
      begin
        -- [r5] classroom shape: 30 submissions in "10 minutes" (well inside
        -- one hourly window), one IP, distinct anon_ids -> ALL must pass.
        for i in 1..30 loop
          begin
            perform public.submit_nuance_baseline_anon(lpad(to_hex(i), 8, '0') || '-b4b4-4b4b-8b4b-cafebabe0001', '${TAP_ANSWERS}'::jsonb);
            classroom_ok := classroom_ok + 1;
          exception when others then null;
          end;
        end loop;
        raise notice 'CLASSROOM ok=%', classroom_ok;

        -- Continue to 200 total in the same hour on the same IP: the 61st
        -- and later must raise rate_limited (limit 60), and nothing else.
        for i in 31..200 loop
          begin
            perform public.submit_nuance_baseline_anon(lpad(to_hex(i), 8, '0') || '-b4b4-4b4b-8b4b-cafebabe0001', '${TAP_ANSWERS}'::jsonb);
            ok := ok + 1;
          exception when others then
            if sqlerrm = 'rate_limited' and sqlstate <> '23505' then limited := limited + 1;
            else unexpected := unexpected + 1; raise notice 'UNEXPECTED sqlstate=% msg=%', sqlstate, sqlerrm;
            end if;
          end;
        end loop;
        raise notice 'BURST ok=% limited=% unexpected=%', classroom_ok + ok, limited, unexpected;

        -- Replay of an ALREADY-SUBMITTED anon_id inside the saturated hot
        -- window: duplicate pre-check fires before the rate limit -> ack.
        replay := public.submit_nuance_baseline_anon(lpad(to_hex(1), 8, '0') || '-b4b4-4b4b-8b4b-cafebabe0001', '${TAP_ANSWERS}'::jsonb);
        raise notice 'REPLAY %', case when replay = '{"accepted":true}'::jsonb then 'OK' else 'BAD ' || replay::text end;
      end
      $burst$;
      rollback;
    `], { encoding: 'utf8' })
    const notices = burst.stderr
    check('burst [r5]: 30 submissions / 1 IP / one window (classroom) ALL pass', /CLASSROOM ok=30\b/.test(notices), notices.slice(0, 800))
    check('burst [r5]: 200 in the hour -> exactly 60 accepted, 140 rate_limited after the 60th, zero unexpected errors (no 23505)', /BURST ok=60 limited=140 unexpected=0\b/.test(notices), notices.slice(0, 800))
    check('burst [r5]: replay inside the saturated hot window still acks (duplicate pre-check BEFORE rate limit)', /REPLAY OK/.test(notices), notices.slice(0, 800))

    // Missing x-forwarded-for -> shared 'unknown' bucket, and it still
    // limits: pre-saturate 'unknown' for the current window, call with NO
    // request.headers at all -> rate_limited. Rolled back.
    const unknown = spawnSync('psql', [dbUrl, '-c', `
      begin;
      insert into public.nuance_rate_limits (ip, window_start, count) values ('unknown', date_trunc('hour', now()), 60);
      select public.submit_nuance_baseline_anon('a4000000-0000-4000-8000-0000000000e1', '${TAP_ANSWERS}'::jsonb);
      rollback;
    `], { encoding: 'utf8' })
    check("rate limit: missing x-forwarded-for header falls into the shared 'unknown' bucket and still limits (never fail-open)", unknown.status !== 0 && unknown.stderr.includes('rate_limited'), unknown.stdout + unknown.stderr)

    // Window rollover (manipulating window_start directly): a saturated row
    // from the PREVIOUS hour does not count against the current window.
    const roll = spawnSync('psql', [dbUrl, '-c', `
      begin;
      select set_config('request.headers', '{"x-forwarded-for":"198.51.100.7"}', true);
      insert into public.nuance_rate_limits (ip, window_start, count) values ('198.51.100.7', date_trunc('hour', now()) - interval '1 hour', 60);
      select (public.submit_nuance_baseline_anon('${A_ROLL}', '${TAP_ANSWERS}'::jsonb) = '{"accepted":true}'::jsonb);
      select count from public.nuance_rate_limits where ip = '198.51.100.7' and window_start = date_trunc('hour', now());
      rollback;
    `], { encoding: 'utf8' })
    check('rate limit: window rollover — a saturated previous-hour window does not limit the current one (fresh count = 1)', roll.status === 0 && /\bt\b/.test(roll.stdout) && /\b1\b/.test(roll.stdout), roll.stdout + roll.stderr)

    // First-hop parsing: multi-hop x-forwarded-for buckets under the FIRST
    // (leftmost) hop.
    const hops = asRole('anon', null, esc(HDR('203.0.113.77, 70.1.1.1, 10.0.0.1').replace('"203', '"203')), ackSql(`public.submit_nuance_baseline_anon('${A_HOPS}', '${TAP_ANSWERS}'::jsonb)`))
    expectAck('rate limit: multi-hop x-forwarded-for accepted', hops)
    const hopRow = su(`select count(*) from public.nuance_rate_limits where ip = '203.0.113.77';`)
    check("rate limit: multi-hop header counted under the FIRST hop ('203.0.113.77')", hopRow.status === 0 && lastLine(hopRow) === '1', `${lastLine(hopRow)} ${hopRow.stderr}`)
  }

  // ═══ 10. masking (D-011 ruling 2) — both directions, admin included ════════
  {
    expectAck('masking setup: U_MASK submits an authed baseline',
      asRole('authenticated', U_MASK, null, ackSql(`public.submit_nuance_session('baseline', '${TAP_ANSWERS}'::jsonb)`)))

    const allowed = asRole('authenticated', U_MASK, null, `select kind, answers, created_at from public.nuance_sessions where user_id = '${U_MASK}';`)
    check('masking: own-row SELECT kind, answers, created_at SUCCEEDS (§5.1.5 "then vs now" stays readable)', allowed.status === 0 && allowed.stdout.includes('baseline'), allowed.stdout + allowed.stderr)

    const fullList = asRole('authenticated', U_MASK, null, `select id, user_id, anon_id, kind, answers, excluded, created_at from public.nuance_sessions where user_id = '${U_MASK}';`)
    check('masking: the exact D-011 column list (id, user_id, anon_id, kind, answers, excluded, created_at) SUCCEEDS', fullList.status === 0 && fullList.stdout.includes('baseline'), fullList.stdout + fullList.stderr)

    const score = asRole('authenticated', U_MASK, null, `select score from public.nuance_sessions where user_id = '${U_MASK}';`)
    check('masking: own-row SELECT score DENIED (permission denied)', score.status !== 0 && /permission denied/i.test(score.stderr), score.stdout + score.stderr)

    const elapsed = asRole('authenticated', U_MASK, null, `select elapsed_days from public.nuance_sessions where user_id = '${U_MASK}';`)
    check('masking: own-row SELECT elapsed_days DENIED', elapsed.status !== 0 && /permission denied/i.test(elapsed.stderr), elapsed.stdout + elapsed.stderr)

    const star = asRole('authenticated', U_MASK, null, `select * from public.nuance_sessions where user_id = '${U_MASK}';`)
    check('masking: own-row SELECT * now ERRORS (C2 must select explicit columns)', star.status !== 0 && /permission denied/i.test(star.stderr), star.stdout + star.stderr)

    // Admin: sees rows via the A3 admin policy, but the role-level column
    // grant denies score/elapsed_days to admins too (G2 must use SECURITY
    // DEFINER views — D-011's sole designated score path).
    const adminKind = asRole('authenticated', U_ADMIN, null, `select count(*) from public.nuance_sessions;`)
    check('masking: admin can still count/see rows through allowed columns', adminKind.status === 0 && Number(lastLine(adminKind)) >= 1, adminKind.stdout + adminKind.stderr)
    const adminScore = asRole('authenticated', U_ADMIN, null, `select score from public.nuance_sessions;`)
    check('masking: ADMIN direct SELECT score also DENIED (role-level grant — G2 views must be SECURITY DEFINER)', adminScore.status !== 0 && /permission denied/i.test(adminScore.stderr), adminScore.stdout + adminScore.stderr)

    const anonSel = asRole('anon', null, null, `select kind from public.nuance_sessions;`)
    check('masking: anon direct SELECT on nuance_sessions still fully denied', anonSel.status !== 0 && /permission denied/i.test(anonSel.stderr), anonSel.stdout + anonSel.stderr)

    // Structural: information_schema column grants = exactly the D-011 list.
    const cols = su(`select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges where table_schema = 'public' and table_name = 'nuance_sessions' and grantee = 'authenticated' and privilege_type = 'SELECT';`)
    check('masking: authenticated column-SELECT grants are EXACTLY the D-011 seven (score/elapsed_days excluded)', cols.status === 0 && lastLine(cols) === 'anon_id,answers,created_at,excluded,id,kind,user_id', `got ${lastLine(cols)} ${cols.stderr}`)
  }
} catch (err) {
  console.error(`FAIL rpc/b4-nuance: harness error: ${err.message}`)
  failed = true
} finally {
  if (stack) stack.release()
}

console.log(`\n=== rpc/b4-nuance summary: ${nPass}/${nPass + nFail} passed ===`)
process.exit(failed ? 1 : 0)
