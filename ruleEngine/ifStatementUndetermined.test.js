/**
 * F4 (rule-node-registry): an `if_statement` whose test is UNDETERMINED (`undefined`) makes the
 * enclosing function's answer undetermined. It used to run neither branch and carry on, so the
 * function returned whatever its later statements said (measured: tunic's `has_required_stats(null)`
 * skipped all four of its stat checks and answered the money check alone, `true`).
 * Two exceptions, where both branches leave the answer the same: identical branches (run), and
 * branches with no effect at all (skipped, as before).
 *
 * Evaluated through the real createSnapshotInterface.
 */

import { describe, it, expect } from 'vitest';
import { evaluateRule } from '../ruleEngine.js';
import { createSnapshotInterface } from '../snapshotInterface.js';

const unknown = { type: 'name', name: 'not_in_scope' };
const constant = (value) => ({ type: 'constant', value });
const ret = (value) => ({ type: 'return', value: constant(value) });
const block = (...statements) => ({ type: 'block', statements });
const ifs = (test, body, orelse) => ({ type: 'if_statement', test, body, ...(orelse ? { orelse } : {}) });
const assign = (name, value) => ({ type: 'assign', name, value: constant(value) });
const readVar = (name) => ({ type: 'return', value: { type: 'name', name } });

function ctx(helpers = {}) {
  return createSnapshotInterface({ inventory: {}, player: { id: 1 } }, { game_name: 'Test Game', helpers: { 1: helpers } });
}
const run = (rule) => evaluateRule(rule, ctx());

describe('an undetermined test makes the enclosing answer undetermined', () => {
  it('the test really is undetermined', () => {
    expect(run(unknown)).toBeUndefined();
  });

  it('body returns: undetermined, not the next statement\'s answer', () => {
    expect(run(block(ifs(unknown, [ret(false)]), ret(true)))).toBeUndefined();
  });

  it('orelse returns: undetermined', () => {
    expect(run(block(ifs(unknown, [assign('x', 1)], [ret(false)]), ret(true)))).toBeUndefined();
  });

  it('a branch that only assigns: undetermined (the variable read later is unknown)', () => {
    expect(run(block(assign('x', 1), ifs(unknown, [assign('x', 2)]), readVar('x')))).toBeUndefined();
  });

  it('a break inside a loop body: the loop and the function are undetermined', () => {
    const loop = { type: 'for_range', var: 'i', count: 3, body: [ifs(unknown, [{ type: 'break' }])] };
    expect(run(block(loop, ret(true)))).toBeUndefined();
  });

  it('both branches the same: that branch runs', () => {
    expect(run(block(ifs(unknown, [ret(false)], [ret(false)]), ret(true)))).toBe(false);
    expect(run(block(ifs(unknown, [assign('x', 7)], [assign('x', 7)]), readVar('x')))).toBe(7);
  });

  it('both branches without effect: skipped, the next statement answers (tunic has_combat_reqs\' reset loops)', () => {
    const inertLoop = { type: 'for_iter', var: 'n', iterable: { type: 'list', value: ['A'] }, body: [ifs(unknown, [])] };
    expect(run(block(ifs(unknown, [inertLoop]), ret(true)))).toBe(true);
    expect(run(block(ifs(unknown, []), ret(false)))).toBe(false);
  });

  it('a data helper with an undetermined if answers undetermined (body is a block)', () => {
    const helpers = { stats: { params: [], body: block(ifs(unknown, [ret(false)]), ret(true)) } };
    expect(evaluateRule({ type: 'helper', name: 'stats', args: [] }, ctx(helpers))).toBeUndefined();
  });

  it('a data helper whose body ROOT is the if (the kh1 shape) answers undetermined', () => {
    const helpers = { gate: { params: [], body: ifs(unknown, [ret(true)], [ret(false)]) } };
    expect(evaluateRule({ type: 'helper', name: 'gate', args: [] }, ctx(helpers))).toBeUndefined();
  });

  it('inside an and: an undetermined helper leaves the and undetermined, a false conjunct still decides', () => {
    const helpers = { stats: { params: [], body: block(ifs(unknown, [ret(false)]), ret(true)) } };
    const helper = { type: 'helper', name: 'stats', args: [] };
    expect(evaluateRule({ type: 'and', conditions: [helper, constant(true)] }, ctx(helpers))).toBeUndefined();
    expect(evaluateRule({ type: 'and', conditions: [helper, constant(false)] }, ctx(helpers))).toBe(false);
  });
});

describe('a determined test is unchanged', () => {
  for (const [test, expected] of [[true, 'body'], [false, 'else'], [1, 'body'], [0, 'else'], ['', 'else'], [null, 'else']]) {
    it(`test ${JSON.stringify(test)} runs the ${expected} branch`, () => {
      const program = block(ifs(constant(test), [ret('body')], [ret('else')]), ret('after'));
      expect(run(program)).toBe(expected);
    });
  }

  it('a false test with no orelse carries on to the next statement', () => {
    expect(run(block(ifs(constant(false), [ret('body')]), ret('after')))).toBe('after');
  });

  it('assignments in the taken branch are seen later', () => {
    expect(run(block(assign('x', 1), ifs(constant(true), [assign('x', 2)]), readVar('x')))).toBe(2);
    expect(run(block(assign('x', 1), ifs(constant(false), [assign('x', 2)]), readVar('x')))).toBe(1);
  });
});
