import { buildButterfly } from './butterfly';
import { buildDragon } from './dragon';
import { buildGalaxy } from './galaxy';
import { buildJellyfish } from './jellyfish';
import { buildKoi } from './koi';
import { buildLily } from './lily';
import { buildSaturn } from './saturn';
import { buildTree } from './tree';
import type { ShapeDefinition } from './types';

/** Built-in procedural objects, in carousel order. */
export const BUILTIN_SHAPES: ShapeDefinition[] = [
  { id: 'lily', name: 'Lily', build: buildLily },
  { id: 'dragon', name: 'Dragon', build: buildDragon },
  { id: 'butterfly', name: 'Butterfly', build: buildButterfly },
  { id: 'tree', name: 'Tree', build: buildTree },
  { id: 'jellyfish', name: 'Jellyfish', build: buildJellyfish },
  { id: 'saturn', name: 'Saturn', build: buildSaturn },
  { id: 'koi', name: 'Koi', build: buildKoi },
  { id: 'galaxy', name: 'Galaxy', build: buildGalaxy },
];
