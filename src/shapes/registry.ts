import { buildLily } from './lily';
import type { ShapeDefinition } from './types';

/** Built-in procedural objects, in carousel order. */
export const BUILTIN_SHAPES: ShapeDefinition[] = [
  { id: 'lily', name: 'Lily', build: buildLily },
];
