import test from "node:test";
import assert from "node:assert/strict";
import { BOARD, EVENTS } from "../shared/board.ts";
import { ITEMS, VEHICLES, BAG_LIMIT } from "../shared/catalog.ts";
import { applyAction, createGame, advanceTime, restoreGame, diceLimit, currentPlayer } from "../shared/engine.ts";
import type { Action, GameState } from "../shared/engine.ts";
const NOW = 1_000_000;
// Item costs and rewards are tested against a fixed balance.
const make = () => { const s = createGame("ABC23D", "human", "我", "solo", 1, NOW); for (const p of s.players) p.cash = 1000; return s; };
const act = (s: GameState, action: Action) => applyAction(s, "human", action, NOW, () => 0);
const enterShop = () => { const s = make(); s.players[0].position = 4; return act(s, { type: "roll" }); };

test("商店分布、十种道具和多种事件配置完整", () => {
  assert.equal(BOARD.filter(t => t.kind === "shop").length, 4);
  assert.equal(ITEMS.length, 10); assert.equal(new Set(ITEMS.map(i => i.id)).size, 10);
  assert.equal(EVENTS.length, 26); assert.ok(new Set(EVENTS.map(e => e.kind)).size >= 9);
});

test("进店购买、补差价升级、限购及离店后禁止购物", () => {
  let s = enterShop(); assert.equal(s.phase, "shop");
  s = act(s, { type: "buy-vehicle", vehicleId: "bicycle" });
  assert.equal(s.players[0].cash, 760); assert.equal(diceLimit(s.players[0]), 2);
  s = act(s, { type: "buy-vehicle", vehicleId: "scooter" });
  assert.equal(s.players[0].cash, 520); assert.equal(diceLimit(s.players[0]), 3);
  assert.throws(() => act(s, { type: "buy-item", itemId: "shield" }), /最多购买/);
  s = act(s, { type: "close-shop" }); assert.equal(s.phase, "manage");
  assert.throws(() => act(s, { type: "buy-item", itemId: "shield" }));
  assert.throws(() => act(make(), { type: "buy-vehicle", vehicleId: "car" }));
  let item = act(enterShop(), { type: "buy-item", itemId: "reverse" });
  assert.equal(item.players[0].cash, 920); assert.ok(item.players[0].items.includes("reverse"));
  assert.throws(() => act(item, { type: "use-item", itemId: "reverse", targetId: "bot-0" }), /掷骰前/);
});

test("购物拒绝现金不足、满背包、降级和伪造商品，失败不改变原状态", () => {
  const s = enterShop(); s.players[0].cash = 0;
  assert.throws(() => act(s, { type: "buy-item", itemId: "shield" }), /现金不足/);
  assert.equal(s.shopPurchases, 0);
  s.players[0].cash = 1000; s.players[0].items = Array(BAG_LIMIT).fill("shield");
  assert.throws(() => act(s, { type: "buy-item", itemId: "shield" }), /背包已满/);
  s.players[0].vehicle = "car";
  assert.throws(() => act(s, { type: "buy-vehicle", vehicleId: "bicycle" }), /更高级/);
  assert.throws(() => act(s, JSON.parse('{"type":"buy-item","itemId":"fake"}')), /无效道具/);
  assert.throws(() => act(s, JSON.parse('{"type":"buy-vehicle","vehicleId":"fake"}')), /无效交通工具/);
});

test("十种道具逐一产生真实效果，只消耗一次且不修改输入", () => {
  for (const item of ITEMS) {
    const s = make(); s.players[0].items = [item.id]; s.players[0].position = 8; s.players[1].position = 20;
    s.properties[1] = { owner: "bot-0", level: 2, mortgaged: false };
    const n = act(s, { type: "use-item", itemId: item.id, targetId: "bot-0" });
    const [p, q] = n.players;
    assert.equal(p.items.length, 0, item.id); assert.equal(n.itemUsed, true); assert.equal(s.players[0].items.length, 1);
    switch (item.id) {
      case "swap": assert.equal(p.position, 20); assert.equal(q.position, 8); assert.equal(p.cash, 1000); assert.equal(n.phase, "roll"); break;
      case "steal": assert.equal(p.cash, 1120); assert.equal(q.cash, 880); break;
      case "gift": assert.equal(p.cash, 1040); assert.equal(q.cash, 1100); break;
      case "slow": assert.equal(q.effects.slow, true); break;
      case "reverse": assert.equal(q.effects.reverse, true); break;
      case "meeting": assert.equal(q.skip, true); break;
      case "demolish": assert.equal(n.properties[1].level, 1); assert.equal(q.cash, 1000); break;
      case "shield": assert.equal(p.effects.shield, true); break;
      case "rent-pass": assert.equal(p.effects.rentPass, true); break;
      case "boost": assert.equal(diceLimit(p), 2); break;
    }
    assert.throws(() => act(n, { type: "use-item", itemId: item.id, targetId: "bot-0" }));
  }
});

test("防护罩抵挡所有负面道具，并在触发后消耗", () => {
  for (const item of ITEMS.filter(item => item.hostile)) {
    const s = make(); s.players[0].items = [item.id]; s.players[1].effects.shield = true;
    s.players[0].position = 5; s.players[1].position = 20;
    s.properties[1] = { owner: "bot-0", level: 2, mortgaged: false };
    const n = act(s, { type: "use-item", itemId: item.id, targetId: "bot-0" });
    assert.equal(n.players[1].effects.shield, false);
    assert.equal(n.players[1].cash, 1000); assert.equal(n.players[1].position, 20);
    assert.equal(n.players[1].skip, false); assert.equal(n.players[1].effects.slow, false); assert.equal(n.players[1].effects.reverse, false);
    assert.equal(n.properties[1].level, 2); assert.equal(n.players[0].items.length, 0);
  }
});

test("道具目标、时机、叠加和他人席位权限校验", () => {
  const s = make(); s.players[0].items = ["swap", "shield", "demolish"];
  for (const targetId of [undefined, "human", "fake"]) assert.throws(() => act(s, { type: "use-item", itemId: "swap", targetId }));
  s.players[1].bankrupt = true; assert.throws(() => act(s, { type: "use-item", itemId: "swap", targetId: "bot-0" })); s.players[1].bankrupt = false;
  assert.throws(() => act(s, { type: "use-item", itemId: "demolish", targetId: "bot-0" }));
  s.players[0].effects.shield = true; assert.throws(() => act(s, { type: "use-item", itemId: "shield" }));
  assert.throws(() => applyAction(s, "bot-0", { type: "use-item", itemId: "swap", targetId: "human" }, NOW, () => 0), /还没轮到/);
  assert.throws(() => act(act(s, { type: "roll" }), { type: "use-item", itemId: "swap", targetId: "bot-0" }), /掷骰前/);
  assert.deepEqual(s.players[0].items, ["swap", "shield", "demolish"]);
});

test("顺手牵羊只取现有现金，不会强制卖地或制造负余额", () => {
  const s = make(); s.players[0].items = ["steal"]; s.players[1].cash = 20; s.properties[1].owner = "bot-0";
  const n = act(s, { type: "use-item", itemId: "steal", targetId: "bot-0" });
  assert.equal(n.players[0].cash, 1020); assert.equal(n.players[1].cash, 0);
  assert.equal(n.players[1].bankrupt, false); assert.equal(n.properties[1].owner, "bot-0");
});

test("车辆决定多骰上限，允许选择更少骰子，每枚结果都由服务端决定", () => {
  for (const vehicle of VEHICLES) {
    const s = make(); s.players[0].vehicle = vehicle.id;
    const n = applyAction(s, "human", { type: "roll" }, NOW, () => 0);
    assert.deepEqual(n.diceValues, Array(vehicle.dice).fill(1)); assert.equal(n.dice, vehicle.dice);
    assert.equal(act(s, { type: "roll", diceCount: 1 }).diceValues.length, 1);
    assert.throws(() => act(s, { type: "roll", diceCount: vehicle.dice + 1 }));
  }
  for (const diceCount of [0, -1, 1.5, NaN, 6]) assert.throws(() => act(make(), { type: "roll", diceCount }));
});

test("加速上限五枚，减速优先，效果使用后消失", () => {
  const s = make(); s.players[0].vehicle = "car"; s.players[0].items = ["boost"];
  const boosted = act(s, { type: "use-item", itemId: "boost" }); assert.equal(diceLimit(boosted.players[0]), 5);
  const n = act(boosted, { type: "roll" }); assert.equal(n.diceValues.length, 5); assert.equal(n.players[0].effects.boost, false);
  boosted.players[0].effects.slow = true; const slowed = act(boosted, { type: "roll" });
  assert.equal(slowed.diceValues.length, 1); assert.equal(slowed.players[0].effects.slow, false); assert.equal(diceLimit(slowed.players[0]), 4);
});

test("倒退跨起点不领薪水，多骰向前跨起点只领一次", () => {
  const s = make(); s.players[0].effects.reverse = true;
  const backwards = act(s, { type: "roll" });
  assert.equal(backwards.players[0].position, 43); assert.equal(backwards.players[0].cash, 1000); assert.equal(backwards.players[0].effects.reverse, false);
  s.players[0].effects.reverse = false; s.players[0].position = 43; s.players[0].vehicle = "car";
  const n = applyAction(s, "human", { type: "roll" }, NOW, () => 1);
  assert.equal(n.dice, 8); assert.equal(n.players[0].position, 7); assert.equal(n.players[0].cash, 1150); // 薪水 +200，随后咖啡事件 -50
});

test("免租券仅抵消非零租金，抵押或自己的土地不会消耗", () => {
  const s = make(); s.players[0].effects.rentPass = true; s.properties[1] = { owner: "bot-0", level: 3, mortgaged: true };
  assert.equal(act(s, { type: "roll" }).players[0].effects.rentPass, true);
  s.properties[1].mortgaged = false; const n = act(s, { type: "roll" });
  assert.equal(n.players[0].cash, 1000); assert.equal(n.players[1].cash, 1000); assert.equal(n.players[0].effects.rentPass, false);
});

test("事件移动结算新落点，满包补偿、集体奖励和快闪商店生效", () => {
  const event = (index: number, initial = make()) => { initial.players[0].position = 2; return applyAction(initial, "human", { type: "roll" }, NOW, max => max === 6 ? 0 : index); };
  assert.equal(event(12).players[0].position, 6); assert.equal(event(12).phase, "buy");
  assert.equal(event(14).players[0].position, 1); assert.equal(event(14).phase, "buy");
  const full = make(); full.players[0].items = Array(BAG_LIMIT).fill("shield");
  const reward = event(16, full); assert.equal(reward.players[0].items.length, BAG_LIMIT); assert.equal(reward.players[0].cash, 1040);
  assert.equal(event(20).players[1].cash, 1040);
  assert.deepEqual(event(21).players.map(p => p.cash), [1030, 970]);
  assert.deepEqual(event(22).players.map(p => p.cash), [1060, 1060]);
  assert.equal(event(23).phase, "shop");
  assert.equal(event(24).players[0].skip, true);
  assert.equal(event(25).players[0].cash, 1080);
  const owned = make(); owned.properties[1].owner = "human"; assert.equal(event(25, owned).properties[1].level, 1);
});

test("电脑和超时托管会用道具、进店补给并离店", () => {
  const s = enterShop(); const n = advanceTime(s, s.deadline, () => 0);
  assert.equal(n.players[0].vehicle, "bicycle"); assert.ok(n.players[0].items.includes("steal"));
  assert.equal(currentPlayer(n).id, "bot-0"); assert.ok(n.players[0].cash >= 200);
  const next = advanceTime(n, n.botAt, () => 0); assert.equal(next.players[1].effects.shield, true);
  assert.equal(currentPlayer(next).id, "human"); assert.equal(next.itemUsed, false);
});

test("旧版存档迁移保留地产、坐标和购买选择，且只迁移一次", () => {
  const legacy = JSON.parse(JSON.stringify(make())); legacy.schema = 1;
  legacy.properties = { 1: { owner: "human", level: 3, mortgaged: false }, 5: { owner: "bot-0", level: 0, mortgaged: true }, 35: { owner: null, level: 0, mortgaged: false } };
  legacy.players[0].position = 35; legacy.players[1].position = 9; legacy.pending = 35; legacy.phase = "buy";
  delete legacy.diceValues; delete legacy.itemUsed; delete legacy.shopPurchases;
  for (const p of legacy.players) { delete p.items; delete p.vehicle; delete p.effects; }
  const n = restoreGame(legacy); assert.equal(n.schema, 3); assert.equal(n.players[0].position, 43); assert.equal(n.players[1].position, 11);
  assert.equal(n.pending, 43); assert.equal(n.properties[6].owner, "bot-0"); assert.equal(n.properties[6].mortgaged, true);
  assert.equal(n.properties[1].level, 3); assert.deepEqual(n.players[0].items, ["swap", "shield"]);
  assert.deepEqual(restoreGame(n), n); assert.equal(legacy.players[0].position, 35);
});
