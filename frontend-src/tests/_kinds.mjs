// Shared by every harness in this folder. Read tests/README.md first: every check is one of two kinds.
//   GUARD    true whatever the design is (mechanics, data integrity, honesty, safety). A failed guard fails the run.
//   BEHAVIOR describes today's pencil design (what a button does, a state's name, wording, a threshold). It is
//            REPORTED as "pass" or "changed" and NEVER changes the exit code. When the design changes on purpose,
//            rewrite or delete the behavior check; never bend the design to keep a behavior check green.
// A check that mixes both is two checks.
const guards = { pass: 0, fail: 0, lines: [], rules: new Set() } // rules = distinct guard names; pass/fail count every time one is checked
const behaviors = new Map() // name -> { total, bad, firstDetail }

export function recordGuard(name, passed, detail = '') {
  guards.rules.add(name)
  if (passed) guards.pass++
  else guards.fail++
  guards.lines.push({ name, passed, detail })
}
export function recordBehavior(name, passed, detail = '') {
  const b = behaviors.get(name) || { total: 0, bad: 0, firstDetail: '' }
  b.total++
  if (!passed) { b.bad++; if (!b.firstDetail) b.firstDetail = detail }
  behaviors.set(name, b)
}

// fn throws when the check fails (the style of engine_harness.mjs)
export function guard(name, fn) {
  try { fn(); recordGuard(name, true) } catch (e) { recordGuard(name, false, e.message) }
}
export function behavior(name, fn) {
  try { fn(); recordBehavior(name, true) } catch (e) { recordBehavior(name, false, e.message) }
}
// condition style (the style of the other harnesses). `name` should be stable across calls so behaviors group.
export const okGuard = (cond, name, detail = '') => recordGuard(name, !!cond, detail)
export const okBehavior = (cond, name, detail = '') => recordBehavior(name, !!cond, detail)

export function finish({ printGuardPasses = true, maxFailLines = 40 } = {}) {
  let shown = 0
  for (const g of guards.lines) {
    if (g.passed) { if (printGuardPasses) console.log(`  PASS  ${g.name}`); continue }
    if (shown++ < maxFailLines) console.log(`  FAIL  ${g.name}${g.detail ? '\n        ' + g.detail : ''}`)
  }
  if (shown > maxFailLines) console.log(`  ... and ${shown - maxFailLines} more failed guards`)
  let matching = 0
  let changed = 0
  for (const [name, b] of behaviors) {
    const many = b.total > 1 ? ` (${b.total - b.bad} of ${b.total} match)` : ''
    if (b.bad === 0) { matching++; console.log(`BEHAVIOR (current, pencil): pass — ${name}${many}`) }
    else { changed++; console.log(`BEHAVIOR (current, pencil): changed — ${name}${many}${b.firstDetail ? '\n        e.g. ' + b.firstDetail : ''}`) }
  }
  console.log(`GUARDS: ${guards.rules.size} rules, checked ${guards.pass + guards.fail} times: ${guards.pass} passed, ${guards.fail} failed. BEHAVIOR: ${matching} matching, ${changed} changed (reported only).`)
  console.log(`SUMMARY guards_passed=${guards.pass} guards_failed=${guards.fail} behavior_matching=${matching} behavior_changed=${changed} guard_rules=${guards.rules.size}`)
  process.exit(guards.fail ? 1 : 0)
}
