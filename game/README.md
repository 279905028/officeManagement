# 工间大富翁 0.2.0

中文轻量网页棋盘游戏。白、灰、低饱和蓝；无音频、无内购。单人可选 1–3 个固定规则电脑对手；联机支持 2–4 位真人，昵称和房间码即可加入。插件仅负责打开网页，朋友无需安装插件。

在线游戏：https://office-management.279905028qq.workers.dev

源码仓库：https://github.com/279905028/officeManagement

## 本地运行

需要 Node.js 22.13 或更新版本（已在 Node.js 24 验证）。在本目录运行：

```sh
npm ci
npm run dev:room
```

另开一个终端，在同一目录运行：

```sh
npm run dev -- --host 127.0.0.1 --port 5173
```

浏览器打开 `http://localhost:5173`。本地前端自动连接 `http://localhost:8787`。本地模式的 SQLite 存档保存在 `room-worker/.wrangler/`；不需要 Cloudflare 登录或付费 AI。开发脚本使用本地运行时支持的兼容日期 2026-09-21，生产配置使用 2026-09-23。

创建房间后，把房间码分享给其他浏览器环境。单机验收多玩家应使用隔离浏览器配置；同一浏览器同一房间只恢复一个席位。

## 规则

- 44 格：20 块地产、16 个「？」事件格（每边 4 个）、4 个道具商店，以及发薪日、税收、休息和会议各一格。
- 26 种随机事件包含现金增减、前进/倒退、赠送道具、玩家互动、团队奖励、免费加建和快闪商店。事件移动后继续结算新落点，最多连续触发 4 次随机事件。
- 每人初始 ₥2,000、换位卡和防护罩各一件，真人与电脑一致。向前经过发薪日领取 ₥200；倒退不领薪水。税收扣 ₥100，会议跳过下一回合，普通休息格没有惩罚。
- 自己的回合掷骰前最多使用一件道具，背包最多 6 件；背包满时，事件赠送的道具折为 ₥40。攻击道具可以选择其他未破产玩家，防护罩自动抵挡一次攻击。
- 停在商店格或遇到快闪商店后可购物，每次最多购买 2 件商品（含车辆升级）。新购道具从下回合开始使用。商店关闭后可继续经营地产或结束回合。
- 交通工具永久增加可选骰子数量：步行 1 枚，自行车 ₥240／2 枚、电动车 ₥480／3 枚、小汽车 ₥760／4 枚；升级补差价。每次可选 1 枚到当前上限，加速卡再加 1 枚，最多 5 枚；减速路障优先，只能掷 1 枚。
- 四组各 5 块地产，地价分别为 ₥120、180、240、300；基础租金为地价的四分之一，集齐同组租金翻倍。
- **买到即可升级，不要求集齐一组**。每地最多 3 级，每级费用为地价的 50%；租金乘以 `1＋等级`。自己的回合完成掷骰及购买选择后，可以经营任意自有地产。
- 卖房返还建造费的 50%；建筑全部卖完后，抵押可取得地价的 50%，抵押期间不收租；按地价 55% 赎回。
- 付费现金不足时，先半价卖房，再以地价一半自动变卖未抵押土地；仍不足则破产。已抵押地不会重复套现。
- 开局 15 分钟后，按 `现金＋地产净值＋建筑投入` 排名：未抵押地计原价，抵押地计半价，建筑计建造投入；道具及交通工具不计入净资产，同分并列。只剩一位未破产玩家时提前结束。
- 每回合最多 60 秒，超时自动托管。点击“接管我的席位”可恢复操作，不重置当前截止时间。电脑会使用道具、进店购买和升级交通工具，主动购买、建房或赎回后至少保留 ₥200。

### 道具目录

| 道具 | 价格 | 效果 |
| --- | ---: | --- |
| 换位卡 | ₥100 | 与目标交换位置，不结算落点或薪水 |
| 顺手牵羊 | ₥70 | 从目标现有现金中拿走最多 ₥120，不强制出售资产 |
| 咖啡请客券 | ₥50 | 目标获得 ₥100，自己获得 ₥40 |
| 减速路障 | ₥80 | 目标下次只能使用 1 枚骰子 |
| 反向指示牌 | ₥80 | 目标下次按骰子点数倒退 |
| 会议邀请 | ₥140 | 目标跳过下一回合，不能叠加 |
| 拆迁卡 | ₥160 | 拆掉目标最高等级建筑的一层，不退款 |
| 防护罩 | ₥90 | 抵挡一次负面道具，随后消失 |
| 免租券 | ₥100 | 免除下一笔非零租金 |
| 加速卡 | ₥70 | 本次掷骰上限增加 1 枚，最多 5 枚 |

棋盘中央已移除大标题、宣传文案和大尺寸骰子装饰，仅保留小型回合操作。大厅、进行中和结算界面均使用简洁状态文字。

## 联机设计

React / TypeScript 前端经 vinext 构建为静态页面，部署到 Cloudflare Workers Static Assets；独立 Cloudflare Worker 将每个房间路由至 SQLite Durable Object。WebSocket 广播完整公开状态，服务端决定骰子、事件、资产与结算。

浏览器生成独立随机席位凭证，通过 HTTPS 请求或 WSS 首帧认证发送。服务器只保存凭证哈希。邀请链接只有房间码，不带控制凭证。刷新或重连从服务端恢复完整棋盘；清除浏览器数据会失去匿名席位恢复能力。

存档 schema 3 保存背包、车辆、状态效果、每枚骰子的结果和本回合限额。读取旧 schema 1 存档时，先按原地产身份重映射到 44 格棋盘，再与 schema 2 存档一起升级：被改为事件格的四块地产按原净值折现（未抵押地原价／抵押地半价，加建筑投入），其余所有权、建筑、抵押、玩家位置及回合截止时间保留；待购买地块若已改成事件格，则结束该购买选择。迁移只执行一次，不重复退款。旧大厅统一更新为每人 ₥2,000；已开始或已结束的对局仅返还被替换地产的净值，不补发初始资金。

操作携带 UUID 和状态版本，服务器校验身份、轮次、资金并持久化去重记录。状态和操作记录在同一 SQLite 事务写入。重复请求只返回最新快照，旧版本不会重复结算。截止时间保存在数据库，通过 Durable Object alarm 推进；房主离线不影响已开始对局。闲置房间 24 小时后删除。

免费额度不是无限容量。配置没有自动升级或购买服务；使用量受 Cloudflare 账户套餐和服务额度约束。

## 验收

```sh
npm run check
npm test
# 房间服务已运行时：
npm run test:integration
# 独立临时数据库，包含真实 60 秒等待：
npm run test:restart
```

`tests/engine.test.ts` 和 `tests/equipment.test.ts` 覆盖棋盘、购地、租金、建房、抵押、发薪、事件、税收、偿债、破产、会议跳过、托管、时间排名、十种道具、商店限额、多骰交通工具及旧存档迁移。

`tests/room.integration.test.mjs` 使用隔离 WebSocket 客户端，验证四人一致性、满员拒绝、中途加入拒绝、越权、重复操作、旧版本、重连、电脑行动，以及道具同步、防护抵挡和骰子数量校验。测试远程服务时，可设置 `ROOM_TEST_URL` 和 `ROOM_TEST_ORIGIN`，后者必须是配置中的真实站点来源。

`tests/restart.test.mjs` 使用与 Wrangler 对应的 Miniflare，重启同一个 SQLite 持久化目录，验证状态、截止时间、去重记录以及真实超时后不重复行动。测试仅清理自身创建的临时目录。

## 部署

在 `game/` 目录操作，需要 Node.js 22.13 或更新版本，以及有 Workers / SQLite Durable Objects 权限的 Cloudflare 账户。

```sh
npm ci
npx wrangler login
npm run check
npm test
npm run deploy
```

`npm run deploy` 先发布房间服务，再构建并发布静态网站。也可分别执行 `npm run deploy:room` 与 `npm run deploy:site`。配置兼容 Workers 免费套餐，不设置仅付费套餐支持的自定义 CPU 限额。

当前部署：

| 服务 | 配置 | 地址 |
| --- | --- | --- |
| 游戏网页 | `wrangler.site.jsonc` | https://office-management.279905028qq.workers.dev |
| 联机服务 | `room-worker/wrangler.jsonc` | https://office-monopoly-room.279905028qq.workers.dev |

更换账户、Worker 名称或域名时，将 `room-worker/wrangler.jsonc` 的 `ALLOWED_ORIGINS` 改为实际前端 HTTPS 来源，将 `lib/room-client.ts` 的 `PRODUCTION_ROOM_API` 改为实际房间服务地址，然后重新部署两者。绑定配置变更后，执行 `npx wrangler types --config room-worker/wrangler.jsonc room-worker/worker-configuration.d.ts` 更新类型。

远程验收：

```sh
curl https://office-monopoly-room.279905028qq.workers.dev/health
ROOM_TEST_URL=https://office-monopoly-room.279905028qq.workers.dev \
ROOM_TEST_ORIGIN=https://office-management.279905028qq.workers.dev \
npm run test:integration
```

独立后端构建检查：`npm run build:room`。前端构建：`npm run build`，静态输出目录为 `dist/client`。不要提交浏览器席位凭证、Cloudflare 凭证、`.env`、`.dev.vars` 或本地运行时数据。

### GitHub 自动部署

工作流位于仓库根目录 `.github/workflows/deploy-cloudflare.yml`。推送 `main` 且修改 `game/` 或工作流文件时自动运行；仅修改根目录文档不会部署。也可在 [Actions](https://github.com/279905028/officeManagement/actions/workflows/deploy-cloudflare.yml) 选择 **Run workflow**，分支选择 `main`。其他分支不会发布生产环境。

流程使用 Node.js 24 和锁定依赖，依次执行类型检查、35 项规则测试、前端构建、前后端部署预检，再部署房间服务和网页，最后检查线上健康状态和 4 项 WebSocket 联机测试。构建或规则检查失败时不会部署；发布后验收失败会将该次运行标记为失败，需要检查日志，工作流不自动回滚。联机测试会创建临时房间，服务按现有 24 小时过期规则清理。

在仓库 **Settings → Secrets and variables → Actions** 配置：

| Secret | 用途 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 当前 Cloudflare 账户 ID |
| `CLOUDFLARE_API_TOKEN` | 该账户的 Workers 部署 API 令牌 |

令牌可从 Cloudflare 的 **Edit Cloudflare Workers** 模板创建，并限制到部署使用的账户。不要使用本地 Wrangler 的临时 OAuth 登录令牌代替 CI API 令牌。相关官方说明：[Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)。

工作流的 GitHub 权限仅为 `contents: read`；Cloudflare 凭据只注入部署步骤。生产部署串行执行，避免前后端发布相互打断。现有 lint 问题另见交付记录，当前不作为发布门禁。

部分网络无法直连 `workers.dev`，需要使用可访问该域名的网络或代理。本次没有配置自定义域名。原 `.openai/hosting.json` 仅保留原项目构建兼容性；当前发布不依赖 Sites 发布辅助脚本。`office-monopoly/` 仍是插件元数据草稿。

## 主要目录

```text
app/                 中文界面与响应式样式
lib/room-client.ts   连接、匿名席位与断线恢复
shared/              棋盘与可测试的规则引擎
room-worker/         Worker、SQLite Durable Object 与发布配置
tests/               规则、四客户端联机与重启验收
.openai/hosting.json Sites 项目与静态产物配置
```
