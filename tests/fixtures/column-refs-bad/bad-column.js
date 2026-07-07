// Fixture for tests/column-refs-negative.test.mjs.
//
// Deliberately references a column that does not exist anywhere in
// supabase/migrations/0001_schema.sql, so scripts/check-column-refs.mjs
// must flag it (exit non-zero). This file is NOT part of src/ and is never
// scanned by the real CI column-refs job — it's the negative-test input,
// pointed at explicitly via --dir.

import { supabase } from '../../../src/lib/supabase.js'

export async function bogus(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('id, this_column_does_not_exist')
    .eq('id', userId)
    .single()
  return data
}
