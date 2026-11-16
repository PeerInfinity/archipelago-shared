/**
 * The snapshot's `world.item_name_groups` has Python's shape, `{group: [items]}`
 * (sdc-player1-tidy-3).
 *
 * The defect: the `world` name spread `item_groups[p]` — a LIST of group names in
 * every preset — into an object, giving `{0: 'Bottles', 1: …}`. Membership lives on
 * each item's `groups`. AHIT's `relic_groups` still merge on top.
 *
 * Mutant: put `...(staticData?.item_groups?.[playerId] || …)` back and the world row
 * sees '0' keys.
 */
import { describe, it, expect } from 'vitest';
import { createSnapshotInterface, itemNameGroupsFromStaticData } from './snapshotInterface.js';

function slot2StaticData() {
  const p2Items = {
    'Bottle': { name: 'Bottle', groups: ['Bottles'] },
    'Bottle (Red Potion)': { name: 'Bottle (Red Potion)', groups: ['Bottles'] },
    'Fighter Sword': { name: 'Fighter Sword', groups: ['Swords'] },
    'Arrow': { name: 'Arrow' },
  };
  return {
    game_name: 'A Link to the Past',
    playerId: '2',
    items: p2Items,
    itemsByPlayer: { 2: p2Items },
    item_groups: { 2: ['Bottles', 'Swords'] },
    game_info: { 2: { relic_groups: { Burger: ['Burger Patty', 'Burger Cushion'] } } },
    world: { 1: { game: 'A Link to the Past', options: {} }, 2: { game: 'A Link to the Past', options: {} } },
    regions: new Map(),
    locations: new Map(),
  };
}

const snapshot = { player: { id: '2', slot: '2' }, inventory: {}, game: 'A Link to the Past' };

describe('world.item_name_groups', () => {
  it('itemNameGroupsFromStaticData builds {group: [items]} from item groups', () => {
    expect(itemNameGroupsFromStaticData(slot2StaticData(), '2')).toEqual({
      Bottles: ['Bottle', 'Bottle (Red Potion)'],
      Swords: ['Fighter Sword'],
    });
  });

  it('an object-shaped item_groups[p] is taken as written', () => {
    const sd = slot2StaticData();
    sd.item_groups = { 2: { Bows: ['Bow', 'Silver Bow'] } };
    expect(itemNameGroupsFromStaticData(sd, '2')).toEqual({ Bows: ['Bow', 'Silver Bow'] });
  });

  it("resolveName('world').item_name_groups has group keys plus relic_groups", () => {
    const iface = createSnapshotInterface(snapshot, slot2StaticData());
    const groups = iface.resolveName('world').item_name_groups;
    expect(groups).not.toHaveProperty('0');
    expect(groups).toEqual({
      Bottles: ['Bottle', 'Bottle (Red Potion)'],
      Swords: ['Fighter Sword'],
      Burger: ['Burger Patty', 'Burger Cushion'],
    });
  });
});
