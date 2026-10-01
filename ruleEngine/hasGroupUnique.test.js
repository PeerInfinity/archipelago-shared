/**
 * HasGroupUnique counts DISTINCT group members held; HasGroup sums member counts.
 * Python truth: rule_builder/rules.py HasGroup / HasGroupUnique (a group smaller
 * than `count` resolves to False_, count <= 0 to True_).
 *
 * Evaluated through the real createSnapshotInterface, in each group-membership
 * form it reads (item_groups as group names + items' `groups`, and object form).
 */

import { describe, it, expect } from 'vitest';
import { evaluateRule } from '../ruleEngine.js';
import { createSnapshotInterface } from '../snapshotInterface.js';

const MEMBERS = ['Relic A', 'Relic B', 'Relic C'];

const STATIC_FORMS = {
  'item_groups as names + items.groups': {
    game_name: 'Test Game',
    item_groups: { 1: ['Relics', 'Other'] },
    items: {
      1: {
        'Relic A': { groups: ['Relics'] },
        'Relic B': { groups: ['Relics'] },
        'Relic C': { groups: ['Relics'] },
        Sword: { groups: ['Other'] },
      },
    },
  },
  'item_groups object form': {
    game_name: 'Test Game',
    item_groups: { 1: { Relics: MEMBERS, Other: ['Sword'] } },
  },
};

function ctx(staticData, inventory) {
  return createSnapshotInterface({ inventory, player: { id: 1 } }, staticData);
}

const rule = (name, count) => ({ rule: name, args: { item_name_group: 'Relics', count } });

describe.each(Object.entries(STATIC_FORMS))('HasGroupUnique vs HasGroup (%s)', (_form, staticData) => {
  it('one member held twice: HasGroup(2) passes, HasGroupUnique(2) does not', () => {
    const c = ctx(staticData, { 'Relic A': 2 });
    expect(evaluateRule(rule('HasGroup', 2), c)).toBe(true);
    expect(evaluateRule(rule('HasGroupUnique', 2), c)).toBe(false);
  });

  it('two members held once each: both pass at 2', () => {
    const c = ctx(staticData, { 'Relic A': 1, 'Relic B': 1 });
    expect(evaluateRule(rule('HasGroup', 2), c)).toBe(true);
    expect(evaluateRule(rule('HasGroupUnique', 2), c)).toBe(true);
  });

  it('count larger than the group can never pass HasGroupUnique, however many copies', () => {
    const c = ctx(staticData, { 'Relic A': 5, 'Relic B': 5, 'Relic C': 5 });
    expect(evaluateRule(rule('HasGroup', 4), c)).toBe(true);
    expect(evaluateRule(rule('HasGroupUnique', 3), c)).toBe(true);
    expect(evaluateRule(rule('HasGroupUnique', 4), c)).toBe(false);
  });

  it('count <= 0 is True_, as in Python', () => {
    const c = ctx(staticData, {});
    expect(evaluateRule(rule('HasGroupUnique', 0), c)).toBe(true);
  });

  it('a non-member held does not count toward the group', () => {
    const c = ctx(staticData, { Sword: 3, 'Relic A': 1 });
    expect(evaluateRule(rule('HasGroupUnique', 2), c)).toBe(false);
    expect(evaluateRule({ rule: 'CountGroupUnique', args: { group: 'Relics' } }, c)).toBe(1);
  });
});
