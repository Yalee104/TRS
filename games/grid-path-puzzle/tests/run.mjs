// Headless test runner: `node games/grid-path-puzzle/tests/run.mjs`
// Importing each *.test.mjs file executes its tests (they call test()/assert()).
console.log('grid-path-puzzle — headless logic tests\n');
console.log('generator.test.mjs');
await import('./generator.test.mjs');
console.log('\npathRules.test.mjs');
await import('./pathRules.test.mjs');
console.log('\neffects.test.mjs');
await import('./effects.test.mjs');

const { summary } = await import('./harness.mjs');
summary();
