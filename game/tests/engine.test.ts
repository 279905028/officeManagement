import test from "node:test";
import assert from "node:assert/strict";
import {BOARD,boardPosition} from "../shared/board.ts";
import {createGame,applyAction,advanceTime,currentPlayer,netWorth,rankings,rentFor,charge,addPlayer,restoreGame,GAME_MS,TURN_MS} from "../shared/engine.ts";
import type {GameState,Action} from "../shared/engine.ts";
const NOW=1_000_000;
// Keep asset scenarios at a fixed balance, independent of the new-game allowance.
const make=()=>{const s=createGame("ABC23D","human","我","solo",1,NOW);for(const p of s.players)p.cash=1000;return s;};
const action=(s:GameState,a:Action,id="human",time=NOW)=>applyAction(s,id,a,time,()=>0);
function bought(){let s=action(make(),{type:"roll"});return action(s,{type:"buy"});}
test("44 个唯一棋盘位置：20 地产、16 事件、4 商店和 4 特别格",()=>{
  assert.equal(BOARD.length,44);assert.equal(BOARD.filter(t=>t.kind==="property").length,20);assert.equal(BOARD.filter(t=>t.kind==="event").length,16);
  assert.equal(new Set(BOARD.map(t=>JSON.stringify(boardPosition(t.id)))).size,44);
  for(let group=0;group<4;group++){
    assert.equal(BOARD.filter(t=>t.group===group).length,5);
    assert.equal(BOARD.slice(group*11,(group+1)*11).filter(t=>t.kind==="event").length,4);
  }
});
test("单人、电脑和联机席位均以 2000 现金开局，日志一致",()=>{
  const solo=createGame("ABC23D","human","我","solo",3,NOW);
  assert.deepEqual(solo.players.map(p=>p.cash),[2000,2000,2000,2000]);
  let online=createGame("ABC23D","host","房主","online",0,NOW);
  for(let i=1;i<4;i++)addPlayer(online,"p"+i,"玩家"+i,false,NOW);
  online=action(online,{type:"start"},"host");
  assert.deepEqual(online.players.map(p=>p.cash),[2000,2000,2000,2000]);
  for(const s of [solo,online])assert.match(s.logs.at(-1)!.text,/每人 ₥2,000/);
});
test("新增的事件格触发奖励，不再出售地产",()=>{
  for(const tileId of [4,15,26,37]){
    const s=make();s.players[0].position=tileId-1;
    const next=action(s,{type:"roll"});
    assert.equal(next.players[0].position,tileId);assert.equal(next.players[0].cash,1150);
    assert.equal(next.phase,"manage");assert.equal(next.pending,null);assert.equal(next.properties[tileId],undefined);
  }
});
test("购买按地价扣款，原状态不变，不能再次掷骰",()=>{
  const initial=make(),rolled=action(initial,{type:"roll"}),s=action(rolled,{type:"buy"});
  assert.equal(initial.players[0].position,0);assert.equal(s.players[0].cash,880);assert.equal(s.properties[1].owner,"human");
  assert.equal(netWorth(s,s.players[0]),1000);assert.throws(()=>action(s,{type:"roll"}));
});
test("没有集齐一组也能建房，最多 3 级，租金按等级增长",()=>{
  let s=bought();for(let n=1;n<=3;n++){s=action(s,{type:"upgrade",tileId:1});assert.equal(rentFor(s,1),30*(n+1));}
  assert.equal(s.players[0].cash,700);assert.equal(netWorth(s,s.players[0]),1000);
  assert.throws(()=>action(s,{type:"upgrade",tileId:1}));assert.equal(s.properties[1].level,3);
});
test("集齐 5 块同组地产才翻倍，抵押地不收租",()=>{
  const s=bought(),group=BOARD.filter(t=>t.group===0);
  for(const t of group.slice(0,-1))s.properties[t.id].owner="human";
  assert.equal(rentFor(s,1),30);
  s.properties[group.at(-1)!.id].owner="human";
  assert.equal(rentFor(s,1),60);s.properties[1].level=2;assert.equal(rentFor(s,1),180);
  s.properties[1].mortgaged=true;assert.equal(rentFor(s,1),0);
});
test("抵押不增加净资产；按 55% 赎回，不能重复抵押",()=>{
  let s=action(bought(),{type:"mortgage",tileId:1});
  assert.equal(s.players[0].cash,940);assert.equal(netWorth(s,s.players[0]),1000);
  assert.throws(()=>action(s,{type:"mortgage",tileId:1}));
  assert.throws(()=>action(s,{type:"upgrade",tileId:1}));
  s=action(s,{type:"redeem",tileId:1});assert.equal(s.players[0].cash,874);assert.equal(netWorth(s,s.players[0]),994);
});
test("有建筑不可抵押，半价卖房后可以抵押",()=>{
  let s=action(bought(),{type:"upgrade",tileId:1});
  assert.throws(()=>action(s,{type:"mortgage",tileId:1}));
  s=action(s,{type:"sell-building",tileId:1});assert.equal(s.players[0].cash,850);
  assert.equal(netWorth(s,s.players[0]),970);s=action(s,{type:"mortgage",tileId:1});assert.equal(netWorth(s,s.players[0]),970);
});
test("收租在双方之间转移，抵押后不收费",()=>{
  const initial=make();initial.properties[1]={owner:"bot-0",level:3,mortgaged:false};
  let s=action(initial,{type:"roll"});assert.equal(s.players[0].cash,880);assert.equal(s.players[1].cash,1120);
  initial.properties[1].mortgaged=true;s=action(initial,{type:"roll"});assert.equal(s.players[0].cash,1000);
});
test("经过起点只领一次 200",()=>{
  const s=make();s.players[0].position=43;
  const next=action(s,{type:"roll"});assert.equal(next.players[0].position,0);assert.equal(next.players[0].cash,1200);
});
test("税收和奇遇正确增减现金",()=>{
  let s=make();s.players[0].position=10;s=action(s,{type:"roll"});assert.equal(s.players[0].cash,900);
  s=make();s.players[0].position=2;s=action(s,{type:"roll"});assert.equal(s.players[0].cash,1150);
});
test("会议只跳过下一回合",()=>{
  let s=make();s.players[0].position=32;s=action(s,{type:"roll"});assert.equal(s.players[0].skip,true);
  s=action(s,{type:"end-turn"});s=advanceTime(s,NOW+1000,()=>0);
  assert.equal(s.players[0].skip,false);assert.equal(currentPlayer(s).id,"bot-0");
  s=advanceTime(s,NOW+2000,()=>0);assert.equal(currentPlayer(s).id,"human");
});
test("自动偿债先卖房、再卖地，避免重复兑现抵押",()=>{
  const s=make(),p=s.players[0];p.cash=0;s.properties[1]={owner:p.id,level:2,mortgaged:false};s.properties[2].owner=p.id;
  charge(s,p,100,null,NOW);assert.equal(p.cash,20);assert.equal(s.properties[1].owner,null);assert.equal(p.bankrupt,false);
  p.cash=0;s.properties[2].mortgaged=true;charge(s,p,100,"bot-0",NOW);
  assert.equal(p.bankrupt,true);assert.equal(s.players[1].cash,1000);assert.equal(s.properties[2].owner,null);
});
test("最后一位存活玩家获胜",()=>{
  let s=make();s.players[0].cash=0;s.properties[1]={owner:"bot-0",level:3,mortgaged:false};
  s=action(s,{type:"roll"});assert.equal(s.status,"finished");assert.equal(rankings(s)[0].id,"bot-0");
});
test("60 秒托管只行动一次，回来接管不重置计时",()=>{
  const original=make();let s=advanceTime(original,NOW+TURN_MS,()=>0);
  assert.equal(s.players[0].auto,true);assert.equal(s.players[0].position,1);assert.equal(s.turn,2);
  assert.equal(advanceTime(s,NOW+TURN_MS,()=>0),s);
  s=advanceTime(s,NOW+TURN_MS+1000,()=>0);const deadline=s.deadline;
  s=action(s,{type:"takeover"},"human",NOW+TURN_MS+1001);assert.equal(s.players[0].auto,false);assert.equal(s.deadline,deadline);
});
test("15 分钟准时结算、同分并列，计时重复触发不改变状态",()=>{
  const s=advanceTime(make(),NOW+GAME_MS,()=>0);
  assert.equal(s.status,"finished");assert.deepEqual(rankings(s).map(p=>p.rank),[1,1]);
  assert.equal(advanceTime(s,NOW+GAME_MS+1000,()=>0),s);assert.throws(()=>action(s,{type:"roll"}));
});
test("拒绝越权经营、非当前回合和现金不足升级",()=>{
  const s=bought();assert.throws(()=>action(s,{type:"upgrade",tileId:1},"bot-0"));
  assert.throws(()=>action(s,{type:"mortgage",tileId:2}));
  s.players[0].cash=0;assert.throws(()=>action(s,{type:"upgrade",tileId:1}));
});
test("大厅容量上限、开局锁定、房主离开转移",()=>{
  let s=createGame("ABC23D","p0","房主","online",0,NOW);
  for(let i=1;i<4;i++)addPlayer(s,"p"+i,"玩家"+i,false,NOW);
  assert.throws(()=>addPlayer(s,"p4","第五人",false,NOW));
  s=action(s,{type:"leave"},"p0");assert.equal(s.hostId,"p1");
  s=action(s,{type:"start"},"p1");assert.throws(()=>addPlayer(s,"p4","第五人",false,NOW));
});
test("序列化恢复保留时间、资产、席位和托管状态",()=>{
  const before=action(bought(),{type:"upgrade",tileId:1});
  const restored=JSON.parse(JSON.stringify(before)) as GameState;
  assert.deepEqual(action(restored,{type:"end-turn"}),action(before,{type:"end-turn"}));
});
test("旧棋盘移除地产按净值返现，保留抵押净值、建筑和回合，且不重复退款",()=>{
  const legacy=make();legacy.schema=2;
  legacy.properties[4]={owner:"human",level:2,mortgaged:false};
  legacy.properties[15]={owner:"bot-0",level:0,mortgaged:true};
  legacy.properties[26]={owner:null,level:0,mortgaged:false};
  legacy.properties[37]={owner:"human",level:3,mortgaged:false};
  legacy.properties[1]={owner:"human",level:1,mortgaged:false};
  legacy.players[0].position=26;legacy.phase="buy";legacy.pending=26;
  const before=structuredClone(legacy),restored=restoreGame(legacy);
  assert.equal(restored.schema,3);assert.equal(restored.players[0].cash,1990);assert.equal(restored.players[1].cash,1090);
  assert.equal(netWorth(restored,restored.players[0]),2170);assert.equal(netWorth(restored,restored.players[1]),1090);
  assert.equal(Object.keys(restored.properties).length,20);
  assert.deepEqual(restored.properties[1],legacy.properties[1]);
  assert.equal(restored.players[0].position,26);assert.equal(restored.pending,null);assert.equal(restored.phase,"manage");
  assert.equal(restored.deadline,legacy.deadline);assert.equal(restored.endsAt,legacy.endsAt);assert.equal(restored.turn,legacy.turn);
  assert.equal(restored.logs.filter(l=>l.text.includes("按净值返还")).length,3);
  assert.deepEqual(restoreGame(restored),restored);assert.deepEqual(legacy,before);
  assert.equal(action(restored,{type:"end-turn"}).turn,2);
});
test("旧大厅更新初始资金后，新老席位以相同现金开局",()=>{
  const legacy=createGame("ABC23D","human","房主","online",0,NOW);legacy.schema=2;legacy.players[0].cash=1000;
  const s=restoreGame(legacy);addPlayer(s,"guest","访客",false,NOW);
  const started=action(s,{type:"start"});
  assert.deepEqual(started.players.map(p=>p.cash),[2000,2000]);assert.deepEqual(restoreGame(started),started);
});
