import { DurableObject } from "cloudflare:workers";
import { createGame, addPlayer, applyAction, advanceTime, nextWake, GameError, normalizeName, restoreGame } from "../../shared/engine.ts";
import { isItemId, isVehicleId } from "../../shared/catalog.ts";
import type { Action, GameState } from "../../shared/engine.ts";

type Attachment = { playerId?: string; opened: number; window: number; count: number };
type Command = { commandId: string; expectedVersion: number; action: Action };
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
function errorResponse(error: unknown) {
  if (error instanceof GameError) return json({ error: error.message, code: error.code }, error.code === "NOT_FOUND" ? 404 : error.code === "RATE_LIMIT" ? 429 : 400);
  console.error(JSON.stringify({ event: "room_error", message: error instanceof Error ? error.message : "Unknown error" }));
  return json({ error: "服务暂时不可用，请稍后重试", code: "SERVER_ERROR" }, 503);
}
export function randomInt(max: number): number {
  const bound = Math.floor(0x100000000 / max) * max, buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0] >= bound);
  return buffer[0] % max;
}
async function hash(value: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2,"0")).join("");
}
function assertToken(token: unknown): asserts token is string {
  if (typeof token !== "string" || !TOKEN.test(token)) throw new GameError("INVALID_TOKEN", "无效的席位凭证");
}
async function readBody(request: Request): Promise<Record<string,unknown>> {
  const reader=request.body?.getReader(); if(!reader)throw new GameError("INVALID_REQUEST","请求为空");
  const parts:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();throw new GameError("INVALID_REQUEST","请求过大");}parts.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
  try{const data:unknown=JSON.parse(new TextDecoder().decode(bytes));if(data&&typeof data==="object"&&!Array.isArray(data))return data as Record<string,unknown>;}catch{/* Report a client error below. */}
  throw new GameError("INVALID_REQUEST","请求 JSON 格式错误");
}
function parseCommand(data: Record<string, unknown>): Command {
  if (typeof data.commandId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(data.commandId) || !Number.isSafeInteger(data.expectedVersion))
    throw new GameError("INVALID_COMMAND", "操作格式错误");
  const a = data.action as Record<string, unknown> | null;
  if (!a || typeof a !== "object" || typeof a.type !== "string") throw new GameError("INVALID_ACTION","操作格式错误");
  let action: Action;
  switch(a.type) {
    case "start": case "buy": case "skip-buy": case "close-shop": case "end-turn": case "takeover": case "autoplay": case "leave": action = { type:a.type }; break;
    case "roll":
      if (a.diceCount !== undefined && (typeof a.diceCount !== "number" || !Number.isInteger(a.diceCount) || a.diceCount < 1 || a.diceCount > 5)) throw new GameError("INVALID_ACTION", "无效骰子数量");
      action = { type: "roll", ...(a.diceCount !== undefined ? { diceCount: a.diceCount as number } : {}) }; break;
    case "buy-item": case "use-item":
      if (!isItemId(a.itemId)) throw new GameError("INVALID_ACTION", "无效道具");
      if (a.type === "use-item" && a.targetId !== undefined && (typeof a.targetId !== "string" || a.targetId.length > 80)) throw new GameError("INVALID_ACTION", "无效目标玩家");
      action = a.type === "buy-item" ? { type: "buy-item", itemId: a.itemId } : { type: "use-item", itemId: a.itemId, ...(typeof a.targetId === "string" ? { targetId: a.targetId } : {}) }; break;
    case "buy-vehicle":
      if (!isVehicleId(a.vehicleId)) throw new GameError("INVALID_ACTION", "无效交通工具");
      action = { type: "buy-vehicle", vehicleId: a.vehicleId }; break;
    case "upgrade": case "sell-building": case "mortgage": case "redeem":
      if (typeof a.tileId !== "number" || !Number.isInteger(a.tileId)) throw new GameError("INVALID_ACTION","无效地产");
      action = {type:a.type,tileId:a.tileId}; break;
    default: throw new GameError("INVALID_ACTION","不支持的操作");
  }
  return { commandId:data.commandId, expectedVersion:data.expectedVersion as number, action };
}

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK (id=1), snapshot TEXT NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS seats (token_hash TEXT PRIMARY KEY, player_id TEXT UNIQUE NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, action TEXT NOT NULL, version INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS create_limit (id INTEGER PRIMARY KEY, period INTEGER NOT NULL, count INTEGER NOT NULL)");
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  private read(): GameState | null {
    const row = this.ctx.storage.sql.exec<{ snapshot: string }>("SELECT snapshot FROM room WHERE id=1").toArray()[0];
    return row ? restoreGame(JSON.parse(row.snapshot)) : null;
  }
  private required(): GameState {
    const state = this.read();
    if (!state || Date.now() >= state.expiresAt) throw new GameError("NOT_FOUND","房间不存在或已过期");
    return state;
  }
  private save(s: GameState, extra?: () => void) {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("INSERT INTO room (id,snapshot) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot", JSON.stringify(s));
      extra?.();
    });
  }
  private envelope(s = this.required()) {
    const onlineIds = [...new Set(this.ctx.getWebSockets().filter(ws => ws.readyState === 1).map(ws => (ws.deserializeAttachment() as Attachment | null)?.playerId).filter(Boolean))];
    return { type:"state", state:s, onlineIds, serverNow:Date.now() };
  }
  private broadcast() {
    const s = this.read(); if (!s) return;
    const message = JSON.stringify(this.envelope(s));
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (attachment?.playerId && ws.readyState === 1) try { ws.send(message); } catch { /* Socket already closed. */ }
    }
  }
  private async schedule() {
    const s = this.read();
    let at = s ? nextWake(s) : Infinity;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && !a.playerId) at = Math.min(at, a.opened + 5000);
    }
    if (Number.isFinite(at)) await this.ctx.storage.setAlarm(Math.max(Date.now() + 50, at));
  }
  private async tick() {
    const s = this.required(), next = advanceTime(s, Date.now(), randomInt);
    if (next !== s) { this.save(next); this.broadcast(); }
    await this.schedule();
  }
  async allowCreation() {
    const period = Math.floor(Date.now()/60_000);
    const row = this.ctx.storage.sql.exec<{period:number; count:number}>("SELECT period,count FROM create_limit WHERE id=1").toArray()[0];
    const count = row?.period === period ? row.count + 1 : 1;
    if (count > 10) return false;
    this.ctx.storage.sql.exec("INSERT INTO create_limit VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET period=excluded.period,count=excluded.count",period,count);
    await this.ctx.storage.setAlarm(Date.now()+120_000);
    return true;
  }
  async initialize(code: string, name: string, mode: "solo" | "online", bots: number, token: string) {
    try {
    assertToken(token); const tokenHash = await hash(token);
    if (this.read()) return null;
    const playerId = crypto.randomUUID(), state = createGame(code,playerId,name,mode,bots,Date.now());
    this.save(state, () => this.ctx.storage.sql.exec("INSERT INTO seats VALUES (?,?)", tokenHash,playerId));
    await this.schedule();
    return { code, playerId, ...this.envelope(state) };
    } catch(error) { if(error instanceof GameError)return {failure:{code:error.code,message:error.message}};throw error; }
  }
  async join(name: string, token: string) {
    try {
    assertToken(token); const tokenHash = await hash(token);
    const state = this.required();
    const existing = this.ctx.storage.sql.exec<{player_id:string}>("SELECT player_id FROM seats WHERE token_hash=?",tokenHash).toArray()[0];
    if (existing && state.players.some(p=>p.id===existing.player_id)) return {code:state.code,playerId:existing.player_id,...this.envelope(state)};
    const playerId = crypto.randomUUID();
    if (state.mode === "solo") throw new GameError("PRIVATE_GAME","这是单人对局");
    addPlayer(state,playerId,name,false,Date.now());
    this.save(state, () => {
      if (existing) this.ctx.storage.sql.exec("DELETE FROM seats WHERE token_hash=?",tokenHash);
      this.ctx.storage.sql.exec("INSERT INTO seats VALUES (?,?)",tokenHash,playerId);
    });
    await this.schedule(); this.broadcast();
    return {code:state.code,playerId,...this.envelope(state)};
    } catch(error) { if(error instanceof GameError)return {failure:{code:error.code,message:error.message}};throw error; }
  }
  async fetch(request: Request): Promise<Response> {
    try {
      this.required();
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({error:"WebSocket required"},426);
      if (this.ctx.getWebSockets().length >= 12) return json({error:"连接过多，请稍后重试"},429);
      const pair = new WebSocketPair(), [client,server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({opened:Date.now(),window:Date.now(),count:0} satisfies Attachment);
      await this.schedule();
      return new Response(null,{status:101,webSocket:client});
    } catch(e) {return errorResponse(e);}
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      if (typeof message !== "string" || message.length > 4096) throw new GameError("INVALID_MESSAGE","消息过大或格式错误");
      let meta = ws.deserializeAttachment() as Attachment;
      const now=Date.now();
      if (now-meta.window>10_000) {meta.window=now;meta.count=0;}
      if (++meta.count > 40) throw new GameError("RATE_LIMIT","操作过于频繁，请稍等");
      ws.serializeAttachment(meta);
      const data: Record<string,unknown> = JSON.parse(message);
      if (!data || typeof data!=="object") throw new GameError("INVALID_MESSAGE","消息格式错误");
      if (data.type === "auth") {
        if (meta.playerId) throw new GameError("ALREADY_AUTHENTICATED","连接已认证");
        assertToken(data.token);
        const tokenHash = await hash(data.token);
        const row = this.ctx.storage.sql.exec<{player_id:string}>("SELECT player_id FROM seats WHERE token_hash=?",tokenHash).toArray()[0];
        const s = this.required();
        if (!row || !s.players.some(p=>p.id===row.player_id)) { ws.close(4003,"席位凭证无效"); return; }
        for (const old of this.ctx.getWebSockets()) {
          if (old!==ws && (old.deserializeAttachment() as Attachment | null)?.playerId===row.player_id) old.close(4001,"已在另一窗口连接");
        }
        meta.playerId = row.player_id; ws.serializeAttachment(meta);
        await this.tick(); this.broadcast(); return;
      }
      if (!meta.playerId) throw new GameError("UNAUTHENTICATED","请先验证席位");
      if (data.type !== "command") throw new GameError("INVALID_MESSAGE","消息格式错误");
      const command=parseCommand(data);
      await this.tick();
      const s=this.required(), key=meta.playerId+":"+command.commandId, encoded=JSON.stringify(command.action);
      const duplicate=this.ctx.storage.sql.exec<{action:string}>("SELECT action FROM commands WHERE id=?",key).toArray()[0];
      if (duplicate) {
        if (duplicate.action!==encoded) throw new GameError("COMMAND_REUSED","请勿将同一操作编号用于不同操作");
        ws.send(JSON.stringify({...this.envelope(s),type:"ack",commandId:command.commandId,duplicate:true})); return;
      }
      if (s.version!==command.expectedVersion) {
        ws.send(JSON.stringify({...this.envelope(s),type:"error",code:"STALE_STATE",error:"棋盘已更新，请重试",commandId:command.commandId})); return;
      }
      const next=applyAction(s,meta.playerId,command.action,Date.now(),randomInt);
      this.save(next,()=>this.ctx.storage.sql.exec("INSERT INTO commands VALUES (?,?,?)",key,encoded,next.version));
      await this.schedule();
      ws.send(JSON.stringify({...this.envelope(),type:"ack",commandId:command.commandId}));
      this.broadcast();
    } catch(error) {
      const safe = error instanceof GameError ? error : new GameError("INVALID_MESSAGE","无法处理这次操作");
      if (!(error instanceof GameError)) console.error(JSON.stringify({event:"message_error",message:error instanceof Error?error.message:"Unknown"}));
      if(ws.readyState===1) ws.send(JSON.stringify({type:"error",code:safe.code,error:safe.message}));
    }
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) { ws.close(code===1005||code===1006?1000:code,reason); this.broadcast(); await this.schedule(); }
  async webSocketError(ws: WebSocket) { ws.close(1011,"连接中断"); }
  async alarm() {
    const now=Date.now(), s=this.read();
    if (!s || now>=s.expiresAt) {
      for (const ws of this.ctx.getWebSockets()) ws.close(4004,"房间已过期");
      await this.ctx.storage.deleteAll(); return;
    }
    for (const ws of this.ctx.getWebSockets()) {
      const a=ws.deserializeAttachment() as Attachment | null;
      if(a&&!a.playerId&&now-a.opened>=5000) ws.close(4003,"验证超时");
    }
    await this.tick();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url=new URL(request.url), origin=request.headers.get("Origin");
    const allowed=env.ALLOWED_ORIGINS.split(",").map(s=>s.trim());
    if(origin&&!allowed.includes(origin)) return json({error:"不允许的来源"},403);
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":origin||allowed[0],"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type","Access-Control-Max-Age":"86400","Vary":"Origin"}});
    let response: Response;
    try {
      if(url.pathname==="/health") response=json({ok:true,version:"0.2.0",protocol:2});
      else if(request.method==="GET"&&/^\/api\/rooms\/[A-Z2-9]{6}\/ws$/.test(url.pathname)) {
        const code=url.pathname.split("/")[3];
        if(!CODE.test(code)) throw new GameError("NOT_FOUND","无效房间码");
        return await env.ROOMS.getByName(code).fetch(request);
      } else if(request.method==="POST"&&(url.pathname==="/api/rooms"||/^\/api\/rooms\/[A-Z2-9]{6}\/join$/.test(url.pathname))) {
        if(!request.headers.get("Content-Type")?.includes("application/json")) throw new GameError("INVALID_REQUEST","需要 JSON 请求");
        const body=await readBody(request), name=normalizeName(body.name);
        assertToken(body.token);
        if(url.pathname==="/api/rooms") {
          if(body.mode!=="solo"&&body.mode!=="online") throw new GameError("INVALID_MODE","请选择游戏模式");
          const ipHash=await hash(request.headers.get("CF-Connecting-IP")||"local");
          if(!await env.ROOMS.getByName("rate-"+ipHash).allowCreation()) throw new GameError("RATE_LIMIT","创建房间太频繁，请稍后再试");
          let result=null;
          for(let n=0;n<4&&!result;n++) {
            const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            const code=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join("");
            result=await env.ROOMS.getByName(code).initialize(code,name,body.mode,body.botCount as number,body.token);
          }
          if(!result) throw new GameError("CREATE_FAILED","创建失败，请重试");
          if("failure" in result && result.failure)throw new GameError(result.failure.code,result.failure.message);
          response=json(result,201);
        } else {
          const code=url.pathname.split("/")[3];
          if(!CODE.test(code)) throw new GameError("NOT_FOUND","无效房间码");
          const result=await env.ROOMS.getByName(code).join(name,body.token);
          if("failure" in result && result.failure)throw new GameError(result.failure.code,result.failure.message);
          response=json(result);
        }
      } else response=json({error:"接口不存在"},404);
    } catch(error) {response=errorResponse(error);}
    const headers=new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin",origin||allowed[0]); headers.set("Vary","Origin");
    headers.set("X-Content-Type-Options","nosniff");
    return new Response(response.body,{status:response.status,headers});
  },
} satisfies ExportedHandler<Env>;
