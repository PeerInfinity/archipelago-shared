/**
 * ⚖ D3 (rule-node-registry, 2026-10-21): an evaluator answers UNDETERMINED (`undefined`) for a kind or
 * helper it cannot decide, never a silent true/false. And the Rule Builder names rule_builder really
 * serialises are handled by name instead of falling to the default branch's helper coercion.
 *
 * Evaluated through the real createSnapshotInterface.
 */

import { describe, it, expect } from 'vitest';
import { evaluateRule } from '../ruleEngine.js';
import { createSnapshotInterface } from '../snapshotInterface.js';

const gate = { rule: 'Has', args: { item_name: 'Key' } };

function ctx(inventory = {}, extraStatic = {}) {
  return createSnapshotInterface({ inventory, player: { id: 1 } }, { game_name: 'Test Game', ...extraStatic });
}

describe('EntranceAccessRuleCall (what rule_builder serialises) evaluates like EntranceAccessRule', () => {
  const regions = new Map([['Start', { exits: [{ name: 'Gate', access_rule: gate }] }]]);
  for (const name of ['EntranceAccessRuleCall', 'EntranceAccessRule']) {
    it(`${name} reads the named entrance's access_rule`, () => {
      const rule = { rule: name, args: { entrance_name: 'Gate' } };
      expect(evaluateRule(rule, ctx({}, { regions }))).toBe(false);
      expect(evaluateRule(rule, ctx({ Key: 1 }, { regions }))).toBe(true);
    });
  }
});

describe('ASTRule evaluates the AST rule it wraps', () => {
  const wrapped = {
    rule: 'ASTRule',
    args: { rule_data: { type: 'item_check', item: { type: 'constant', value: 'Key' } } },
  };
  it('follows the wrapped rule', () => {
    expect(evaluateRule(wrapped, ctx())).toBe(false);
    expect(evaluateRule(wrapped, ctx({ Key: 1 }))).toBe(true);
  });
  it('is undetermined with no rule_data', () => {
    expect(evaluateRule({ rule: 'ASTRule', args: {} }, ctx())).toBeUndefined();
  });
});

describe('bool (the converter\'s option.to_bool()) is Python bool()', () => {
  const bool = (value) => ({ rule: 'bool', _original_ast_type: 'helper', args: [{ rule: 'Constant', args: { value } }] });
  it('coerces its operand', () => {
    expect(evaluateRule(bool(1), ctx())).toBe(true);
    expect(evaluateRule(bool(0), ctx())).toBe(false);
  });
});

describe('abstract rule_builder bases are refused by name, not called as helpers', () => {
  for (const name of ['NestedRule', 'WrapperRule']) {
    it(`${name} is undetermined`, () => {
      const c = ctx();
      let called = false;
      c.executeHelper = () => { called = true; return true; };
      expect(evaluateRule({ rule: name, children: [gate] }, c)).toBeUndefined();
      expect(called).toBe(false);
    });
  }
});

describe('generic_helper with no way to run a helper is undetermined, not true', () => {
  it('a context without executeHelper', () => {
    const c = ctx();
    delete c.executeHelper;
    expect(evaluateRule({ type: 'generic_helper', name: 'can_fly', args: [] }, c)).toBeUndefined();
  });
});
