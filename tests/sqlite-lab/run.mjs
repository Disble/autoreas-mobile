/**
 * SQLite lab runner.
 *
 *   node --no-warnings tests/sqlite-lab/run.mjs          # every scenario
 *   node --no-warnings tests/sqlite-lab/run.mjs h1 h11   # a subset
 *
 * This lab is deliberately OUTSIDE jest: it needs real file-backed connections
 * and real OS-level lock contention across threads. jest.config.js is untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { printResult, VERDICT } from './support/lab.mjs';

const scenarioDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scenarios');
const requested = process.argv.slice(2).map((arg) => arg.toLowerCase());

const files = fs
  .readdirSync(scenarioDir)
  .filter((name) => name.endsWith('.mjs'))
  .sort();

const results = [];
for (const name of files) {
  const id = name.slice(0, 3).replace(/^h0?/, 'h');
  if (requested.length > 0 && !requested.includes(id)) continue;
  const scenario = await import(pathToFileURL(path.join(scenarioDir, name)).href);
  const result = await scenario.run();
  printResult(result);
  results.push(result);
}

console.log('\n\n================ SUMMARY ================');
const width = Math.max(...results.map((r) => r.title.length));
for (const result of results) {
  console.log(`${result.id.padEnd(4)} ${result.title.padEnd(width)}  ${result.verdict}`);
}

const confirmed = results.filter((r) => r.verdict === VERDICT.CONFIRMED).length;
const falsified = results.filter((r) => r.verdict === VERDICT.FALSIFIED).length;
const untestable = results.filter((r) => r.verdict === VERDICT.NOT_FALSIFIABLE).length;
console.log(
  `\n${results.length} scenarios: ${confirmed} CONFIRMED, ${falsified} FALSIFIED, ${untestable} NOT FALSIFIABLE HERE`,
);
console.log('A falsified hypothesis is a result, not a failure. Exit code is 0 either way.');
