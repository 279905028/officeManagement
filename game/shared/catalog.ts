export const ITEMS = [
  { id: "swap", name: "换位卡", price: 100, target: "opponent", hostile: true, description: "与一位玩家交换位置，不触发落地事件，也不领取薪水。" },
  { id: "steal", name: "顺手牵羊", price: 70, target: "opponent", hostile: true, description: "拿走一位玩家最多 ₥120 现金，不会让对方变卖资产。" },
  { id: "gift", name: "咖啡请客券", price: 50, target: "opponent", hostile: false, description: "请一位玩家喝咖啡，对方获得 ₥100，你获得 ₥40。" },
  { id: "slow", name: "减速路障", price: 80, target: "opponent", hostile: true, description: "一位玩家下次移动只能掷 1 枚骰子，优先于交通工具和加速。" },
  { id: "reverse", name: "反向指示牌", price: 80, target: "opponent", hostile: true, description: "一位玩家下次掷骰后反向移动，倒退经过发薪日不领薪水。" },
  { id: "meeting", name: "会议邀请", price: 140, target: "opponent", hostile: true, description: "让一位玩家跳过下一回合；不能叠加已有的休息回合。" },
  { id: "demolish", name: "拆迁卡", price: 160, target: "opponent", hostile: true, description: "拆除一位玩家最高等级建筑的一层，不返还建造费。" },
  { id: "shield", name: "防护罩", price: 90, target: "self", hostile: false, description: "抵挡下一次其他玩家的负面道具，触发后消失。" },
  { id: "rent-pass", name: "免租券", price: 100, target: "self", hostile: false, description: "免除下一笔非零租金，使用后持续到触发为止。" },
  { id: "boost", name: "加速卡", price: 70, target: "self", hostile: false, description: "本次移动可多掷 1 枚骰子，最多 5 枚；遇减速路障仍只能掷 1 枚。" },
] as const;
export type ItemId = typeof ITEMS[number]["id"];
export const VEHICLES = [
  { id: "walk", name: "步行", price: 0, dice: 1 },
  { id: "bicycle", name: "自行车", price: 240, dice: 2 },
  { id: "scooter", name: "电动车", price: 480, dice: 3 },
  { id: "car", name: "小汽车", price: 760, dice: 4 },
] as const;
export type VehicleId = typeof VEHICLES[number]["id"];
export const BAG_LIMIT = 6;
export const SHOP_LIMIT = 2;
export const itemFor = (id: string) => ITEMS.find(item => item.id === id);
export const vehicleFor = (id: string) => VEHICLES.find(vehicle => vehicle.id === id) ?? VEHICLES[0];
export const isItemId = (id: unknown): id is ItemId => typeof id === "string" && ITEMS.some(item => item.id === id);
export const isVehicleId = (id: unknown): id is VehicleId => typeof id === "string" && VEHICLES.some(vehicle => vehicle.id === id);
