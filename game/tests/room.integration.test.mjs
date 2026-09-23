import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import WebSocket from "ws";
const BASE=process.env.ROOM_TEST_URL||"http://localhost:8787",ORIGIN=process.env.ROOM_TEST_ORIGIN||"http://localhost:5173";
const token=()=>randomBytes(32).toString("hex");
async function post(path,body,origin=ORIGIN){
  const r=await fetch(BASE+path,{method:"POST",headers:{"Content-Type":"application/json","Origin":origin},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
}
async function create(name="测试房主",mode="online"){
  const secret=token();const r=await post("/api/rooms",{name,mode,botCount:3,token:secret});
  assert.equal(r.status,201,JSON.stringify(r.body));return {...r.body,token:secret};
}
async function join(code,name){
  const secret=token();const r=await post("/api/rooms/"+code+"/join",{name,token:secret});
  assert.equal(r.status,200,JSON.stringify(r.body));return {...r.body,token:secret};
}
function connect(seat){
  const ws=new WebSocket(BASE.replace(/^http/,"ws")+"/api/rooms/"+seat.code+"/ws",{headers:{Origin:ORIGIN}});
  const messages=[],waiters=[];let latest;
  const wait=(predicate,timeout=7000)=>{
    const existing=messages.find(predicate);if(existing)return Promise.resolve(existing);
    return new Promise((resolve,reject)=>{
      const waiter={predicate,resolve,reject};waiters.push(waiter);
      waiter.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error(`WebSocket wait timed out after ${timeout}ms (status=${latest?.status}, turn=${latest?.turn}, phase=${latest?.phase}, version=${latest?.version})`));},timeout);
    });
  };
  ws.on("message",raw=>{
    if(raw.toString()==="pong")return;
    const msg=JSON.parse(raw.toString());messages.push(msg);if(msg.state)latest=msg.state;
    for(const waiter of [...waiters])if(waiter.predicate(msg)){clearTimeout(waiter.timer);waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(msg);}
  });
  ws.on("error",()=>{});
  ws.on("open",()=>ws.send(JSON.stringify({type:"auth",token:seat.token})));
  const send=(action,id=randomUUID(),version=latest.version)=>{ws.send(JSON.stringify({type:"command",commandId:id,expectedVersion:version,action}));return id;};
  return {ws,wait,send,get state(){return latest;},close(){ws.terminate();for(const w of waiters)clearTimeout(w.timer);}};
}
test("四席位一致、满员/开局拒绝、去重/越权/版本校验、刷新重连",async()=>{
  const seats=[await create()];
  for(let i=1;i<4;i++)seats.push(await join(seats[0].code,"测试玩家"+i));
  const fifth=await post("/api/rooms/"+seats[0].code+"/join",{name:"第五人",token:token()});
  assert.equal(fifth.body.code,"ROOM_FULL");
  const clients=seats.map(connect);
  try{
    await Promise.all(clients.map(c=>c.wait(m=>m.state?.players.length===4)));
    assert.deepEqual(clients[0].state.players.map(p=>p.cash),[2000,2000,2000,2000]);
    assert.equal(Object.keys(clients[0].state.properties).length,20);
    const owner=clients[0],version=owner.state.version;
    const startId=owner.send({type:"start"});
    const started=await owner.wait(m=>m.type==="ack"&&m.commandId===startId);
    await Promise.all(clients.map(c=>c.wait(m=>m.state?.version===started.state.version)));
    assert.ok(clients.every(c=>JSON.stringify(c.state)===JSON.stringify(owner.state)));
    owner.send({type:"start"},startId,version);
    const duplicate=await owner.wait(m=>m.type==="ack"&&m.commandId===startId&&m.duplicate);
    assert.equal(duplicate.state.version,started.state.version);
    owner.send({type:"roll"},startId,version);
    await owner.wait(m=>m.code==="COMMAND_REUSED");
    clients[1].send({type:"roll"});
    await clients[1].wait(m=>m.code==="NOT_YOUR_TURN");
    const staleId=owner.send({type:"roll"},randomUUID(),0);
    await owner.wait(m=>m.code==="STALE_STATE"&&m.commandId===staleId);
    const rollVersion=owner.state.version,rollId=randomUUID();
    owner.send({type:"roll"},rollId,rollVersion);owner.send({type:"roll"},rollId,rollVersion);
    const rolled=await owner.wait(m=>m.type==="ack"&&m.commandId===rollId&&!m.duplicate);
    await owner.wait(m=>m.type==="ack"&&m.commandId===rollId&&m.duplicate);
    assert.equal(rolled.state.version,rollVersion+1);
    await Promise.all(clients.map(c=>c.wait(m=>m.state?.version===rolled.state.version)));
    assert.ok(clients.every(c=>JSON.stringify(c.state)===JSON.stringify(owner.state)));
    const late=await post("/api/rooms/"+seats[0].code+"/join",{name:"中途加入",token:token()});
    assert.equal(late.body.code,"ALREADY_STARTED");
    const restored=await post("/api/rooms/"+seats[1].code+"/join",{name:"改名无效",token:seats[1].token});
    assert.equal(restored.body.playerId,seats[1].playerId);
    clients[1].close();const reconnected=connect(seats[1]);clients[1]=reconnected;
    const snapshot=await reconnected.wait(m=>m.state?.status==="playing");
    assert.equal(snapshot.state.version,rolled.state.version);
    assert.equal(snapshot.state.players.length,4);
    assert.equal(snapshot.state.players[1].id,seats[1].playerId);
    assert.ok(!JSON.stringify(snapshot.state).includes(seats[0].token));
  }finally{clients.forEach(c=>c.close());}
});
test("非法来源、无效参数和未认证操作被拒绝",async()=>{
  const denied=await post("/api/rooms",{name:"访问测试",mode:"online",token:token()},"https://untrusted.example");assert.equal(denied.status,403);
  const bad=await post("/api/rooms",{name:"",mode:"online",token:token()});assert.equal(bad.body.code,"INVALID_ACTION");
  const oversized=await post("/api/rooms",{name:"超长测试",mode:"online",token:token(),data:"a".repeat(3000)});assert.equal(oversized.body.code,"INVALID_REQUEST");
  const seat=await create("身份验证测试");
  const ws=new WebSocket(BASE.replace(/^http/,"ws")+"/api/rooms/"+seat.code+"/ws",{headers:{Origin:ORIGIN}});
  try{
    const response=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("Auth test timed out")),7000);
      ws.on("open",()=>ws.send(JSON.stringify({type:"command",commandId:randomUUID(),expectedVersion:seat.state.version,action:{type:"start"}})));
      ws.on("message",raw=>{clearTimeout(timer);resolve(JSON.parse(raw.toString()));});
    });
    assert.equal(response.code,"UNAUTHENTICATED");
  }finally{ws.close();}
});
test("单人模式含三位电脑，自动对手轮转并保留至少 200 现金",async()=>{
  const seat=await create("单人测试","solo"),client=connect(seat);
  try{
    await client.wait(m=>m.state?.status==="playing");
    assert.equal(client.state.players.filter(p=>p.bot).length,3);
    assert.deepEqual(client.state.players.map(p=>p.cash),[2000,2000,2000,2000]);
    const autoId=client.send({type:"autoplay"});
    await client.wait(m=>m.type==="ack"&&m.commandId===autoId);
    // Allow cloud alarm delivery jitter, while staying below the 60s turn timeout.
    const after=await client.wait(m=>m.state?.turn>=5,30_000);
    assert.ok(after.state.players.every(p=>p.cash>=200));
    assert.equal(after.state.players.length,4);
  }finally{client.close();}
});

test("道具联机同步、去重、护盾抵挡与骰子数量校验",async()=>{
  const seats=[await create("道具房主")];seats.push(await join(seats[0].code,"道具访客"));
  const clients=seats.map(connect);
  try{
    await Promise.all(clients.map(c=>c.wait(m=>m.state?.players.length===2)));
    const owner=clients[0],guest=clients[1];
    const send=async(client,action)=>{const id=client.send(action);return client.wait(m=>m.type==="ack"&&m.commandId===id);};
    await send(owner,{type:"start"});
    const version=owner.state.version,id=randomUUID();
    owner.send({type:"use-item",itemId:"shield"},id,version);
    const shield=await owner.wait(m=>m.type==="ack"&&m.commandId===id);
    await guest.wait(m=>m.state?.version===shield.state.version);
    assert.deepEqual(guest.state.players,owner.state.players);assert.equal(owner.state.players[0].effects.shield,true);
    owner.send({type:"use-item",itemId:"shield"},id,version);
    const duplicate=await owner.wait(m=>m.type==="ack"&&m.commandId===id&&m.duplicate);
    assert.deepEqual(duplicate.state,shield.state);
    owner.send({type:"roll",diceCount:2});await owner.wait(m=>m.code==="INVALID_ACTION"&&m.error.includes("骰子数量"));
    assert.equal(owner.state.diceValues.length,0);
    const rolled=await send(owner,{type:"roll",diceCount:1});
    assert.equal(rolled.state.diceValues.length,1);
    if(owner.state.phase==="buy")await send(owner,{type:"skip-buy"});
    if(owner.state.phase==="shop")await send(owner,{type:"close-shop"});
    const ended=await send(owner,{type:"end-turn"});await guest.wait(m=>m.state?.version===ended.state.version);
    const positions=guest.state.players.map(p=>p.position);
    const used=await send(guest,{type:"use-item",itemId:"swap",targetId:seats[0].playerId});
    await owner.wait(m=>m.state?.version===used.state.version);
    assert.equal(owner.state.players[0].effects.shield,false);assert.deepEqual(owner.state.players.map(p=>p.position),positions);
    assert.deepEqual(owner.state.players[1].items,["shield"]);assert.deepEqual(owner.state,guest.state);
  }finally{clients.forEach(c=>c.close());}
});
