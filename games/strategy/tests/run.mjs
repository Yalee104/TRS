// Headless test runner: `node games/strategy/tests/run.mjs`
console.log('TRS Command (strategy) — headless logic tests\n');
await import('./strategy.test.mjs');
const { summary } = await import('./harness.mjs');
summary();
