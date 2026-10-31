/**
 * ⚖ CATCH + REPORT (user, 2026-10-31): both rule formats catch a throwing node,
 * log it at `error`, answer `undefined`, and report it once through the
 * context's optional `onRuleError` hook. With no hook the result is the AST
 * path's long-standing behaviour, for both formats. A throwing hook never escapes.
 *
 * Before this, only the AST path (`rule.type`) was inside a try; a Rule Builder
 * throw (`{rule: 'List', args: {value: 5}}` → `listValue.map is not a function`)
 * escaped `evaluateRule`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluateRule } from '../ruleEngine.js';
import { createSnapshotInterface } from '../snapshotInterface.js';

const RB_THROW = { rule: 'List', args: { value: 5 } };
const AST_THROW = { type: 'item_check', item: { type: 'constant', value: 'Sword' } };

/** A bare context whose hasItem throws: the AST item_check handler calls it. */
function bareCtx(extra = {}) {
  return { _isSnapshotInterface: true, hasItem: () => { throw new Error('hasItem exploded'); }, ...extra };
}

function errorLogs(spy) {
  return spy.mock.calls.filter(([msg]) => String(msg).includes('[evaluateRule] Error during evaluation'));
}

afterEach(() => vi.restoreAllMocks());

describe('evaluateRule catches a throwing node in either format and reports it', () => {
  for (const [name, rule, ctxField, expected] of [
    ['an AST throw', AST_THROW, 'ruleType', 'item_check'],
    ['a Rule Builder throw', RB_THROW, 'ruleName', 'List'],
  ]) {
    it(`${name} → undefined, one error log, one hook call naming the node`, () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const calls = [];
      const result = evaluateRule(rule, bareCtx({ onRuleError: (e) => calls.push(e) }));
      expect(result).toBeUndefined();
      expect(errorLogs(spy)).toHaveLength(1);
      expect(calls).toHaveLength(1);
      expect(calls[0].rule).toBe(rule);
      expect(calls[0][ctxField]).toBe(expected);
      expect(calls[0].depth).toBe(0);
      expect(calls[0].error).toBeInstanceOf(Error);
    });

    it(`${name} with NO hook → the same undefined, nothing escapes`, () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => evaluateRule(rule, bareCtx())).not.toThrow();
      expect(evaluateRule(rule, bareCtx())).toBeUndefined();
    });

    it(`${name} with a hook that THROWS → still undefined, nothing escapes, the hook's throw is logged`, () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const ctx = bareCtx({ onRuleError: () => { throw new Error('hook exploded'); } });
      let result;
      expect(() => { result = evaluateRule(rule, ctx); }).not.toThrow();
      expect(result).toBeUndefined();
      expect(spy.mock.calls.some(([msg]) => String(msg).includes('onRuleError hook threw'))).toBe(true);
    });
  }
});

describe('the hook reaches NESTED evaluations when passed as a context variable', () => {
  const regions = new Map([['Start', { exits: [{ name: 'Gate', access_rule: RB_THROW }] }]]);
  const locations = new Map([['Chest', { name: 'Chest', parent_region_name: 'Start', access_rule: RB_THROW }]]);
  const staticData = { game_name: 'Test Game', regions, locations, helpers: { 1: { broken: { body: RB_THROW } } } };
  const ctxWith = (onRuleError) => createSnapshotInterface(
    { inventory: {}, player: { id: 1 }, regionReachability: { Start: 'reachable' } }, staticData, { onRuleError });

  for (const [name, rule] of [
    ['Rule Builder → AST → Rule Builder (ASTRule wrapping an and)',
      { rule: 'ASTRule', args: { rule_data: { type: 'and', conditions: [RB_THROW] } } }],
    ['helper → rule (an exported helper body, evaluated on the interface)', { type: 'helper', name: 'broken', args: [] }],
    ['an entrance\'s access_rule (EntranceAccessRule)', { rule: 'EntranceAccessRule', args: { entrance_name: 'Gate' } }],
    ['a location SUB-CONTEXT (CanReachLocation → isLocationAccessible re-creates the interface from its context variables)',
      { rule: 'CanReachLocation', args: { location_name: 'Chest' } }],
  ]) {
    it(name, () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const calls = [];
      expect(evaluateRule(rule, ctxWith((e) => calls.push(e)))).toBeUndefined();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.every((c) => c.ruleName === 'List')).toBe(true);
    });
  }

  it('the nested node is reported at its own depth, not only at depth 0', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = [];
    evaluateRule({ type: 'and', conditions: [RB_THROW] }, ctxWith((e) => calls.push(e)));
    expect(calls.map((c) => c.depth)).toEqual([1]);
  });
});
