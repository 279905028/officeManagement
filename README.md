# 工间大富翁

游戏源码、规则、运行及部署说明见 [game/README.md](game/README.md)。

已按确认方案实现：买地后即可建房、最多 3 级；抵押取得地价 50%、赎回支付 55%，抵押期间免租；最终按现金、地产净值和建筑投入排名。

本次平衡调整：每位玩家初始资金由 ₥1,000 增至 ₥2,000；44 格棋盘中「？」事件格由 12 个增至 16 个，地产改为 20 块（每组 5 块），保留 4 个商店。旧存档中被改为事件格的地产按净值返还现金，其余地产及位置保留。

游戏包含 26 种随机事件、10 种互动道具、自行车/电动车/小汽车和 1–5 枚骰子机制。棋盘中央保留紧凑回合操作。

在线游戏：[打开工间大富翁](https://office-management.279905028qq.workers.dev)。

代码仓库：[279905028/officeManagement](https://github.com/279905028/officeManagement)。前端与联机服务均部署到 Cloudflare，部署说明见 [game/README.md](game/README.md)，交付记录见 [DELIVERY.md](DELIVERY.md)。
