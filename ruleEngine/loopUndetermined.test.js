/**
 * R2c (rule-node-registry): a loop whose bound, iterable or condition is UNDETERMINED makes the
 * enclosing function's answer undetermined, as F4 did for an `if_statement`
 * (ifStatementUndetermined.test.js). They used to be skipped as if the body never ran: `while_loop`
 * read an undefined condition as false, while `for_iter` over a non-array and `for_range` with a
 * non-integer bound returned undefined, so the block carried on and its later statements answered.
 * The exception, as in F4: a loop with no effect at all is skipped, as before.
 *
 * Evaluated through the real createSnapshotInterface.
 */

import { describe, it, expect } from 'vitest';
import { evaluateRule } from '../ruleEngine.js';
import { createSnapshotInterface } from '../snapshotInterface.js';

const unknown = { type: 'name', name: 'not_in_scope' };
const constant = (value) => ({ type: 'constant', value });
const list = (...value) => ({ type: 'list', value });
const ret = (value) => ({ type: 'return', value: constant(value) });
const block = (...statements) => ({ type: 'block', statements });
const ifs = (test, body) => ({ type: 'if_statement', test, body });
const assign = (name, value) => ({ type: 'assign', name, value: constant(value) });
const readVar = (name) => ({ type: 'return', value: { type: 'name', name } });
const forIter = (iterable, body) => ({ type: 'for_iter', var: 'x', iterable, body });
const forRange = (fields, body) => ({ type: 'for_range', var: 'i', ...fields, body });
const whileLoop = (condition, body, orelse) => ({ type: 'while_loop', condition, body, ...(orelse ? { orelse } : {}) });

function ctx(helpers = {}) {
  return createSnapshotInterface({ inventory: {}, player: { id: 1 } }, { game_name: 'Test Game', helpers: { 1: helpers } });
}
const run = (rule) => evaluateRule(rule, ctx());

describe('for_iter over an undetermined or non-iterable value', () => {
  it('body returns: undetermined, not the next statement\'s answer', () => {
    expect(run(block(forIter(unknown, [ret(false)]), ret(true)))).toBeUndefined();
  });

  it('a defined non-array (a number) is not something the engine can iterate: undetermined', () => {
    expect(run(block(forIter(constant(3), [ret(false)]), ret(true)))).toBeUndefined();
  });

  it('a body that only assigns: undetermined (the variable read later is unknown)', () => {
    expect(run(block(assign('y', 1), forIter(unknown, [assign('y', 2)]), readVar('y')))).toBeUndefined();
  });

  it('a body with no effect: skipped, the next statement answers', () => {
    expect(run(block(forIter(unknown, [ifs(unknown, [])]), ret(true)))).toBe(true);
  });

  it('a determined list is unchanged', () => {
    expect(run(block(forIter(list('A'), [ret(false)]), ret(true)))).toBe(false);
    expect(run(block(forIter(list(), [ret(false)]), ret(true)))).toBe(true);
  });
});

describe('for_range with an undetermined or invalid bound', () => {
  it('an undetermined count: undetermined', () => {
    expect(run(block(forRange({ count: unknown }, [ret(false)]), ret(true)))).toBeUndefined();
  });

  it('an undetermined stop: undetermined', () => {
    expect(run(block(forRange({ start: 0, stop: unknown }, [ret(false)]), ret(true)))).toBeUndefined();
  });

  it('a zero step (Python raises): undetermined', () => {
    expect(run(block(forRange({ start: 0, stop: 3, step: 0 }, [ret(false)]), ret(true)))).toBeUndefined();
  });

  it('a body with no effect: skipped', () => {
    expect(run(block(forRange({ count: unknown }, []), ret(true)))).toBe(true);
  });

  it('determined bounds are unchanged', () => {
    expect(run(block(forRange({ count: 2 }, [ret(false)]), ret(true)))).toBe(false);
    expect(run(block(forRange({ count: 0 }, [ret(false)]), ret(true)))).toBe(true);
  });
});

describe('while_loop with an undetermined condition', () => {
  it('body returns: undetermined (it used to read as false and fall through)', () => {
    expect(run(block(whileLoop(unknown, [ret(false)]), ret(true)))).toBeUndefined();
  });

  it('orelse returns: undetermined (it used to run the orelse as for a false condition)', () => {
    expect(run(block(whileLoop(unknown, [{ type: 'break' }], [ret(true)]), ret(false)))).toBeUndefined();
  });

  it('a body with no effect: skipped', () => {
    expect(run(block(whileLoop(unknown, [ifs(unknown, [])]), ret(true)))).toBe(true);
  });

  it('a determined condition is unchanged: false runs the orelse, true runs the body', () => {
    expect(run(block(whileLoop(constant(false), [ret(false)], [ret(true)]), ret(false)))).toBe(true);
    expect(run(block(whileLoop(constant(true), [ret(false)]), ret(true)))).toBe(false);
  });
});

describe('through a helper', () => {
  const helpers = { gate: { params: [], body: block(forIter(unknown, [ret(false)]), ret(true)) } };
  const helper = { type: 'helper', name: 'gate', args: [] };

  it('a data helper with an undetermined loop answers undetermined', () => {
    expect(evaluateRule(helper, ctx(helpers))).toBeUndefined();
  });

  it('inside an and: undetermined, and a false conjunct still decides', () => {
    expect(evaluateRule({ type: 'and', conditions: [helper, constant(true)] }, ctx(helpers))).toBeUndefined();
    expect(evaluateRule({ type: 'and', conditions: [helper, constant(false)] }, ctx(helpers))).toBe(false);
  });
});
