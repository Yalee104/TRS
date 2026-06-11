// Headless test runner: `node games/shmup/tests/run.mjs`
console.log('shmup — headless logic tests\n');
console.log('systems.test.mjs');
await import('./systems.test.mjs');
console.log('\neffects.test.mjs');
await import('./effects.test.mjs');
console.log('\nbridge.test.mjs');
await import('./bridge.test.mjs');
const { summary } = await import('./harness.mjs');
summary();
