/**
 * Tutorial scripts — one per mechanic-introducing level, keyed by level id.
 * Authored content (sibling of levelData.ts). Each step names what to spotlight
 * by selector; coords are only hardcoded where a selector can't single out one
 * object (the two tunnel mouths, the crossing tile).
 */

import { TutorialScript } from './tutorial.js';

export const TUTORIALS: Record<string, TutorialScript> = {
  '1-2': {
    steps: [
      {
        text: "Boulders block the line. You can't lay track over a rock — route around them to reach the exit.",
        target: { tile: 'rock' },
      },
    ],
  },
  '1-3': {
    steps: [
      { text: 'This is a wagon. Drive the engine over it to couple it on.', target: { entity: 'wagon' } },
      { text: 'Then haul it to the exit. Wagons couple in number order.', target: { tile: 'exit' } },
    ],
  },
  '2-1': {
    steps: [
      { text: 'Tunnels come in pairs. Send the train into one mouth…', target: { cells: [{ x: 3, y: 1 }] } },
      {
        text: '…and it pops out of its partner across the map, slipping past the rock.',
        target: { cells: [{ x: 5, y: 1 }] },
      },
    ],
  },
  '3-1': {
    steps: [
      { text: 'This gate bars the track and starts shut.', target: { tile: 'gate' } },
      { text: 'Roll over its matching button to open it. Same colour = linked.', target: { tile: 'button' } },
    ],
  },
  '4-1': {
    steps: [
      {
        text: 'A signal holds the train on red and passes it on green. It flips every few ticks — time your run to arrive on green.',
        target: { tile: 'signal' },
      },
    ],
  },
  '4-3': {
    steps: [
      { text: 'This trolley roams the rails on its own, back and forth.', target: { entity: 'mover' } },
      {
        text: "Your line crosses its path here. Don't be on the crossing when it passes, or you'll collide — time it.",
        target: { cells: [{ x: 2, y: 2 }] },
      },
    ],
  },
};
