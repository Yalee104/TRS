// Minimal test harness — no framework (matches the puzzle's tests).
let passed = 0;
let failed = 0;
export function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error(`    ✗ ${msg}`); }
}
export function test(name, fn) {
  const before = failed;
  try { fn(); console.log(`  ${failed === before ? '✓' : '✗'} ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name} — threw: ${e.message}`); }
}
export function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
