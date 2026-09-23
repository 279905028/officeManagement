import { BOARD, EVENTS } from "./board.ts";
import { BAG_LIMIT, SHOP_LIMIT, ITEMS, itemFor, vehicleFor, isItemId, isVehicleId } from "./catalog.ts";
import type { ItemId, VehicleId } from "./catalog.ts";

export const GAME_MS = 15 * 60_000, TURN_MS = 60_000, ROOM_TTL = 24 * 60 * 60_000, BOT_MS = 1000;
export const INITIAL_CASH = 2000;
export interface Effects { shield: boolean; rentPass: boolean; slow: boolean; reverse: boolean; boost: boolean }
export interface Player { id: string; name: string; seat: number; bot: boolean; auto: boolean; cash: number; position: number; skip: boolean; bankrupt: boolean; items: ItemId[]; vehicle: VehicleId; effects: Effects }
export interface Property { owner: string | null; level: number; mortgaged: boolean }
export interface GameLog { id: number; at: number; text: string }
export interface GameState {
  schema: 1 | 2 | 3; code: string; mode: "solo" | "online"; status: "lobby" | "playing" | "finished";
  version: number; hostId: string; players: Player[]; properties: Record<number, Property>;
  turnIndex: number; turn: number; phase: "roll" | "buy" | "shop" | "manage"; pending: number | null;
  dice: number; diceValues: number[]; itemUsed: boolean; shopPurchases: number;
  deadline: number; botAt: number; endsAt: number; updatedAt: number; expiresAt: number;
  logs: GameLog[]; logSeq: number; finishReason: string;
}
export type Action =
  | { type: "start" | "buy" | "skip-buy" | "close-shop" | "end-turn" | "takeover" | "autoplay" | "leave" }
  | { type: "roll"; diceCount?: number }
  | { type: "upgrade" | "sell-building" | "mortgage" | "redeem"; tileId: number }
  | { type: "buy-item"; itemId: ItemId }
  | { type: "use-item"; itemId: ItemId; targetId?: string }
  | { type: "buy-vehicle"; vehicleId: VehicleId };
export type RandomInt = (max: number) => number;
export class GameError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
function requireRule(ok: unknown, message: string, code = "INVALID_ACTION"): asserts ok { if (!ok) throw new GameError(code, message); }
export function normalizeName(raw: unknown): string {
  requireRule(typeof raw === "string", "请填写昵称");
  const name = raw.trim();
  requireRule(name.length > 0 && [...name].length <= 12 && !/[\u0000-\u001f\u007f]/.test(name), "昵称需为 1–12 个可见字符");
  return name;
}
function log(s: GameState, text: string, now: number) {
  s.logs.push({ id: ++s.logSeq, text, at: now }); s.logs = s.logs.slice(-70);
}
function touch(s: GameState, now: number) { s.version++; s.updatedAt = now; s.expiresAt = now + ROOM_TTL; }
export function currentPlayer(s: GameState) { return s.players[s.turnIndex]; }
const emptyEffects = (): Effects => ({ shield: false, rentPass: false, slow: false, reverse: false, boost: false });
export function diceLimit(p: Player) { return p.effects.slow ? 1 : Math.min(5, vehicleFor(p.vehicle).dice + Number(p.effects.boost)); }
// Preserve positions and remaining land; cash out retired properties at their net worth.
export function restoreGame(state: GameState): GameState {
  const s = structuredClone(state);
  if (s.schema === 1) {
    const oldToNew = (id: number) => Math.floor(id / 9) * 11 + [0,1,2,3,4,6,8,7,10][id % 9];
    s.properties = Object.fromEntries(Object.entries(s.properties).map(([id, property]) => [oldToNew(Number(id)), property]));
    for (const p of s.players) p.position = oldToNew(p.position);
    if (s.pending !== null) s.pending = oldToNew(s.pending);
    s.schema = 2;
  }
  if (s.schema === 2) {
    for (const [id, property] of Object.entries(s.properties)) {
      if (BOARD[Number(id)].kind === "property") continue;
      const owner = s.players.find(p => p.id === property.owner);
      if (owner && !owner.bankrupt) {
        const oldPrice = [120, 180, 240, 300][Math.floor(Number(id) / 11)];
        const refund = oldPrice * (property.mortgaged ? 0.5 : 1) + property.level * oldPrice / 2;
        owner.cash += refund;
        log(s, owner.name + "的地产改为事件格，按净值返还 ₥" + refund, s.updatedAt);
      }
    }
    s.properties = Object.fromEntries(BOARD.filter(t => t.kind === "property").map(t => [t.id, s.properties[t.id] ?? { owner: null, level: 0, mortgaged: false }]));
    if (s.pending !== null && BOARD[s.pending].kind !== "property") {
      s.pending = null;
      if (s.phase === "buy") s.phase = "manage";
    }
    if (s.status === "lobby") for (const p of s.players) p.cash = INITIAL_CASH;
    s.schema = 3;
  }
  s.diceValues ??= s.dice ? [s.dice] : [];
  s.itemUsed ??= false; s.shopPurchases ??= 0;
  for (const p of s.players) {
    p.items ??= ["swap", "shield"];
    p.vehicle ??= "walk"; p.effects = { ...emptyEffects(), ...p.effects };
  }
  return s;
}
export function upgradeCost(tileId: number) { return BOARD[tileId].price / 2; }
export function netWorth(s: GameState, p: Player): number {
  if (p.bankrupt) return 0;
  return p.cash + BOARD.reduce((sum, t) => {
    const a = s.properties[t.id];
    return sum + (a?.owner === p.id ? t.price * (a.mortgaged ? 0.5 : 1) + a.level * upgradeCost(t.id) : 0);
  }, 0);
}
export function rankings(s: GameState) {
  const sorted = s.players.map(p => ({ ...p, netWorth: netWorth(s, p) })).sort((a,b) => Number(a.bankrupt)-Number(b.bankrupt) || b.netWorth-a.netWorth || a.seat-b.seat);
  return sorted.map((p, i) => ({ ...p, rank: sorted.findIndex(q => q.netWorth === p.netWorth && q.bankrupt === p.bankrupt) + 1 }));
}
export function rentFor(s: GameState, tileId: number) {
  const t = BOARD[tileId], a = s.properties[tileId];
  if (!a?.owner || a.mortgaged) return 0;
  const allOwned = BOARD.filter(q => q.kind === "property" && q.group === t.group).every(q => s.properties[q.id].owner === a.owner);
  return t.price / 4 * (allOwned ? 2 : 1) * (a.level + 1);
}
function finish(s: GameState, reason: string, now: number) {
  s.status = "finished"; s.pending = null; s.botAt = 0; s.deadline = 0; s.finishReason = reason;
  log(s, reason + "，本局已结算", now);
}
function armTurn(s: GameState, now: number) {
  s.phase = "roll"; s.pending = null; s.dice = 0; s.diceValues = []; s.itemUsed = false; s.shopPurchases = 0;
  s.deadline = now + TURN_MS;
  const p = currentPlayer(s);
  s.botAt = p.bot || p.auto ? now + BOT_MS : 0;
}
function nextTurn(s: GameState, now: number) {
  if (s.players.filter(p => !p.bankrupt).length <= 1) return finish(s, "只剩一位玩家", now);
  if (now >= s.endsAt) return finish(s, "15 分钟到", now);
  for (let i = 0; i < s.players.length * 2; i++) {
    s.turnIndex = (s.turnIndex + 1) % s.players.length;
    const p = currentPlayer(s);
    if (p.bankrupt) continue;
    if (p.skip) { p.skip = false; log(s, p.name + "休息，跳过一回合", now); continue; }
    s.turn++; armTurn(s, now); return;
  }
  throw new Error("No available player");
}
export function createGame(code: string, id: string, name: string, mode: "solo" | "online", bots: number, now: number): GameState {
  const s: GameState = {
    schema: 3, code, mode, status: "lobby", version: 0, hostId: id, players: [], properties: {},
    turnIndex: 0, turn: 0, phase: "roll", pending: null, dice: 0, deadline: 0, botAt: 0, endsAt: 0,
    updatedAt: now, expiresAt: now + ROOM_TTL, logs: [], logSeq: 0, finishReason: "",
    diceValues: [], itemUsed: false, shopPurchases: 0,
  };
  for (const tile of BOARD) if (tile.kind === "property") s.properties[tile.id] = { owner: null, level: 0, mortgaged: false };
  addPlayer(s, id, name, false, now);
  if (mode === "solo") {
    requireRule(Number.isInteger(bots) && bots >= 1 && bots <= 3, "请选择 1–3 个电脑对手");
    for (let i = 0; i < bots; i++) addPlayer(s, "bot-" + i, ["小周", "阿乔", "林老板"][i], true, now);
    startGame(s, now);
  }
  return s;
}
export function addPlayer(s: GameState, id: string, name: string, bot: boolean, now: number) {
  requireRule(s.status === "lobby", "对局已开始，不能加入新玩家", "ALREADY_STARTED");
  requireRule(s.players.length < 4, "房间已满，最多 4 人", "ROOM_FULL");
  requireRule(!s.players.some(p => p.id === id), "你已在房间中");
  name = normalizeName(name);
  if (s.players.some(p => p.name === name)) name = name.slice(0, 10) + "·" + (s.players.length + 1);
  const seats = new Set(s.players.map(p => p.seat));
  s.players.push({ id, name, seat: [0,1,2,3].find(n => !seats.has(n))!, bot, auto: bot, cash: INITIAL_CASH, position: 0, skip: false, bankrupt: false, items: ["swap", "shield"], vehicle: "walk", effects: emptyEffects() });
  log(s, name + "加入房间", now); touch(s, now);
}
function startGame(s: GameState, now: number) {
  requireRule(s.status === "lobby" && s.players.length >= 2, "至少需要两位玩家");
  s.status = "playing"; s.turn = 1; s.endsAt = now + GAME_MS; armTurn(s, now);
  log(s, "开局！每人 ₥" + INITIAL_CASH.toLocaleString("zh-CN") + "，15 分钟后按净资产排名", now);
}
// Forced debt resolution sells buildings first, then the cheapest unmortgaged land.
// Mortgaged land has already paid out its liquidation value and cannot pay out again.
export function charge(s: GameState, payer: Player, amount: number, creditorId: string | null, now: number) {
  let owned = BOARD.filter(t => s.properties[t.id]?.owner === payer.id).sort((a,b) => a.price-b.price || a.id-b.id);
  for (const t of owned) {
    const a = s.properties[t.id];
    while (payer.cash < amount && a.level > 0) { a.level--; payer.cash += upgradeCost(t.id) / 2; log(s, payer.name + "自动半价卖出「" + t.name + "」一层建筑偿债", now); }
  }
  for (const t of owned) {
    const a = s.properties[t.id];
    if (payer.cash >= amount) break;
    if (a.mortgaged) continue;
    // No buildings remain when funds are still insufficient.
    payer.cash += t.price / 2; a.owner = null; a.level = 0; a.mortgaged = false;
    log(s, payer.name + "自动半价变卖「" + t.name + "」偿债", now);
  }
  const paid = Math.min(payer.cash, amount); payer.cash -= paid;
  if (creditorId) s.players.find(p => p.id === creditorId)!.cash += paid;
  if (paid < amount) {
    payer.bankrupt = true; payer.cash = 0;
    for (const a of Object.values(s.properties)) if (a.owner === payer.id) { a.owner = null; a.level = 0; a.mortgaged = false; }
    log(s, payer.name + "资金不足，破产离场", now);
  }
}
function move(s: GameState, p: Player, steps: number, now: number) {
  const laps = steps > 0 ? Math.floor((p.position + steps) / BOARD.length) : 0;
  if (laps) { p.cash += 200 * laps; log(s, p.name + "经过发薪日，领取 ₥" + 200 * laps, now); }
  p.position = ((p.position + steps) % BOARD.length + BOARD.length) % BOARD.length;
}
function grantItem(s: GameState, p: Player, itemId: ItemId, now: number) {
  if (p.items.length < BAG_LIMIT) { p.items.push(itemId); log(s, p.name + "获得「" + itemFor(itemId)!.name + "」", now); }
  else { p.cash += 40; log(s, p.name + "背包已满，道具折为 ₥40", now); }
}
function land(s: GameState, p: Player, now: number, random: RandomInt, depth = 0) {
  const t = BOARD[p.position]; s.phase = "manage"; s.pending = null;
  if (t.kind === "property") {
    const a = s.properties[t.id];
    if (!a.owner) { s.pending = t.id; s.phase = "buy"; }
    else if (a.owner !== p.id) {
      const rent = rentFor(s, t.id);
      if (rent && p.effects.rentPass) { p.effects.rentPass = false; log(s, p.name + "的免租券生效，免付租金 ₥" + rent, now); }
      else if (rent) { log(s, p.name + "向" + s.players.find(q => q.id === a.owner)!.name + "支付租金 ₥" + rent, now); charge(s, p, rent, a.owner, now); }
      else log(s, "这块地产已抵押，免收租金", now);
    }
  } else if (t.kind === "tax") { charge(s, p, 100, null, now); log(s, p.name + "缴税 ₥100", now); }
  else if (t.kind === "meeting") { p.skip = true; log(s, p.name + "收到会议邀请，下个回合休息", now); }
  else if (t.kind === "shop") { s.phase = "shop"; s.shopPurchases = 0; log(s, p.name + "进入道具商店，可购买道具或升级交通工具", now); }
  else if (t.kind === "event" && depth < 4) {
    const event = EVENTS[random(EVENTS.length)];
    requireRule(event, "事件结果异常");
    log(s, p.name + " · " + event.text, now);
    switch (event.kind) {
      case "cash":
        if (event.amount >= 0) p.cash += event.amount; else charge(s, p, -event.amount, null, now);
        log(s, p.name + (event.amount >= 0 ? " +₥" : " −₥") + Math.abs(event.amount), now); break;
      case "move":
        move(s, p, event.steps, now); log(s, p.name + "来到「" + BOARD[p.position].name + "」", now);
        land(s, p, now, random, depth + 1); break;
      case "item": grantItem(s, p, event.itemId, now); break;
      case "gift": for (const q of s.players) if (q.id !== p.id && !q.bankrupt) q.cash += 40; break;
      case "collect": for (const q of s.players) if (q.id !== p.id && !q.bankrupt) { const amount = Math.min(30, q.cash); q.cash -= amount; p.cash += amount; } break;
      case "bonus": for (const q of s.players) if (!q.bankrupt) q.cash += 60; break;
      case "shop": s.phase = "shop"; s.shopPurchases = 0; break;
      case "holiday": p.skip = true; p.cash += 120; break;
      case "repair": {
        const tile = BOARD.find(t => s.properties[t.id]?.owner === p.id && !s.properties[t.id].mortgaged && s.properties[t.id].level < 3);
        if (tile) { s.properties[tile.id].level++; log(s, "「" + tile.name + "」免费增加一层建筑", now); } else p.cash += 80;
        break;
      }
    }
  } else if (t.kind === "event") {
    log(s, "连续事件已结束，在这里稍作停留", now);
  }
}
function roll(s: GameState, p: Player, now: number, random: RandomInt, diceCount = diceLimit(p)) {
  requireRule(s.phase === "roll", "本回合已经掷过骰子");
  requireRule(Number.isInteger(diceCount) && diceCount >= 1 && diceCount <= diceLimit(p), "骰子数量超出当前可用范围");
  s.diceValues = Array.from({ length: diceCount }, () => random(6) + 1);
  requireRule(s.diceValues.every(n => Number.isInteger(n) && n >= 1 && n <= 6), "骰子结果异常");
  s.dice = s.diceValues.reduce((sum, n) => sum + n, 0);
  const backwards = p.effects.reverse;
  p.effects.slow = false; p.effects.reverse = false; p.effects.boost = false;
  move(s, p, backwards ? -s.dice : s.dice, now);
  log(s, p.name + "掷出 " + s.diceValues.join("＋") + "，" + (backwards ? "后退" : "前进") + s.dice + " 格，来到「" + BOARD[p.position].name + "」", now);
  land(s, p, now, random);
  if (p.bankrupt) nextTurn(s, now);
}
function purchase(s: GameState, p: Player, action: Extract<Action, { type: "buy-item" | "buy-vehicle" }>, now: number) {
  requireRule(s.phase === "shop", "只有落在商店或遇到快闪商店时才能购物");
  requireRule(s.shopPurchases < SHOP_LIMIT, "每次进店最多购买两件商品");
  if (action.type === "buy-item") {
    requireRule(isItemId(action.itemId), "无效道具");
    const item = itemFor(action.itemId)!;
    requireRule(p.items.length < BAG_LIMIT, "背包已满，最多放 6 件道具");
    requireRule(p.cash >= item.price, "现金不足，无法购买道具");
    p.cash -= item.price; p.items.push(item.id); log(s, p.name + "购买「" + item.name + "」 −₥" + item.price, now);
  } else {
    requireRule(isVehicleId(action.vehicleId), "无效交通工具");
    const vehicle = vehicleFor(action.vehicleId), current = vehicleFor(p.vehicle), cost = vehicle.price - current.price;
    requireRule(vehicle.dice > current.dice, "只能升级到更高级的交通工具");
    requireRule(p.cash >= cost, "现金不足，无法升级交通工具");
    p.cash -= cost; p.vehicle = vehicle.id;
    log(s, p.name + "换乘「" + vehicle.name + "」，每次最多 " + vehicle.dice + " 枚骰子 −₥" + cost, now);
  }
  s.shopPurchases++;
}
function useItem(s: GameState, p: Player, action: Extract<Action, { type: "use-item" }>, now: number) {
  requireRule(s.phase === "roll" && !s.itemUsed, "每回合掷骰前最多使用一件道具");
  requireRule(isItemId(action.itemId) && p.items.includes(action.itemId), "背包里没有这件道具");
  const item = itemFor(action.itemId)!;
  const target = item.target === "self" ? p : s.players.find(q => q.id === action.targetId && q.id !== p.id && !q.bankrupt);
  requireRule(target, "请选择一位仍在对局中的其他玩家");
  const building = BOARD.filter(t => s.properties[t.id]?.owner === target.id && s.properties[t.id].level > 0)
    .sort((a, b) => s.properties[b.id].level - s.properties[a.id].level || a.id - b.id)[0];
  if (item.id === "demolish") requireRule(building, "这位玩家没有可拆除的建筑");
  if (item.id === "meeting") requireRule(!target.skip, "这位玩家已要跳过下一回合");
  if (item.id === "slow" || item.id === "reverse" || item.id === "shield" || item.id === "boost") requireRule(!target.effects[item.id], "相同效果已生效，不能叠加");
  if (item.id === "rent-pass") requireRule(!target.effects.rentPass, "免租效果已生效，不能叠加");
  if (item.id === "steal") requireRule(target.cash > 0, "这位玩家没有可拿走的现金");
  p.items.splice(p.items.indexOf(item.id), 1); s.itemUsed = true;
  log(s, p.name + "对" + (target.id === p.id ? "自己" : target.name) + "使用「" + item.name + "」", now);
  if (item.hostile && target.effects.shield) { target.effects.shield = false; log(s, target.name + "的防护罩抵挡了这次道具", now); return; }
  switch (item.id) {
    case "swap": [p.position, target.position] = [target.position, p.position]; break;
    case "steal": { const amount = Math.min(120, target.cash); target.cash -= amount; p.cash += amount; log(s, p.name + "从" + target.name + "获得 ₥" + amount, now); break; }
    case "gift": target.cash += 100; p.cash += 40; break;
    case "meeting": target.skip = true; break;
    case "demolish": s.properties[building!.id].level--; log(s, "「" + building!.name + "」减少一层建筑", now); break;
    case "rent-pass": p.effects.rentPass = true; break;
    case "shield": case "boost": case "slow": case "reverse": target.effects[item.id] = true; break;
  }
}
function buy(s: GameState, p: Player, now: number) {
  requireRule(s.phase === "buy" && s.pending !== null, "目前没有待购买地产");
  const t = BOARD[s.pending], a = s.properties[t.id];
  requireRule(!a.owner && p.cash >= t.price, "现金不足，无法购买");
  p.cash -= t.price; a.owner = p.id; s.pending = null; s.phase = "manage";
  log(s, p.name + "购入「" + t.name + "」 −₥" + t.price, now);
}
function propertyAction(s: GameState, p: Player, a: Extract<Action, { tileId: number }>, now: number) {
  requireRule(s.phase === "manage", "请先掷骰并完成落地操作");
  requireRule(Number.isInteger(a.tileId) && BOARD[a.tileId]?.kind === "property", "无效地产");
  const t = BOARD[a.tileId], property = s.properties[a.tileId];
  requireRule(property.owner === p.id, "只能经营自己的地产");
  if (a.type === "upgrade") {
    const cost = upgradeCost(t.id);
    requireRule(!property.mortgaged && property.level < 3 && p.cash >= cost, "升级需要未抵押地产、足够现金，且最多 3 级");
    p.cash -= cost; property.level++; log(s, p.name + "升级「" + t.name + "」至 " + property.level + " 级 −₥" + cost, now);
  } else if (a.type === "sell-building") {
    requireRule(property.level > 0, "这里还没有建筑");
    property.level--; p.cash += upgradeCost(t.id) / 2; log(s, p.name + "半价卖出「" + t.name + "」一层建筑", now);
  } else if (a.type === "mortgage") {
    requireRule(!property.mortgaged && property.level === 0, "请先卖完建筑，已抵押地产不能再次抵押");
    property.mortgaged = true; p.cash += t.price / 2; log(s, p.name + "抵押「" + t.name + "」 +₥" + t.price / 2, now);
  } else {
    const cost = Math.round(t.price * .55);
    requireRule(property.mortgaged && p.cash >= cost, "解押需要足够现金和已抵押地产");
    property.mortgaged = false; p.cash -= cost; log(s, p.name + "赎回「" + t.name + "」 −₥" + cost, now);
  }
}
export function applyAction(state: GameState, playerId: string, action: Action, now: number, random: RandomInt): GameState {
  const s = restoreGame(state), p = s.players.find(p => p.id === playerId);
  requireRule(p, "席位无效，请重新加入", "INVALID_SEAT");
  requireRule(s.status !== "finished", "这局已经结束", "FINISHED");
  if (action.type === "leave" && s.status === "lobby") {
    s.players = s.players.filter(p => p.id !== playerId);
    if (s.hostId === playerId) s.hostId = s.players[0]?.id ?? "";
    log(s, p.name + "离开房间", now);
  } else if (action.type === "start") {
    requireRule(s.hostId === playerId, "只有房主可以开始");
    startGame(s, now);
  } else if (action.type === "takeover" || action.type === "autoplay" || action.type === "leave") {
    requireRule(s.status === "playing" && !p.bot && !p.bankrupt, "当前不能切换托管");
    p.auto = action.type !== "takeover";
    if (currentPlayer(s).id === p.id) { s.botAt = p.auto ? now + BOT_MS : 0; /* Taking over does not reset the deadline. */ }
    log(s, p.name + (p.auto ? "开启自动托管" : "接回操作"), now);
  } else {
    requireRule(s.status === "playing" && !p.bankrupt, "还不能进行这个操作");
    requireRule(currentPlayer(s).id === p.id, "还没轮到你", "NOT_YOUR_TURN");
    requireRule(!p.auto, "请先接管，再操作");
    requireRule(now < s.deadline && now < s.endsAt, "本回合已超时，请同步最新状态", "EXPIRED");
    switch (action.type) {
      case "roll": roll(s, p, now, random, action.diceCount); break;
      case "use-item": useItem(s, p, action, now); break;
      case "buy-item": case "buy-vehicle": purchase(s, p, action, now); break;
      case "close-shop": requireRule(s.phase === "shop", "当前不在商店"); s.phase = "manage"; break;
      case "buy": buy(s, p, now); break;
      case "skip-buy": requireRule(s.phase === "buy", "没有待购买地产"); s.pending = null; s.phase = "manage"; break;
      case "end-turn": requireRule(s.phase === "manage", "请先完成掷骰和购买选择"); nextTurn(s, now); break;
      case "upgrade": case "sell-building": case "mortgage": case "redeem": propertyAction(s, p, action, now); break;
      default: throw new GameError("INVALID_ACTION", "不支持的操作");
    }
  }
  touch(s, now); return s;
}
function playBot(s: GameState, now: number, random: RandomInt) {
  const p = currentPlayer(s);
  if (s.phase === "roll" && !s.itemUsed) {
    const opponent = s.players.filter(q => q.id !== p.id && !q.bankrupt).sort((a,b) => netWorth(s,b) - netWorth(s,a))[0];
    const preferred = ["shield", "rent-pass", "boost", "steal", "slow", "reverse", "meeting", "demolish", "swap", "gift"] as const;
    for (const itemId of preferred) if (p.items.includes(itemId)) {
      try { useItem(s, p, { type: "use-item", itemId, targetId: opponent?.id }, now); break; }
      catch (e) { if (!(e instanceof GameError)) throw e; }
    }
  }
  if (s.phase === "roll") roll(s, p, now, random);
  if (s.status !== "playing" || currentPlayer(s).id !== p.id) return;
  if (s.phase === "buy") {
    if (p.cash - BOARD[s.pending!].price >= 200) buy(s, p, now);
    else { s.pending = null; s.phase = "manage"; }
  }
  if (s.phase === "shop") {
    const upgradeId = p.vehicle === "walk" ? "bicycle" : p.vehicle === "bicycle" ? "scooter" : p.vehicle === "scooter" ? "car" : null;
    if (upgradeId && s.shopPurchases < SHOP_LIMIT && p.cash - (vehicleFor(upgradeId).price - vehicleFor(p.vehicle).price) >= 200)
      purchase(s, p, { type: "buy-vehicle", vehicleId: upgradeId }, now);
    const item = ITEMS.find(item => item.id === "steal");
    if (item && s.shopPurchases < SHOP_LIMIT && p.items.length < BAG_LIMIT && p.cash - item.price >= 200)
      purchase(s, p, { type: "buy-item", itemId: item.id }, now);
    s.phase = "manage";
  }
  const owned = BOARD.filter(t => s.properties[t.id]?.owner === p.id);
  const redeem = owned.find(t => s.properties[t.id].mortgaged && p.cash - Math.round(t.price * .55) >= 200);
  const upgrade = owned.find(t => !s.properties[t.id].mortgaged && s.properties[t.id].level < 3 && p.cash - upgradeCost(t.id) >= 200);
  if (redeem) propertyAction(s,p,{type:"redeem",tileId:redeem.id},now);
  else if (upgrade) propertyAction(s,p,{type:"upgrade",tileId:upgrade.id},now);
  nextTurn(s, now);
}
export function advanceTime(state: GameState, now: number, random: RandomInt): GameState {
  if (state.status !== "playing") return state;
  const s = restoreGame(state);
  if (now >= s.endsAt) finish(s, "15 分钟到", now);
  else if (now >= s.deadline || (s.botAt > 0 && now >= s.botAt)) {
    const p = currentPlayer(s);
    if (!p.auto) { p.auto = true; log(s, p.name + "超过 60 秒未完成回合，自动托管", now); }
    playBot(s, now, random);
  } else return state;
  touch(s,now); return s;
}
export function nextWake(s: GameState) {
  return s.status === "playing" ? Math.min(s.endsAt, s.deadline, s.botAt || Infinity, s.expiresAt) : s.expiresAt;
}
