/**
 * The level library — 13 original levels across 4 worlds, each world
 * introducing one mechanic. Authored as type-checked TypeScript (the source of
 * truth); `levels.json` is generated from this at build time and loaded at
 * runtime via the JSON loader (see levelLoader.ts), with this array as the
 * offline fallback.
 *
 * Every level here has a verified solution in `leveltest.ts`, so the whole
 * library is guaranteed solvable within budget by `npm test`.
 */

import { Level } from './level.js';

export interface World {
  id: number;
  name: string;
  blurb: string;
}

export const WORLDS: World[] = [
  { id: 1, name: 'The Yard', blurb: 'Lay track and couple wagons in order.' },
  { id: 2, name: 'Underground', blurb: 'Tunnels teleport across the map.' },
  { id: 3, name: 'Locked Gates', blurb: 'Buttons open the gates that bar the line.' },
  { id: 4, name: 'Signals', blurb: 'Timing, signals and roaming trolleys.' },
];

export const LEVEL_LIBRARY: Level[] = [
  /* ----------------------------- World 1 ----------------------------- */
  {
    id: '1-1',
    world: 1,
    name: 'First Tracks',
    grid: { cols: 6, rows: 3 },
    trackBudget: 4,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [
      { x: 5, y: 1, type: 'exit', heading: 'W' },
      { x: 2, y: 0, type: 'rock' },
    ],
    wagons: [],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },
  {
    id: '1-2',
    world: 1,
    name: 'Around the Rock',
    grid: { cols: 6, rows: 4 },
    trackBudget: 9,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [
      { x: 5, y: 1, type: 'exit', heading: 'W' },
      { x: 2, y: 1, type: 'rock' },
      { x: 3, y: 1, type: 'rock' },
    ],
    wagons: [],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },
  {
    id: '1-3',
    world: 1,
    name: 'Pickup',
    grid: { cols: 6, rows: 3 },
    trackBudget: 4,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [
      { x: 5, y: 1, type: 'exit', heading: 'W' },
      { x: 2, y: 0, type: 'rock' },
    ],
    wagons: [{ x: 3, y: 1, number: 1 }],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },
  {
    id: '1-4',
    world: 1,
    name: 'Two in Order',
    grid: { cols: 7, rows: 3 },
    trackBudget: 5,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [{ x: 6, y: 1, type: 'exit', heading: 'W' }],
    wagons: [
      { x: 2, y: 1, number: 1 },
      { x: 4, y: 1, number: 2 },
    ],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },
  {
    id: '1-5',
    world: 1,
    name: 'Switchback',
    grid: { cols: 5, rows: 3 },
    trackBudget: 6,
    locomotive: { x: 0, y: 0, heading: 'E' },
    fixedTiles: [{ x: 0, y: 2, type: 'exit', heading: 'E' }],
    wagons: [{ x: 2, y: 1, number: 1 }],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },

  /* ----------------------------- World 2 ----------------------------- */
  {
    id: '2-1',
    world: 2,
    name: 'Underpass',
    grid: { cols: 7, rows: 3 },
    trackBudget: 3,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [
      { x: 3, y: 1, type: 'tunnel', edges: ['W'], pairId: 1 },
      { x: 4, y: 1, type: 'rock' },
      { x: 5, y: 1, type: 'tunnel', edges: ['E'], pairId: 1 },
      { x: 6, y: 1, type: 'exit', heading: 'W' },
    ],
    wagons: [{ x: 2, y: 1, number: 1 }],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },
  {
    id: '2-2',
    world: 2,
    name: 'Two Tunnels',
    grid: { cols: 7, rows: 3 },
    trackBudget: 3,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [
      { x: 2, y: 1, type: 'tunnel', edges: ['W'], pairId: 1 },
      { x: 3, y: 1, type: 'rock' },
      { x: 4, y: 1, type: 'tunnel', edges: ['E'], pairId: 1 },
      { x: 6, y: 1, type: 'exit', heading: 'W' },
    ],
    wagons: [
      { x: 1, y: 1, number: 1 },
      { x: 5, y: 1, number: 2 },
    ],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },
  {
    id: '2-3',
    world: 2,
    name: 'Vertical Hop',
    grid: { cols: 5, rows: 5 },
    trackBudget: 3,
    locomotive: { x: 0, y: 0, heading: 'E' },
    fixedTiles: [
      { x: 2, y: 0, type: 'tunnel', edges: ['W'], pairId: 1 },
      { x: 2, y: 4, type: 'tunnel', edges: ['W'], pairId: 1 },
      { x: 0, y: 4, type: 'exit', heading: 'E' },
    ],
    wagons: [],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },

  /* ----------------------------- World 3 ----------------------------- */
  {
    id: '3-1',
    world: 3,
    name: 'Keycard',
    grid: { cols: 7, rows: 3 },
    trackBudget: 3,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [
      { x: 2, y: 1, type: 'button', edges: ['W', 'E'], color: 'red' },
      { x: 4, y: 1, type: 'gate', edges: ['W', 'E'], color: 'red', open: false },
      { x: 6, y: 1, type: 'exit', heading: 'W' },
    ],
    wagons: [],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },
  {
    id: '3-2',
    world: 3,
    name: 'Detour',
    grid: { cols: 6, rows: 3 },
    trackBudget: 5,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [
      { x: 2, y: 0, type: 'button', edges: ['W', 'S'], color: 'blue' },
      { x: 4, y: 1, type: 'gate', edges: ['W', 'E'], color: 'blue', open: false },
      { x: 5, y: 1, type: 'exit', heading: 'W' },
    ],
    wagons: [],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },

  /* ----------------------------- World 4 ----------------------------- */
  {
    id: '4-1',
    world: 4,
    name: 'Stop and Go',
    grid: { cols: 5, rows: 3 },
    trackBudget: 2,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [
      { x: 1, y: 1, type: 'signal', edges: ['W', 'E'], open: false },
      { x: 4, y: 1, type: 'exit', heading: 'W' },
    ],
    wagons: [],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },
  {
    id: '4-2',
    world: 4,
    name: 'Twin Signals',
    grid: { cols: 6, rows: 3 },
    trackBudget: 2,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [
      { x: 1, y: 1, type: 'signal', edges: ['W', 'E'], open: false },
      { x: 3, y: 1, type: 'signal', edges: ['W', 'E'], open: true },
      { x: 5, y: 1, type: 'exit', heading: 'W' },
    ],
    wagons: [],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },
  {
    id: '4-3',
    world: 4,
    name: 'Crossing',
    grid: { cols: 5, rows: 5 },
    trackBudget: 2,
    locomotive: { x: 0, y: 2, heading: 'E' },
    fixedTiles: [
      { x: 2, y: 1, type: 'track', edges: ['N', 'S'] },
      { x: 2, y: 2, type: 'track', edges: ['N', 'E', 'S', 'W'] },
      { x: 2, y: 3, type: 'track', edges: ['N', 'S'] },
      { x: 2, y: 4, type: 'track', edges: ['N'] },
      { x: 4, y: 2, type: 'exit', heading: 'W' },
    ],
    wagons: [],
    movers: [{ x: 2, y: 1, heading: 'S' }],
    objectives: { couple: 'all-in-order', passengers: 0 },
  },
];
