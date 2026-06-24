// Build step: emit levels.json from the type-checked level library so the game
// can load levels via the JSON loader (with the embedded library as fallback).
import { writeFile } from 'node:fs/promises';
import { LEVEL_LIBRARY, WORLDS } from '../dist/levelData.js';

const bundle = { version: 1, worlds: WORLDS, levels: LEVEL_LIBRARY };
await writeFile(new URL('../levels.json', import.meta.url), JSON.stringify(bundle, null, 2) + '\n');
console.log(`levels.json written: ${LEVEL_LIBRARY.length} levels across ${WORLDS.length} worlds`);
