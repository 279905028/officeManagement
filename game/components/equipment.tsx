"use client";
import { ArrowLeftRight, Backpack, Bike, BriefcaseBusiness, Car, Construction, Footprints, Gift, Hammer, Hand, Shield, ShoppingBag, Ticket, Undo2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BAG_LIMIT, ITEMS, SHOP_LIMIT, VEHICLES, itemFor, vehicleFor } from "@/shared/catalog";
import type { ItemId } from "@/shared/catalog";
import { currentPlayer } from "@/shared/engine";
import type { Action, GameState, Player } from "@/shared/engine";

const money = (n: number) => "₥ " + n.toLocaleString("zh-CN");
const itemIcons = { swap: ArrowLeftRight, steal: Hand, gift: Gift, slow: Construction, reverse: Undo2, meeting: BriefcaseBusiness, demolish: Hammer, shield: Shield, "rent-pass": Ticket, boost: Zap };
const vehicleIcons = { walk: Footprints, bicycle: Bike, scooter: Zap, car: Car };

export function EffectLabels({ player }: { player: Player }) {
  const labels = [player.effects.shield && "防护罩", player.effects.rentPass && "免租", player.effects.slow && "下次 1 枚骰子", player.effects.reverse && "下次倒退", player.effects.boost && "骰子 +1", player.skip && "下回合休息"].filter(Boolean);
  return labels.length ? <div className="effect-labels">{labels.map(label => <span key={String(label)}>{label}</span>)}</div> : null;
}

export function Inventory({ state, player, onUse }: { state: GameState; player: Player; onUse: (itemId: ItemId) => void }) {
  const vehicle = vehicleFor(player.vehicle), Icon = vehicleIcons[vehicle.id];
  return <div className="inventory">
    <div className="vehicle-summary"><Icon size={22}/><div><strong>{vehicle.name}</strong><span>每次可选 1–{vehicle.dice} 枚骰子</span></div><small>{player.items.length} / {BAG_LIMIT} 件</small></div>
    <EffectLabels player={player}/>
    <p className="inventory-hint">{state.itemUsed && currentPlayer(state).id === player.id ? "本回合已使用道具，下回合再用。" : "自己的回合掷骰前，可用一件道具。"}</p>
    <div className="inventory-list">{ITEMS.filter(item => player.items.includes(item.id)).map(item => {
      const ItemIcon = itemIcons[item.id];
      return <button key={item.id} className="inventory-row" onClick={() => onUse(item.id)} aria-label={"查看并使用" + item.name}>
        <ItemIcon size={18}/><div><strong>{item.name}</strong><span>{item.target === "self" ? "对自己使用" : "选择一位玩家"}</span></div><small>×{player.items.filter(id => id === item.id).length}</small>
      </button>;
    })}</div>
    {!player.items.length && <div className="empty-assets"><Backpack/><strong>背包暂时是空的</strong><span>在商店补充，或在「？」格获得。</span></div>}
  </div>;
}

export function ShopDialog({ state, player, ready, open, onOpenChange, onAction, error }: { state: GameState; player: Player; ready: boolean; open: boolean; onOpenChange: (open: boolean) => void; onAction: (action: Action) => Promise<void>; error: string }) {
  const shopping = state.status === "playing" && currentPlayer(state).id === player.id && state.phase === "shop" && !player.auto && !player.bankrupt;
  const available = shopping && ready && state.shopPurchases < SHOP_LIMIT;
  const currentVehicle = vehicleFor(player.vehicle);
  const buy = (action: Action) => { void onAction(action).catch(() => {}); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="shop-dialog"><DialogTitle>街区商店</DialogTitle><DialogDescription>{shopping ? `本次已购 ${state.shopPurchases} / ${SHOP_LIMIT} 件 · 可用现金 ${money(player.cash)}` : "商品目录 · 停在商店格，或遇到快闪商店后可购买。"}</DialogDescription>
    <Tabs defaultValue="items"><TabsList className="shop-tabs"><TabsTrigger value="items"><ShoppingBag/>道具 · 10 项</TabsTrigger><TabsTrigger value="vehicles"><Bike/>交通工具</TabsTrigger></TabsList>
      <TabsContent value="items"><div className="shop-grid">{ITEMS.map(item => {
        const Icon = itemIcons[item.id], full = player.items.length >= BAG_LIMIT;
        return <article className="shop-item" key={item.id}><div className="shop-item-heading"><Icon size={19}/><strong>{item.name}</strong><span>{money(item.price)}</span></div><p>{item.description}</p><Button variant="outline" size="sm" disabled={!available || full || player.cash < item.price} onClick={() => buy({ type: "buy-item", itemId: item.id })}>{full ? "背包已满" : player.cash < item.price ? "现金不足" : "购买"}</Button></article>;
      })}</div><p className="inventory-hint">背包 {player.items.length} / {BAG_LIMIT} 件 · 新购道具从下个回合开始使用。</p></TabsContent>
      <TabsContent value="vehicles"><div className="vehicle-shop">{VEHICLES.filter(vehicle => vehicle.id !== "walk").map(vehicle => {
        const Icon = vehicleIcons[vehicle.id], owned = vehicle.dice <= currentVehicle.dice, cost = vehicle.price - currentVehicle.price;
        return <article className="shop-item" key={vehicle.id}><div className="shop-item-heading"><Icon size={22}/><strong>{vehicle.name}</strong><span>最多 {vehicle.dice} 枚骰子</span></div><p>每回合可选 1–{vehicle.dice} 枚骰子，长期有效。{currentVehicle.price > 0 && !owned ? "当前交通工具可抵扣 " + money(currentVehicle.price) + "。" : ""}</p><Button variant="outline" disabled={!available || owned || player.cash < cost} onClick={() => buy({ type: "buy-vehicle", vehicleId: vehicle.id })}>{owned ? (vehicle.id === player.vehicle ? "正在使用" : "已拥有更高级工具") : (player.cash < cost ? "现金不足 · " : "补差价升级 · ") + money(cost)}</Button></article>;
      })}</div><p className="inventory-hint">升级替换当前交通工具；道具和车辆不计入最终净资产。</p></TabsContent>
    </Tabs>
    {error && <p className="entry-error" role="alert">{error}</p>}
    {shopping ? <Button disabled={!ready} onClick={() => { void onAction({ type: "close-shop" }).then(() => onOpenChange(false)).catch(() => {}); }}>完成购物，继续回合</Button> : <Button variant="outline" onClick={() => onOpenChange(false)}>关闭目录</Button>}
  </DialogContent></Dialog>;
}

export function UseItemDialog({ state, player, ready, itemId, targetId, onTargetChange, onClose, onAction, error }: { state: GameState; player: Player; ready: boolean; itemId: ItemId | null; targetId: string; onTargetChange: (id: string) => void; onClose: () => void; onAction: (action: Action) => Promise<void>; error: string }) {
  const item = itemId ? itemFor(itemId) : null;
  const targets = state.players.filter(p => p.id !== player.id && !p.bankrupt);
  const target = item?.target === "self" ? player : targets.find(p => p.id === targetId);
  let reason = "";
  if (state.status !== "playing" || currentPlayer(state).id !== player.id || player.auto || player.bankrupt) reason = "请在自己的回合接管后使用。";
  else if (state.phase !== "roll") reason = "道具需在掷骰前使用。";
  else if (state.itemUsed) reason = "本回合已经使用过一件道具。";
  else if (item && !player.items.includes(item.id)) reason = "这件道具已用完。";
  else if (!target) reason = "请选择一位玩家。";
  else if (item?.id === "meeting" && target.skip) reason = "这位玩家已经要休息一回合。";
  else if (item?.id === "steal" && target.cash <= 0) reason = "这位玩家没有可拿走的现金。";
  else if (item?.id === "demolish" && !Object.values(state.properties).some(property => property.owner === target.id && property.level > 0)) reason = "这位玩家没有可拆除的建筑。";
  else if (item && ["slow", "reverse", "shield", "boost"].includes(item.id) && target.effects[item.id as "slow" | "reverse" | "shield" | "boost"]) reason = "相同效果已经生效，不能叠加。";
  else if (item?.id === "rent-pass" && target.effects.rentPass) reason = "免租效果已经生效。";
  return <Dialog open={!!item} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="use-item-dialog"><DialogTitle>{item?.name ?? "道具详情"}</DialogTitle><DialogDescription>{item?.description}</DialogDescription>
    {item?.target === "opponent" && <div className="target-picker"><label htmlFor="item-target">选择目标玩家</label><Select value={target ? targetId : ""} onValueChange={onTargetChange}><SelectTrigger id="item-target"><SelectValue placeholder="请选择玩家"/></SelectTrigger><SelectContent>{targets.map(p => <SelectItem key={p.id} value={p.id}>{p.name} · {money(p.cash)}{p.effects.shield ? " · 有防护罩" : ""}</SelectItem>)}</SelectContent></Select></div>}
    {target && item?.hostile && target.effects.shield && <p className="inventory-hint">对方的防护罩会抵挡本次效果，双方各消耗一件道具。</p>}
    {reason && <p className="inventory-hint">{reason}</p>}
    {error && <p className="entry-error" role="alert">{error}</p>}
    <Button disabled={!ready || !!reason || !item} onClick={() => { if (item) void onAction({ type: "use-item", itemId: item.id, ...(item.target === "opponent" ? { targetId } : {}) }).then(onClose).catch(() => {}); }}>使用{item?.target === "opponent" && target ? " → " + target.name : ""}</Button>
  </DialogContent></Dialog>;
}
