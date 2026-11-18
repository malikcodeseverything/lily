import { buildButterfly } from './butterfly';
import { buildLily } from './lily';
import { buildTree } from './tree';
import type { ShapeDefinition } from './types';

/** Built-in procedural objects, in carousel order. */
export const BUILTIN_SHAPES: ShapeDefinition[] = [
  { id: 'lily', name: 'Lily', build: buildLily },
  { id: 'butterfly', name: 'Butterfly', build: buildButterfly },
  { id: 'tree', name: 'Tree', build: buildTree },
];
