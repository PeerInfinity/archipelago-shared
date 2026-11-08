/**
 * An inventory-only context (`procgen/library.js` `inventoryRuleContext`) cannot
 * answer a game helper, a region question and so on: by design those evaluate to
 * `undefined`, which `evaluateRuleAgainstInventory` reads as closed. A caller
 * asking that thousands of times is not a problem worth a warning each, so the
 * sites it reaches log at debug. Only the level differs: the answer is the same
 * as for a context without the flag, and that one still warns.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluateRule } from '../ruleEngine.js';
import { inventoryRuleContext, evaluateRuleAgainstInventory } from '../procgen/library.js';

const constant = (value) => ({ type: 'constant', value });

const UNANSWERABLE = [
  ['executeHelper', { type: 'helper', name: 'some_helper', args: [] }],
  ['isRegionAccessible', { type: 'region_check', region: constant('A Region') }],
  ['isRegionReachable', { type: 'can_reach', region: constant('A Region') }],
  ['countGroup', { type: 'group_check', group: constant('A Group') }],
  ['isLocationAccessible', { type: 'location_check', location: constant('A Location') }],
  ['executeStateManagerMethod', { type: 'state_method', method: 'some_method', args: [] }],
];

function stubLogger() {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  vi.stubGlobal('window', { logger });
  return logger;
}

const inventoryContext = () => inventoryRuleContext(new Set(), '1');

function withoutTheFlag() {
  const { _inventoryOnly, ...rest } = inventoryContext();
  return rest;
}

const messages = (spy) => spy.mock.calls.map(([, message]) => message);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(UNANSWERABLE)('a rule needing context.%s', (method, rule) => {
  it('an inventory-only context answers undefined, which the inventory gate reads as closed', () => {
    stubLogger();
    expect(evaluateRule(rule, inventoryContext())).toBeUndefined();
    expect(evaluateRuleAgainstInventory(rule, new Set())).toBe(false);
  });

  it('an inventory-only context logs at debug, not warn', () => {
    const logger = stubLogger();
    evaluateRule(rule, inventoryContext());
    expect(messages(logger.debug).filter((m) => m.includes(method))).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('outside the app logger, an inventory-only context prints nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    evaluateRule(rule, inventoryContext());
    expect(warn).not.toHaveBeenCalled();
  });

  it('the same context without the flag gives the same answer and still warns', () => {
    const logger = stubLogger();
    expect(evaluateRule(rule, withoutTheFlag())).toBeUndefined();
    expect(messages(logger.warn).filter((m) => m.includes(method))).toHaveLength(1);
    expect(messages(logger.debug).filter((m) => m.includes(method))).toHaveLength(0);
  });
});
