import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const origin = "http://localhost:5173";
const token = () => randomBytes(32).toString("hex");

test("SQLite 重启保留截止时间和去重记录，真实 60 秒超时只托管一次", { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "office-monopoly-restart-"));
  let runtime, socket;
  const options = {
    name: "office-monopoly-room", modules: true,
    scriptPath: resolve("room-worker/dist/index.js"),
    compatibilityDate: "2026-09-21", compatibilityFlags: ["nodejs_compat"],
    bindings: { ALLOWED_ORIGINS: origin },
    durableObjects: { ROOMS: { className: "GameRoom", useSQLite: true } },
    resourcePersistencePath: directory, port: 0, cf: false,
  };
  async function boot() { runtime = new Miniflare(convertV4MiniflareOptions(options)); return (await runtime.ready).origin; }
  async function post(base, path, body) {
    const response = await fetch(base + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  function connect(base, seat) {
    socket = new WebSocket(base.replace(/^http/, "ws") + "/api/rooms/" + seat.code + "/ws", { headers: { Origin: origin } });
    const messages = [];
    socket.on("error", () => {});
    socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token: seat.token })));
    socket.on("message", data => messages.push(JSON.parse(data.toString())));
    return async function wait(predicate, timeout = 7000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const found = messages.find(predicate); if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("等待持久化测试消息超时");
    };
  }
  async function stop() { socket?.terminate(); await runtime?.dispose(); runtime = undefined; }
  try {
    let base = await boot();
    const secret = token();
    const seat = { ...await post(base, "/api/rooms", { name: "重启房主", mode: "online", token: secret }), token: secret };
    await post(base, "/api/rooms/" + seat.code + "/join", { name: "重启访客", token: token() });
    let wait = connect(base, seat);
    const initial = await wait(m => m.state?.players.length === 2);
    const command = { type: "command", commandId: randomUUID(), expectedVersion: initial.state.version, action: { type: "start" } };
    socket.send(JSON.stringify(command));
    let started = await wait(m => m.type === "ack" && m.commandId === command.commandId);
    const shield = { type: "command", commandId: randomUUID(), expectedVersion: started.state.version, action: { type: "use-item", itemId: "shield" } };
    socket.send(JSON.stringify(shield));
    started = await wait(m => m.type === "ack" && m.commandId === shield.commandId);
    assert.equal(started.state.players[0].effects.shield, true);
    assert.deepEqual(started.state.players[0].items, ["swap"]);
    await stop(); base = await boot(); wait = connect(base, seat);
    const restored = await wait(m => m.state?.status === "playing");
    assert.deepEqual(restored.state, started.state);
    socket.send(JSON.stringify(command));
    const duplicate = await wait(m => m.type === "ack" && m.duplicate);
    assert.deepEqual(duplicate.state, started.state);
    console.log("重启后状态、回合截止时间、去重记录一致；等待真实 60 秒截止。");
    const timed = await wait(m => m.state?.turn === 2, 65_000);
    assert.equal(timed.state.players[0].auto, true);
    assert.equal(timed.state.logs.filter(x => x.text.includes("超过 60 秒")).length, 1);
    assert.equal(timed.state.logs.filter(x => x.text.includes("掷出")).length, 1);
    await stop(); base = await boot(); wait = connect(base, seat);
    const restoredAgain = await wait(m => m.state?.turn === 2);
    assert.deepEqual(restoredAgain.state, timed.state);
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
