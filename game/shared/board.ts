import type { ItemId } from "./catalog.ts";
export type TileKind = "property" | "event" | "shop" | "start" | "tax" | "rest" | "meeting";
export const BOARD_SIDE = 12;
export const BOARD_LENGTH = (BOARD_SIDE - 1) * 4;
export interface Tile { id: number; name: string; short: string; kind: TileKind; group?: number; price: number }
export const GROUPS = ["茶水街", "创意街", "协作街", "云端街"];
const names = [
  ["手冲咖啡", "早餐铺", "便利商店", "鲜花小店", "午后书屋", "甜品工坊"],
  ["灵感画室", "印刷工坊", "设计小馆", "创意工坊", "摄影棚", "音乐空间"],
  ["共享工位", "协作中心", "培训教室", "路演大厅", "研发工坊", "项目中心"],
  ["空中花园", "观景茶室", "云端书房", "商务会所", "天际餐厅", "星光露台"],
];
const shortNames = [
  ["咖啡", "早餐", "商店", "花店", "书屋", "甜品"],
  ["画室", "印刷", "设计", "创意", "摄影", "音乐"],
  ["工位", "协作", "培训", "路演", "研发", "项目"],
  ["花园", "茶室", "书房", "会所", "餐厅", "露台"],
];
const corners: TileKind[] = ["start", "tax", "rest", "meeting"];
const cornerNames = ["发薪日", "缴税处", "休息站", "开会中"];
export const BOARD: Tile[] = Array.from({ length: BOARD_LENGTH }, (_, id) => {
  const group = Math.floor(id / 11), offset = id % 11;
  if (offset === 0) return { id, name: cornerNames[group], short: ["发薪", "缴税", "休息", "会议"][group], kind: corners[group], price: 0 };
  if ([3, 4, 7, 9].includes(offset)) return { id, name: "随机事件", short: "？", kind: "event", price: 0 };
  if (offset === 5) return { id, name: "道具商店", short: "商店", kind: "shop", price: 0 };
  // Preserve the remaining properties' identities when offset 4 becomes an event.
  const idx = [1, 2, 4, 6, 8, 10].indexOf(offset);
  return { id, name: names[group][idx], short: shortNames[group][idx], kind: "property", group, price: [120, 180, 240, 300][group] };
});
export type BoardEvent = { text: string } & (
  | { kind: "cash"; amount: number }
  | { kind: "move"; steps: number }
  | { kind: "item"; itemId: ItemId }
  | { kind: "gift" | "collect" | "bonus" | "shop" | "holiday" | "repair" }
);
export const EVENTS: BoardEvent[] = [
  { kind: "cash", text: "项目奖金到账", amount: 150 }, { kind: "cash", text: "请同事喝咖啡", amount: -50 },
  { kind: "cash", text: "报销顺利通过", amount: 100 }, { kind: "cash", text: "工位设备维修", amount: -100 },
  { kind: "cash", text: "分享会获得奖励", amount: 80 }, { kind: "cash", text: "错过早鸟优惠", amount: -80 },
  { kind: "cash", text: "旧物转让成功", amount: 120 }, { kind: "cash", text: "周五聚餐买单", amount: -120 },
  { kind: "cash", text: "全勤奖励到账", amount: 180 }, { kind: "cash", text: "忘关空调补交电费", amount: -60 },
  { kind: "cash", text: "抽中午餐代金券", amount: 60 }, { kind: "cash", text: "键盘进水更换设备", amount: -140 },
  { kind: "move", text: "发现近路，向前走 3 格", steps: 3 },
  { kind: "move", text: "坐过一站，向前走 5 格", steps: 5 },
  { kind: "move", text: "忘拿工牌，退后 2 格", steps: -2 },
  { kind: "move", text: "临时绕路，退后 4 格", steps: -4 },
  { kind: "item", text: "收到同事送的换位卡", itemId: "swap" },
  { kind: "item", text: "抽中防护罩", itemId: "shield" },
  { kind: "item", text: "拿到街区免租券", itemId: "rent-pass" },
  { kind: "item", text: "发现一张加速卡", itemId: "boost" },
  { kind: "gift", text: "团队下午茶，其他玩家各获得 ₥40" },
  { kind: "collect", text: "生日祝福，向其他玩家各收取最多 ₥30 现金" },
  { kind: "bonus", text: "团队项目结项，所有在场玩家各获得 ₥60" },
  { kind: "shop", text: "街区快闪商店，获得一次购物机会" },
  { kind: "holiday", text: "临时调休，下回合休息，获得 ₥120 补贴" },
  { kind: "repair", text: "街区改造，免费加建一层自有建筑；没有可加建地产则获得 ₥80" },
];
export function boardPosition(id: number) {
  if (id <= 11) return { gridRow: 12, gridColumn: 12 - id };
  if (id <= 22) return { gridRow: 23 - id, gridColumn: 1 };
  if (id <= 33) return { gridRow: 1, gridColumn: id - 21 };
  return { gridRow: id - 32, gridColumn: 12 };
}
