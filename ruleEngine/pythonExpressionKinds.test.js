/**
 * The Python expression/statement kinds the exporter emits into helper bodies that the engine had no
 * handler for (rule-node-registry R2b, ⚖ D5 step 3): tuple_assign (tunic `has_required_stats`),
 * formatted_value (dark_souls_3 `_can_go_to`), set_comprehension, starred. Python semantics; an
 * undecidable value is undetermined (⚖ D3).
 *
 * Evaluated through the real createSnapshotInterface.
 */

import { describe, it, expect } from 'vitest';
import { evaluateRule } from '../ruleEngine.js';
import { createSnapshotInterface } from '../snapshotInterface.js';

const c = (value) => ({ type: 'constant', value });
const n = (name) => ({ type: 'name', name });
const ret = (value) => ({ type: 'return', value });
const block = (...statements) => ({ type: 'block', statements });

function ctx(inventory = {}, helpers = {}) {
  return createSnapshotInterface(
    { inventory, player: { id: 1 } },
    { game_name: 'Test Game', helpers: { 1: helpers } },
  );
}

// tunic's get_att_level shape: a tuple of expressions over the body's own locals.
const levels = {
  params: [],
  body: block(
    { type: 'assign', name: 'att', value: { type: 'state_method', method: 'count', args: [c('ATT')] } },
    ret({ type: 'tuple', elements: [{ type: 'binary_op', left: n('att'), op: '+', right: c(1) }, n('att')] }),
  ),
};

describe('tuple_assign unpacks like Python', () => {
  const unpackThen = (expr) => block(
    { type: 'tuple_assign', targets: ['level', 'offerings'], value: { type: 'helper', name: 'levels' } },
    ret(expr),
  );

  it('binds each target from a tuple built of the callee\'s locals', () => {
    const rule = unpackThen({ type: 'binary_op', left: n('level'), op: '*', right: c(10) });
    expect(evaluateRule(rule, ctx({ ATT: 2 }, { levels }))).toBe(30);
    expect(evaluateRule(unpackThen(n('offerings')), ctx({ ATT: 2 }, { levels }))).toBe(2);
  });

  it('decides a comparison on the unpacked values (has_required_stats)', () => {
    const rule = unpackThen({ type: 'compare', left: n('level'), op: '>=', right: c(3) });
    expect(evaluateRule(rule, ctx({ ATT: 1 }, { levels }))).toBe(false);
    expect(evaluateRule(rule, ctx({ ATT: 2 }, { levels }))).toBe(true);
  });

  it('a length mismatch or a non-sequence leaves every target undetermined', () => {
    for (const value of [{ type: 'tuple', elements: [c(1), c(2), c(3)] }, c(7)]) {
      const rule = block({ type: 'tuple_assign', targets: ['a', 'b'], value }, ret(n('a')));
      expect(evaluateRule(rule, ctx())).toBeUndefined();
    }
  });
});

describe('formatted_value is Python str() of its expression', () => {
  const fstr = (inner) => ({
    type: 'f_string',
    parts: [c('Go To '), { type: 'formatted_value', value: inner }],
  });

  it('formats a local inside an f-string (dark_souls_3 _can_go_to)', () => {
    const rule = block({ type: 'assign', name: 'region', value: c('Firelink') }, ret(fstr(n('region'))));
    expect(evaluateRule(rule, ctx())).toBe('Go To Firelink');
  });

  it('renders booleans and None the Python way', () => {
    expect(evaluateRule(fstr(c(true)), ctx())).toBe('Go To True');
    expect(evaluateRule({ type: 'formatted_value', value: c(null) }, ctx())).toBe('None');
  });

  it('is undetermined when its expression is', () => {
    expect(evaluateRule({ type: 'formatted_value', value: { type: 'no_such_kind' } }, ctx())).toBeUndefined();
  });
});

describe('set_comprehension is a deduplicated generator', () => {
  const comp = (element, iterator, extra = {}) => ({
    type: 'set_comprehension',
    element,
    comprehension: { target: n('x'), iterator, conditions: [], ...extra },
  });
  const list = (...values) => ({ type: 'list', value: values.map(c) });

  it('deduplicates by value, so len() counts distinct elements', () => {
    const set = comp({ type: 'binary_op', left: n('x'), op: '%', right: c(2) }, list(1, 2, 3, 5));
    expect(evaluateRule(set, ctx())).toEqual([1, 0]);
    expect(evaluateRule({ type: 'call', func: 'len', args: [set] }, ctx())).toBe(2);
  });

  it('treats True and 1 as one element', () => {
    expect(evaluateRule(comp(n('x'), list(1, true, 0)), ctx())).toEqual([1, 0]);
  });

  it('flattens the exporter\'s nested multi-for form', () => {
    const inner = {
      type: 'set_comprehension',
      element: { type: 'binary_op', left: n('x'), op: '+', right: n('y') },
      comprehension: { target: n('y'), iterator: list(0, 10), conditions: [] },
    };
    expect(evaluateRule(comp(inner, list(1, 2)), ctx())).toEqual([1, 11, 2, 12]);
  });

  it('is undetermined when an element is', () => {
    expect(evaluateRule(comp({ type: 'no_such_kind' }, list(1)), ctx())).toBeUndefined();
  });
});

describe('starred spreads inside a literal or call, and only there', () => {
  const xs = { type: 'list', value: [c(1), c(2)] };

  it('spreads an unresolved iterable into a list, tuple and call', () => {
    expect(evaluateRule({ type: 'list', value: [{ type: 'starred', value: xs }, c(3)] }, ctx())).toEqual([1, 2, 3]);
    expect(evaluateRule({ type: 'tuple', elements: [c(0), { type: 'starred', value: xs }] }, ctx())).toEqual([0, 1, 2]);
    expect(evaluateRule({ type: 'call', func: 'max', args: [{ type: 'starred', value: xs }] }, ctx())).toBe(2);
  });

  it('spreads the exporter\'s resolved form (unpacked_args)', () => {
    const resolved = { type: 'starred', unpacked_args: [c('a'), c('b')] };
    expect(evaluateRule({ type: 'set', elements: [resolved, c('a')] }, ctx())).toEqual(['a', 'b']);
  });

  it('a non-iterable spread, or a bare starred, is undetermined', () => {
    expect(evaluateRule({ type: 'list', value: [{ type: 'starred', value: c(5) }] }, ctx())).toBeUndefined();
    expect(evaluateRule({ type: 'starred', value: xs }, ctx())).toBeUndefined();
  });
});

describe('list / tuple / set literals see the helper body\'s locals', () => {
  it('a tuple of locals is the locals\' values, not undetermined', () => {
    const rule = block({ type: 'assign', name: 'a', value: c(4) }, ret({ type: 'tuple', elements: [n('a'), n('a')] }));
    expect(evaluateRule(rule, ctx())).toEqual([4, 4]);
  });
});

// The rest of tunic has_required_stats' path, found by diffing it against the Python function over
// 62 inventories × 19 areas (1083/1178 agreed before these, 1178/1178 after).
describe('attribute access on a NamedTuple the exporter serialised', () => {
  const stats = { _namedtuple_type: 'AreaStats', _namedtuple_fields: ['att_level', 'equipment'], _namedtuple_values: [5, ['Sword']] };
  it('reads the field by position', () => {
    const rule = (attr) => block({ type: 'assign', name: 'data', value: c(stats) }, ret({ type: 'attribute', object: n('data'), attr }));
    expect(evaluateRule(rule('att_level'), ctx())).toBe(5);
    expect(evaluateRule(rule('equipment'), ctx())).toEqual(['Sword']);
  });
});

describe('for_range follows Python range()', () => {
  const sumOver = (range) => block(
    { type: 'assign', name: 'total', value: c(0) },
    { type: 'for_range', var: 'i', ...range, body: [{ type: 'assign', name: 'total', op: '+=', value: n('i') }] },
    ret(n('total')),
  );
  it('range(start, stop) — the exporter writes `stop`', () => {
    expect(evaluateRule(sumOver({ start: c(2), stop: c(5) }), ctx())).toBe(2 + 3 + 4);
  });
  it('range(start, stop, step), including a negative step', () => {
    expect(evaluateRule(sumOver({ start: c(0), stop: c(7), step: c(3) }), ctx())).toBe(0 + 3 + 6);
    expect(evaluateRule(sumOver({ start: c(3), stop: c(0), step: c(-1) }), ctx())).toBe(3 + 2 + 1);
  });
  it('range(count) and an empty range', () => {
    expect(evaluateRule(sumOver({ count: c(4) }), ctx())).toBe(0 + 1 + 2 + 3);
    expect(evaluateRule(sumOver({ start: c(5), stop: c(2) }), ctx())).toBe(0);
  });
  it('a non-integer bound or a zero step is undetermined (Python raises)', () => {
    const loop = (range) => ({ type: 'for_range', var: 'i', ...range, body: [ret(c(true))] });
    expect(evaluateRule(loop({ start: c(0), stop: c(1.5) }), ctx(), 0, {})).toBeUndefined();
    expect(evaluateRule(loop({ start: c(0), stop: c(3), step: c(0) }), ctx(), 0, {})).toBeUndefined();
    expect(evaluateRule(loop({ start: c(0), stop: c(3) }), ctx(), 0, {})).toBe(true);
  });
});

describe('set()/list mutators on a local', () => {
  const call = (obj, attr, arg) => ({ type: 'function_call', function: { type: 'attribute', object: n(obj), attr }, args: [arg] });
  const tuple = (...v) => ({ type: 'tuple', elements: v.map(c) });
  it('set.add skips a value already present, by value', () => {
    const rule = block(
      { type: 'assign', name: 'opts', value: { type: 'helper', name: 'set' } },
      call('opts', 'add', tuple(1, 2)), call('opts', 'add', tuple(1, 2)), call('opts', 'add', tuple(0, 3)),
      ret({ type: 'call', func: 'len', args: [n('opts')] }),
    );
    expect(evaluateRule(rule, ctx())).toBe(2);
  });
  it('list.append keeps duplicates', () => {
    const rule = block(
      { type: 'assign', name: 'xs', value: { type: 'list', value: [] } },
      call('xs', 'append', c(1)), call('xs', 'append', c(1)),
      ret(n('xs')),
    );
    expect(evaluateRule(rule, ctx())).toEqual([1, 1]);
  });
});
