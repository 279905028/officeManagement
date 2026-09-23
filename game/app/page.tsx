"use client";
import { useEffect, useRef, useState } from "react";
import { Dice1,Dice2,Dice3,Dice4,Dice5,Dice6,VolumeX,ArrowUpRight,Users,Bot,Coffee,BriefcaseBusiness,CircleHelp,Flag,Copy,Check,House,Landmark,ArrowLeft,LoaderCircle,Clock3,X,ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs,TabsList,TabsTrigger,TabsContent } from "@/components/ui/tabs";
import { Select,SelectTrigger,SelectValue,SelectContent,SelectItem } from "@/components/ui/select";
import { Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose } from "@/components/ui/dialog";
import { BOARD,boardPosition,GROUPS,EVENTS } from "@/shared/board";
import { ITEMS,VEHICLES,vehicleFor } from "@/shared/catalog";
import type { ItemId } from "@/shared/catalog";
import type { Tile } from "@/shared/board";
import { currentPlayer,netWorth,rankings,rentFor,upgradeCost,normalizeName,diceLimit,INITIAL_CASH } from "@/shared/engine";
import type { Action,GameState,Player } from "@/shared/engine";
import { EffectLabels,Inventory,ShopDialog,UseItemDialog } from "@/components/equipment";
import { enterRoom,loadSession,useRoom } from "@/lib/room-client";
import type { SeatSession } from "@/lib/room-client";

const eventTileCount=BOARD.filter(t=>t.kind==="event").length;
const shopTileCount=BOARD.filter(t=>t.kind==="shop").length;
const propertyTileCount=BOARD.filter(t=>t.kind==="property").length;
const money=(n:number)=>"₥ "+n.toLocaleString("zh-CN");
const clock=(ms:number)=>{const seconds=Math.max(0,Math.ceil(ms/1000));return Math.floor(seconds/60).toString().padStart(2,"0")+":"+(seconds%60).toString().padStart(2,"0");};
const DiceIcons=[Dice5,Dice1,Dice2,Dice3,Dice4,Dice5,Dice6];
function Piece({player,small=false}:{player:Player;small?:boolean}) {return <span className={"piece piece-"+player.seat+(small?" piece-small":"")} aria-label={player.name+"，"+(player.seat+1)+"号棋子"}>{player.seat+1}</span>;}
function TileIcon({tile}:{tile:Tile}) {const Icon=tile.kind==="event"?CircleHelp:tile.kind==="shop"?ShoppingBag:tile.kind==="start"?Flag:tile.kind==="rest"?Coffee:BriefcaseBusiness;return <Icon className="tile-icon"/>;}
function BoardTile({tile,state,select}:{tile:Tile;state:GameState|null;select:()=>void}){
  const property=state?.properties[tile.id],owner=state?.players.find(p=>p.id===property?.owner);
  const occupants=state?.players.filter(p=>!p.bankrupt&&p.position===tile.id)??[];
  return <button style={boardPosition(tile.id)} onClick={select} className={"tile tile-"+tile.kind+" group-"+tile.group+(owner?" owned":"")+(property?.mortgaged?" mortgaged":"")}
    aria-label={tile.name+(tile.price?"，地价"+tile.price:"")+(owner?"，属于"+owner.name:"")+(property?.level?"，"+property.level+"级":"")+(property?.mortgaged?"，已抵押":"")}>
    {tile.kind==="property"?<span className="district-line"/>:<TileIcon tile={tile}/>}
    <span className="tile-title">{tile.name}</span><span className="tile-short">{tile.short}</span>
    <span className="tile-value">{property?.mortgaged?"已抵押":property?.level?"ⅠⅡⅢ".slice(0,property.level):tile.price?money(tile.price):tile.kind==="start"?"+200":tile.kind==="tax"?"−100":tile.kind==="meeting"?"休息一回合":tile.kind==="event"?"随机事件":tile.kind==="shop"?"道具 / 出行":"歇口气"}</span>
    {owner&&<span className={"owner-tag owner-"+owner.seat}>{owner.seat+1}</span>}
    {!!occupants.length&&<span className="tile-pieces">{occupants.map(p=><Piece key={p.id} player={p} small/>)}</span>}
  </button>;
}
function Rules({open,setOpen}:{open:boolean;setOpen:(v:boolean)=>void}){
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent showCloseButton={false} className="rules-dialog"><DialogTitle>一局 15 分钟，轻松做地主</DialogTitle><DialogDescription>游戏内的 ₥ 为虚拟游戏币，不涉及真实交易。</DialogDescription><div className="rules-body">
    <h3>出发与落地</h3><p>每人从 {money(INITIAL_CASH)}、换位卡和防护罩开始。{BOARD.length} 格中有 {eventTileCount} 个「？」格和 {shopTileCount} 个商店格。经过发薪日领取 ₥200；缴税处扣 ₥100；会议让你跳过下一回合。{EVENTS.length} 种事件包含现金、移动、道具、集体奖励和临时商店；移动后继续结算落点，最多连续触发 4 次随机事件。</p>
    <h3>道具与互动</h3><p>10 种道具可换位、拿走现金、请客、减速、倒退、邀请开会、拆除建筑、防护、免租或加速。自己的回合掷骰前最多用一件，可选择其他玩家作为目标。防护罩自动抵挡一次负面道具。背包最多 6 件，满包的事件奖励折为 ₥40。</p>
    <h3>商店与交通工具</h3><p>停在商店或遇到快闪商店可购物，每次最多购买 2 件，道具买入后从下个回合开始使用。步行最多 1 枚骰子；自行车 ₥240／2 枚，电动车 ₥480／3 枚，小汽车 ₥760／4 枚，升级补差价。每次可选 1 枚到当前上限；加速卡额外加 1 枚，最多 5 枚。减速优先，倒退经过发薪日不领钱。道具与车辆不计入最终净资产。</p>
    <h3>买地与收租</h3><p>{propertyTileCount} 块地产分为 {GROUPS.length} 组，每组 {propertyTileCount/GROUPS.length} 块。价格分别为 ₥120／180／240／300，基础租金为地价的四分之一。集齐同组，租金翻倍。买地后不必集齐一组即可升级。</p>
    <h3>建房与抵押</h3><p>在自己的回合完成落地操作后，可经营任意自有地产。每地最多 3 级，每级花费地价的 50%，租金再乘以 1＋等级。卖房退回建造费用的 50%。无建筑的地产可按地价 50% 抵押，抵押期间不收租；按地价 55% 赎回。</p>
    <h3>资金与胜负</h3><p>付不起租金或费用时，先自动半价卖房，再半价出售未抵押地产；仍不足则破产。15 分钟后按现金＋地产净值＋建筑投入排名，抵押地产只计半价，同分并列。只剩一位未破产玩家则提前结算。</p>
    <h3>忙起来也没关系</h3><p>每回合最多 60 秒，超时自动托管；回来点“接管”即可，接管不会重置回合时间。电脑买地或建房后至少保留 ₥200。刷新会自动恢复本浏览器的席位；清除浏览器数据后无法恢复。闲置房间保留 24 小时。</p>
  </div><DialogClose asChild><Button>知道了，去玩一局</Button></DialogClose></DialogContent></Dialog>;
}

export default function Home(){
  const [session,setSession]=useState<SeatSession|null>(null),[saved,setSaved]=useState<SeatSession|null>(null);
  const [name,setName]=useState(""),[mode,setMode]=useState("solo"),[joining,setJoining]=useState(false),[code,setCode]=useState(""),[bots,setBots]=useState("3");
  const [entering,setEntering]=useState(false),[entryError,setEntryError]=useState(""),[rules,setRules]=useState(false),[selected,setSelected]=useState<number|null>(null),[copied,setCopied]=useState(false),[now,setNow]=useState(0);
  const room=useRoom(session),s=room.state?.code===session?.code?room.state:null,me=s?.players.find(p=>p.id===session?.playerId),active=s?currentPlayer(s):undefined;
  const isTurn=s?.status==="playing"&&active?.id===me?.id&&!me?.auto&&!me?.bankrupt;
  const ready=room.connection==="online"&&!room.busy;
  const managed=!!isTurn&&s?.phase==="manage"&&ready;
  const tile=selected===null?null:BOARD[selected],property=selected===null?null:s?.properties[selected];
  const owner=s?.players.find(p=>p.id===property?.owner);
  const [shopOpen,setShopOpen]=useState(false),[usingItem,setUsingItem]=useState<ItemId|null>(null),[targetId,setTargetId]=useState(""),[diceChoice,setDiceChoice]=useState("auto");
  const maxDice=me?diceLimit(me):1;
  const chosenDice=diceChoice==="auto"?maxDice:Math.min(Number(diceChoice),maxDice);
  useEffect(()=>{if(isTurn&&s?.phase==="shop")setShopOpen(true);},[isTurn,s?.phase,s?.turn,s?.code]);
  const openItem=(itemId:ItemId)=>{setUsingItem(itemId);setTargetId("");room.setError("");};
  useEffect(()=>{
    const prior=loadSession();setSaved(prior);
    const invite=new URLSearchParams(window.location.search).get("room")?.toUpperCase();
    if(invite){setCode(invite);setJoining(true);setMode("online");if(prior?.code===invite)setSession(prior);}
    else if(prior)setSession(prior);
    try{setName(localStorage.getItem("office-monopoly-name")||"");}catch{/* Browser storage is optional. */}
    setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);
  },[]);
  const createOrJoin=async(kind:"solo"|"online"|"join",nickname=name,roomCode=code,botCount=Number(bots))=>{
    setEntryError("");setEntering(true);
    try{
      const clean=normalizeName(nickname), normalized=roomCode.trim().toUpperCase();
      if(kind==="join"&&!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(normalized))throw new Error("请输入 6 位房间码");
      const next=await enterRoom(clean,kind,botCount,normalized);
      try{localStorage.setItem("office-monopoly-name",clean);}catch{/* Current tab still works. */}
      setSession(next);setSaved(next);setSelected(null);
      window.history.replaceState(null,"","/?room="+next.code);
      return {code:next.code};
    }catch(e){const message=e instanceof Error?e.message:"暂时无法进入房间";setEntryError(message);throw e;}finally{setEntering(false);}
  };
  const act=async(action:Action)=>{
    try{await room.send(action);}catch(e){room.setError(e instanceof Error?e.message:"操作失败");throw e;}
  };
  const clickAction=(action:Action)=>{void act(action).catch(()=>{});};
  const home=async()=>{
    if(s?.status==="lobby"&&room.connection==="online"){
      try{await room.send({type:"leave"});try{localStorage.removeItem("office-monopoly-last");}catch{}setSaved(null);}catch(e){room.setError(e instanceof Error?e.message:"离开失败，请重试");return;}
    }else if(s?.status==="playing"&&me&&!me.auto&&!me.bankrupt&&room.connection==="online"){
      try{await room.send({type:"autoplay"});}catch(e){room.setError(e instanceof Error?e.message:"托管失败，请重试");return;}
    }
    setSession(null);window.history.replaceState(null,"","/");setJoining(false);setCode("");setEntryError("");
  };
  const copyInvite=async()=>{
    if(!s)return;
    try{await navigator.clipboard.writeText(window.location.origin+"/?room="+s.code);setCopied(true);setTimeout(()=>setCopied(false),2500);}
    catch{room.setError("复制失败，请手动分享房间码："+s.code);}
  };
  // WebMCP reuses exactly the same actions and validation as the visible controls.
  const toolsRef=useRef({createOrJoin,act,state:s});toolsRef.current={createOrJoin,act,state:s};
  useEffect(()=>{
    type Tool={name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean};execute:(input:Record<string,unknown>)=>Promise<unknown>};
    const context=(document as Document&{modelContext?:{registerTool:(tool:Tool,options:{signal:AbortSignal})=>unknown}}).modelContext;
    if(!context?.registerTool)return;
    const life=new AbortController();
    const register=(tool:Tool)=>{try{void Promise.resolve(context.registerTool(tool,{signal:life.signal})).catch(()=>{});}catch{/* Unsupported implementation. */}};
    register({name:"read_game",title:"查看对局",description:"读取当前棋盘、公开资产与回合状态。",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>({state:toolsRef.current.state})});
    register({name:"create_game",title:"创建游戏",description:"用昵称创建单人或联机房间并进入游戏。",inputSchema:{type:"object",properties:{name:{type:"string",minLength:1,maxLength:12},mode:{type:"string",enum:["solo","online"]},botCount:{type:"integer",minimum:1,maximum:3}},required:["name","mode"],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{
      if(typeof input.name!=="string"||(input.mode!=="solo"&&input.mode!=="online")||(input.botCount!==undefined&&(!Number.isInteger(input.botCount)||Number(input.botCount)<1||Number(input.botCount)>3)))throw new Error("参数无效");
      const result=await toolsRef.current.createOrJoin(input.mode,input.name,"",Number(input.botCount??3));await new Promise(requestAnimationFrame);return result;
    }});
    register({name:"join_game",title:"加入游戏",description:"通过房间码和昵称加入一个未满且尚未开局的房间。",inputSchema:{type:"object",properties:{name:{type:"string"},code:{type:"string"}},required:["name","code"],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{
      if(typeof input.name!=="string"||typeof input.code!=="string")throw new Error("参数无效");
      const result=await toolsRef.current.createOrJoin("join",input.name,input.code,3);await new Promise(requestAnimationFrame);return result;
    }});
    register({name:"play_action",title:"进行游戏操作",description:"在当前席位掷骰（可选骰子数量）、经营地产、进店购买道具/车辆或在掷骰前用道具选择目标玩家，受与界面相同的回合规则限制。",inputSchema:{type:"object",properties:{type:{type:"string",enum:["start","roll","buy","skip-buy","end-turn","upgrade","sell-building","mortgage","redeem","takeover","autoplay","close-shop","buy-item","use-item","buy-vehicle"]},tileId:{type:"integer",minimum:0,maximum:BOARD.length-1},diceCount:{type:"integer",minimum:1,maximum:5},itemId:{type:"string",enum:ITEMS.map(item=>item.id)},vehicleId:{type:"string",enum:VEHICLES.map(vehicle=>vehicle.id)},targetId:{type:"string"}},required:["type"],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{
      const types=["start","roll","buy","skip-buy","end-turn","upgrade","sell-building","mortgage","redeem","takeover","autoplay","close-shop","buy-item","use-item","buy-vehicle"];
      if(typeof input.type!=="string"||!types.includes(input.type))throw new Error("操作无效");
      if(["upgrade","sell-building","mortgage","redeem"].includes(input.type)&&(!Number.isInteger(input.tileId)||Number(input.tileId)<0||Number(input.tileId)>=BOARD.length))throw new Error("请选择有效地产");
      await toolsRef.current.act(input as Action);await new Promise(requestAnimationFrame);return {state:toolsRef.current.state};
    }});
    return()=>life.abort();
  },[]);
  const serverNow=now+room.offset;
  return <main className="game-shell">
    <header className="masthead"><button className="brand" onClick={()=>{if(session)void home();}} aria-label="工间大富翁，返回首页"><span className="brand-mark"><Dice5 size={23}/></span><span>工间大富翁<small>OFFICE MONOPOLY</small></span></button><div className="header-actions"><span className="quiet"><VolumeX size={15}/>全程静音</span>{session&&<Button variant="ghost" size="sm" disabled={room.busy} onClick={()=>void home()}><ArrowLeft/>首页</Button>}<Button variant="ghost" size="sm" onClick={()=>setRules(true)}><CircleHelp/>玩法</Button></div></header>
    <div className="page-heading quiet-heading"><div><h1>街区总览</h1><span className="eyebrow">{s?"房间 "+s.code+" · "+(s.status==="lobby"?"等待入席":s.status==="finished"?"已结算":"第 "+s.turn+" 回合"):BOARD.length+" 个地点 · "+GROUPS.length+" 个街区"}</span></div>{s?.status==="playing"&&<div className="game-countdown"><Clock3 size={17}/><span>剩余时间</span><strong>{clock(s.endsAt-serverNow)}</strong></div>}</div>
    {session&&room.connection!=="online"&&<div className="connection-banner" role="status"><span>{room.connection==="blocked"?"连接需要恢复":"正在连接房间，请稍候…"}</span><Button variant="outline" size="sm" onClick={room.reconnect}>重新连接</Button></div>}
    {session&&room.error&&<div className="error-banner" role="alert">{room.error}<button aria-label="关闭提示" onClick={()=>room.setError("")}><X size={16}/></button></div>}
    <div className="play-layout"><section className="board-section"><div className="board-topline"><span><span className="tiny-square"/>{s?"房间 "+s.code:"工间街区"}</span><span>{s?(s.mode==="solo"?"单人对电脑":"朋友联机")+" · "+s.players.length+"/4 人":eventTileCount+" 个？格 · "+shopTileCount+" 个商店"}</span></div>
      <div className={"board"+(s?.status==="playing"?" board-playing":"")}>{BOARD.map(t=><BoardTile key={t.id} tile={t} state={s} select={()=>setSelected(t.id)}/>)}
      <div className="board-center">
      {!s?null:
      s.status==="lobby"?<><span className="center-status">等待成员入席</span><p>把房间码或邀请链接发给朋友</p><strong className="room-code">{s.code}</strong><Button variant="outline" className="copy-button" onClick={()=>void copyInvite()}>{copied?<Check/>:<Copy/>}{copied?"已复制邀请链接":"复制邀请链接"}</Button><div className="lobby-seats">{[0,1,2,3].map(n=>{const p=s.players.find(p=>p.seat===n);return <div key={n}>{p?<Piece player={p}/>:<span className="empty-seat">{n+1}</span>}<span>{p?p.name:"空位"}</span></div>;})}</div>{s.hostId===me?.id?<Button className="start-button" disabled={s.players.length<2||!ready} onClick={()=>clickAction({type:"start"})}>开始游戏 · {s.players.length} 人</Button>:<span className="waiting-note">等待房主开始游戏</span>}</>:
      s.status==="finished"?<><span className="center-status">本局结果</span><strong className="winner-name">{rankings(s).filter(p=>p.rank===1).map(p=>p.name).join("、")}</strong><p>{s.finishReason} · 净资产 {money(rankings(s)[0].netWorth)}</p><Button variant="outline" onClick={()=>void home()}>返回首页</Button></>:
      <><div className="turn-name">{active&&<Piece player={active}/>}<span>{isTurn?"当前由你操作":active?.name+"的回合"}</span></div><div className={"dice-strip"+(room.busy?" dice-pending":"")} aria-label={s.diceValues.length?"骰子结果："+s.diceValues.join("、")+"，合计 "+s.dice+" 点":"等待掷骰"}>{(s.diceValues.length?s.diceValues:[0]).map((value,i)=>{const Dice=DiceIcons[value]??Dice5;return <span className="dice-small" key={i}><Dice strokeWidth={1.4}/></span>;})}</div><div className="turn-caption">{s.dice?s.diceValues.join(" + ")+" = "+s.dice+" 点 · "+BOARD[active?.position??0].name:active?.auto?"正在自动托管…":active?vehicleFor(active.vehicle).name+" · 最多 "+diceLimit(active)+" 枚骰子":""}</div>
        <div className="turn-actions">{me?.bankrupt?<p>本局已破产，可以继续观看。</p>:me?.auto?<Button disabled={!ready} onClick={()=>clickAction({type:"takeover"})}>接管我的席位</Button>:isTurn?s.phase==="roll"?<><div className="roll-controls"><Select value={String(chosenDice)} onValueChange={setDiceChoice}><SelectTrigger aria-label="骰子数量" disabled={!ready}><SelectValue/></SelectTrigger><SelectContent>{Array.from({length:maxDice},(_,i)=><SelectItem key={i+1} value={String(i+1)}>{i+1} 枚骰子</SelectItem>)}</SelectContent></Select><Button disabled={!ready} onClick={()=>clickAction({type:"roll",diceCount:chosenDice})}>掷骰</Button></div><span className="purchase-question">{s.itemUsed?"本回合道具已使用":"掷骰前可在背包使用道具"}</span></>:s.phase==="buy"?<><span className="purchase-question">购入「{BOARD[s.pending!].name}」？</span><div className="buy-actions"><Button disabled={!ready||(me?.cash??0)<BOARD[s.pending!].price} onClick={()=>clickAction({type:"buy"})}>{money(BOARD[s.pending!].price)} · 买下</Button><Button variant="outline" disabled={!ready} onClick={()=>clickAction({type:"skip-buy"})}>跳过</Button></div>{(me?.cash??0)<BOARD[s.pending!].price&&<small>现金不足，可跳过购买</small>}</>:s.phase==="shop"?<><span className="purchase-question">已到商店 · 本次购买 {s.shopPurchases} / 2 件</span><div className="buy-actions"><Button disabled={!ready} onClick={()=>setShopOpen(true)}><ShoppingBag/>进入商店</Button><Button variant="outline" disabled={!ready} onClick={()=>clickAction({type:"close-shop"})}>离开商店</Button></div></>:<><span className="purchase-question">可点击自己的地产建房或抵押</span><Button disabled={!ready} onClick={()=>clickAction({type:"end-turn"})}>结束回合<ArrowUpRight/></Button></>:<p>{active?.auto?"电脑正在经营街区":"等待对方完成操作"}</p>}</div>
        <div className="turn-time"><Clock3 size={13}/>{active?.auto?"自动托管中":Math.min(60,Math.max(0,Math.ceil((s.deadline-serverNow)/1000)))+" 秒后自动托管"}</div>
      </>}
      </div></div><div className="board-caption"><span>{s?"点击地块查看详情和经营操作。":"从右下角出发，顺时针探索街区。"}</span><div>{GROUPS.map((g,i)=><span key={g} className={"legend group-"+i}><i/>{g}</span>)}</div></div>
      {s&&<p className="last-event" aria-live="polite">{s.logs.at(-1)?.text}</p>}
    </section>
    <aside className="control-column">
      {!session?<><section className="entry-card"><span className="eyebrow">准备好出发了吗</span><h2>开启一段小旅程</h2><p className="muted">无需注册，取个昵称就能玩。</p><form onSubmit={e=>{e.preventDefault();void createOrJoin(joining?"join":mode as "solo"|"online").catch(()=>{});}}><label htmlFor="nickname">你的昵称</label><Input id="nickname" value={name} onChange={e=>setName(e.target.value)} placeholder="今天怎么称呼你" maxLength={24} autoComplete="nickname" required/>
        <Tabs value={mode} onValueChange={v=>{setMode(v);setJoining(false);}}><TabsList className="mode-options"><TabsTrigger value="solo"><Bot/><strong>单人游戏</strong><small>和电脑过过招</small></TabsTrigger><TabsTrigger value="online"><Users/><strong>朋友联机</strong><small>2–4 人一起玩</small></TabsTrigger></TabsList></Tabs>
        {mode==="solo"?<div className="bot-select"><label htmlFor="bot-count">电脑对手</label><Select value={bots} onValueChange={setBots}><SelectTrigger id="bot-count"><SelectValue/></SelectTrigger><SelectContent>{[1,2,3].map(n=><SelectItem key={n} value={String(n)}>{n} 位电脑</SelectItem>)}</SelectContent></Select></div>:joining?<div className="join-input"><label htmlFor="room-code">房间码</label><Input id="room-code" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="例如 AB3K7R" maxLength={6} autoComplete="off" required/></div>:<p className="mode-hint">创建房间后，分享链接邀请朋友。</p>}
        {entryError&&<p className="entry-error" role="alert">{entryError}</p>}<Button type="submit" className="primary-action" disabled={entering}>{entering?<><LoaderCircle className="spin"/>正在进入…</>:<>{joining?"加入朋友的房间":mode==="solo"?"开始单人游戏":"创建房间"}<ArrowUpRight/></>}</Button></form>
        <Button variant="ghost" className="join-link" disabled={entering} onClick={()=>{setMode("online");setJoining(v=>!v);}}>{joining?"想开新局？创建房间":"已有房间码？加入朋友"}</Button>
        {saved&&<Button variant="outline" className="resume-button" onClick={()=>{setSession(saved);window.history.replaceState(null,"","/?room="+saved.code);}}>继续上次对局 · {saved.code}</Button>}
      </section><section className="note-card"><Coffee size={20}/><div><strong>一局刚好，一点放松。</strong><p>全程静音 · 15 分钟一局<br/>忙起来也没关系，超时自动托管。</p></div></section><div className="starting-capital"><span>每位玩家的启动资金</span><strong>{money(INITIAL_CASH)}</strong><small>每经过发薪日，再领 ₥ 200</small></div></>:
      !s?<section className="entry-card"><LoaderCircle className="spin"/><h2>正在找回你的棋子</h2><p className="muted">连接成功后，棋盘会自动同步。</p><Button variant="outline" onClick={()=>void home()}>返回首页</Button></section>:
      <><section className="players-card"><div className="section-title"><h2>{s.status==="finished"?"本局成绩":"这一局的玩家"}</h2><span>{s.players.length} / 4</span></div>{(s.status==="finished"?rankings(s):s.players).map(p=><div key={p.id} className={"player-row"+(active?.id===p.id&&s.status==="playing"?" active-player":"")+(p.bankrupt?" bankrupt-player":"")}><Piece player={p}/><div className="player-info"><strong>{p.name}{p.id===me?.id&&<small>你</small>}</strong><span>{p.bankrupt?"已破产":p.bot?"电脑对手":p.auto?"自动托管":room.onlineIds.includes(p.id)?"在线":"暂时离线"} · {vehicleFor(p.vehicle).name}</span><EffectLabels player={p}/></div><div className="player-money"><strong>{money(p.cash)}</strong><span>净资产 {money(netWorth(s,p))}</span></div></div>)}
      {me&&s.status==="playing"&&!me.bankrupt&&<Button variant="outline" size="sm" className="auto-button" disabled={!ready} onClick={()=>clickAction({type:me.auto?"takeover":"autoplay"})}><Bot/>{me.auto?"接管我的席位":"暂时离开，开启托管"}</Button>}
      {s.mode==="online"&&s.status==="lobby"&&<Button variant="outline" className="invite-side" onClick={()=>void copyInvite()}>{copied?<Check/>:<Copy/>}复制邀请链接</Button>}</section>
      <section className="details-card"><Tabs defaultValue="assets"><TabsList className="detail-tabs"><TabsTrigger value="assets">地产</TabsTrigger><TabsTrigger value="items">背包 {me?.items.length??0}</TabsTrigger><TabsTrigger value="log">动态</TabsTrigger></TabsList><TabsContent value="assets"><div className="asset-list">{BOARD.filter(t=>!!me&&t.kind==="property"&&s.properties[t.id]?.owner===me.id).map(t=><button key={t.id} className={"asset-row group-"+t.group} onClick={()=>setSelected(t.id)}><span className="asset-line"/><div><strong>{t.name}</strong><span>{s.properties[t.id].mortgaged?"已抵押":s.properties[t.id].level?"建筑 "+s.properties[t.id].level+" 级":"空地"} · 租金 {money(rentFor(s,t.id))}</span></div><ArrowUpRight size={16}/></button>)}{!BOARD.some(t=>!!me&&t.kind==="property"&&s.properties[t.id]?.owner===me.id)&&<div className="empty-assets"><House/><strong>第一块地，等你落脚。</strong><span>走到空地即可购买。</span></div>}</div></TabsContent><TabsContent value="items">{me&&<Inventory state={s} player={me} onUse={openItem}/>}</TabsContent><TabsContent value="log"><ol className="game-log">{s.logs.slice().reverse().map(e=><li key={e.id}><time>{new Date(e.at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}</time><span>{e.text}</span></li>)}</ol></TabsContent></Tabs></section></>}
    </aside></div>
    <footer><span>工间大富翁</span><span>小小棋盘，自在一局。</span><span>最多 4 人 · 不含内购</span></footer>
    <Rules open={rules} setOpen={setRules}/>
    <Dialog open={selected!==null} onOpenChange={open=>{if(!open)setSelected(null);}}><DialogContent showCloseButton={false} className="property-dialog"><DialogClose asChild><Button variant="ghost" size="icon" className="dialog-x" aria-label="关闭详情"><X/></Button></DialogClose><DialogTitle>{tile?.name}</DialogTitle><DialogDescription>{tile?.kind==="property"?GROUPS[tile.group!]:"街区特别地点"}</DialogDescription>
      {tile?.kind==="property"?<><div className="property-summary"><div><span>地价</span><strong>{money(tile.price)}</strong></div><div><span>{owner?"当前租金":"基础租金"}</span><strong>{money(s?rentFor(s,tile.id)||(!owner?tile.price/4:0):tile.price/4)}</strong></div><div><span>建筑</span><strong>{property?.level??0} / 3 级</strong></div></div><p className="ownership">{owner?"持有人："+owner.name+" · "+(property?.mortgaged?"已抵押":"未抵押"):"还没有人买下这里"}</p>
        {owner?.id===me?.id&&me&&property?<><div className="property-actions"><Button disabled={!managed||property.mortgaged||property.level>=3||me.cash<upgradeCost(tile.id)} onClick={()=>clickAction({type:"upgrade",tileId:tile.id})}><House/>升级 −{money(upgradeCost(tile.id))}</Button><Button variant="outline" disabled={!managed||property.level<=0} onClick={()=>clickAction({type:"sell-building",tileId:tile.id})}>卖一层 +{money(upgradeCost(tile.id)/2)}</Button>{property.mortgaged?<Button variant="outline" disabled={!managed||me.cash<Math.round(tile.price*.55)} onClick={()=>clickAction({type:"redeem",tileId:tile.id})}><Landmark/>赎回 −{money(Math.round(tile.price*.55))}</Button>:<Button variant="outline" disabled={!managed||property.level>0} onClick={()=>clickAction({type:"mortgage",tileId:tile.id})}><Landmark/>抵押 +{money(tile.price/2)}</Button>}</div><p className="property-hint">{!managed?"在你的回合完成落地操作后，才能经营地产。":property.level>0?"抵押前需先卖完建筑。":"买到即可建房，不必集齐一组。"}</p></>:<p className="property-hint">每级建房 {money(tile.price/2)}，最多 3 级。集齐同组 {BOARD.filter(t=>t.kind==="property"&&t.group===tile.group).length} 块地，租金额外翻倍。</p>}</>:<p className="special-description">{tile?.kind==="start"?"每经过一次发薪日领取 ₥200，落在这里不会重复领取。":tile?.kind==="tax"?"缴纳 ₥100 税费。现金不足会自动变卖资产偿债。":tile?.kind==="meeting"?"开会休息一下，跳过你的下一回合。":tile?.kind==="event"?"随机触发 "+EVENTS.length+" 种事件之一：现金变化、前进倒退、获得道具、玩家互动、集体奖励或快闪商店。移动后继续结算新落点。":tile?.kind==="shop"?"停在这里可购买 10 种互动道具，或补差价升级交通工具；每次进店最多买 2 件。":"平静的一站，不收费用，也不跳过回合。"}</p>}
      {tile?.kind==="shop"&&s&&me&&<Button variant="outline" onClick={()=>{setSelected(null);setShopOpen(true);}}>查看商店商品</Button>}
      {room.error&&<p className="entry-error" role="alert">{room.error}</p>}
    </DialogContent></Dialog>
    {s&&me&&<><ShopDialog state={s} player={me} ready={ready} open={shopOpen} onOpenChange={setShopOpen} onAction={act} error={room.error}/><UseItemDialog state={s} player={me} ready={ready} itemId={usingItem} targetId={targetId} onTargetChange={setTargetId} onClose={()=>setUsingItem(null)} onAction={act} error={room.error}/></>}
  </main>;
}
