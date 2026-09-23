"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, GameState } from "@/shared/engine";

export const PRODUCTION_ROOM_API = "https://office-monopoly-room.279905028qq.workers.dev";
export function roomApi() {
  if (typeof window !== "undefined" && ["localhost","127.0.0.1"].includes(window.location.hostname)) return "http://localhost:8787";
  if (!PRODUCTION_ROOM_API) throw new Error("联机服务尚未部署");
  return PRODUCTION_ROOM_API;
}
export interface SeatSession { code: string; playerId: string; token: string }
export function loadSession(): SeatSession | null {
  try { const raw=localStorage.getItem("office-monopoly-last"); if(!raw)return null; const s=JSON.parse(raw); return typeof s.code==="string"&&typeof s.playerId==="string"&&typeof s.token==="string"?s:null; } catch { return null; }
}
export function storeSession(session: SeatSession) {
  try { localStorage.setItem("office-monopoly-last",JSON.stringify(session));localStorage.setItem("office-monopoly-seat:"+session.code,session.token); } catch { /* Current tab remains playable when browser storage is unavailable. */ }
}
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join(""); }
export async function enterRoom(name: string, mode: "solo"|"online"|"join", botCount=3, code=""): Promise<SeatSession> {
  let token=randomToken();
  if(mode==="join") {try {token=localStorage.getItem("office-monopoly-seat:"+code)||token;}catch{/* No browser storage. */}}
  const url=roomApi()+(mode==="join"?"/api/rooms/"+code+"/join":"/api/rooms");
  let response:Response;
  try {response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,mode:mode==="join"?"online":mode,botCount,token}),signal:AbortSignal.timeout(12_000)});}
  catch {throw new Error("暂时连接不上游戏服务，请检查网络后重试。");}
  const result=await response.json() as {error?:string;code?:string;playerId?:string};
  if(!response.ok)throw new Error(result.error||"无法进入房间");
  if(typeof result.code!=="string"||typeof result.playerId!=="string")throw new Error("服务返回的数据无效，请重试");
  const session={code:result.code,playerId:result.playerId,token};
  storeSession(session); return session;
}
interface Packet { type:string; state?:GameState; onlineIds?:string[]; serverNow?:number; commandId?:string; error?:string; code?:string }
type Pending = { packet: {type:"command";commandId:string;expectedVersion:number;action:Action}; retries:number; resolve:()=>void; reject:(error:Error)=>void; timer:ReturnType<typeof setTimeout> };
export function useRoom(session: SeatSession|null) {
  const [state,setState]=useState<GameState|null>(null), [onlineIds,setOnlineIds]=useState<string[]>([]);
  const [connection,setConnection]=useState<"offline"|"connecting"|"online"|"blocked">("offline");
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[offset,setOffset]=useState(0),[retryKey,setRetryKey]=useState(0);
  const stateRef=useRef<GameState|null>(null),socketRef=useRef<WebSocket|null>(null),pendingRef=useRef<Pending|null>(null);
  useEffect(()=>{
    stateRef.current=null;setState(null);setOnlineIds([]);setError("");
    if(!session){setConnection("offline");return;}
    let disposed=false,attempt=0,reconnect:ReturnType<typeof setTimeout>|undefined,ping:ReturnType<typeof setInterval>|undefined;
    let lastMessage=Date.now();
    const connect=()=>{
      if(disposed)return;
      setConnection("connecting");
      const ws=new WebSocket(roomApi().replace(/^http/,"ws")+"/api/rooms/"+session.code+"/ws");
      socketRef.current=ws;
      ws.onopen=()=>{lastMessage=Date.now();ws.send(JSON.stringify({type:"auth",token:session.token}));};
      ws.onmessage=event=>{
        lastMessage=Date.now();
        if(event.data==="pong")return;
        let data:Packet;try{data=JSON.parse(event.data);}catch{return;}
        if(disposed)return;
        if(data.state&&(!stateRef.current||data.state.version>=stateRef.current.version)){
          stateRef.current=data.state;setState(data.state);
          setOnlineIds(data.onlineIds??[]);
          if(data.serverNow)setOffset(data.serverNow-Date.now());
          setConnection("online");attempt=0;
        }
        const pending=pendingRef.current;
        if(data.type==="ack"&&pending&&data.commandId===pending.packet.commandId){
          clearTimeout(pending.timer);pendingRef.current=null;setBusy(false);setError("");pending.resolve();
        }else if(data.type==="error"){
          if(data.code==="STALE_STATE"&&pending&&pending.retries<1&&data.state){
            pending.retries++;pending.packet.expectedVersion=data.state.version;ws.send(JSON.stringify(pending.packet));return;
          }
          const message=data.error||"操作未完成";setError(message);
          if(pending){clearTimeout(pending.timer);pendingRef.current=null;setBusy(false);pending.reject(new Error(message));}
        }
      };
      ws.onclose=event=>{
        if(disposed)return;
        if([4001,4003,4004].includes(event.code)){
          setConnection("blocked");setError(event.code===4001?"你的席位已在另一窗口打开。可点击重新连接接回。":event.code===4004?"房间已过期，请返回首页开启新局。":"席位验证失败，请返回首页重新加入。");return;
        }
        setConnection("connecting");reconnect=setTimeout(connect,Math.min(1000*2**attempt++,10_000));
      };
      ws.onerror=()=>{if(!disposed)setError("连接暂时中断，正在尝试恢复…");};
    };
    try{connect();}catch(e){setConnection("blocked");setError(e instanceof Error?e.message:"连接失败");}
    ping=setInterval(()=>{
      const ws=socketRef.current;
      if(ws?.readyState===WebSocket.OPEN){if(Date.now()-lastMessage>55_000)ws.close();else ws.send("ping");}
    },20_000);
    const visible=()=>{if(document.visibilityState==="visible"&&Date.now()-lastMessage>55_000)socketRef.current?.close();};
    document.addEventListener("visibilitychange",visible);
    return ()=>{
      disposed=true;clearTimeout(reconnect);clearInterval(ping);document.removeEventListener("visibilitychange",visible);
      socketRef.current?.close();socketRef.current=null;
      const pending=pendingRef.current;if(pending){clearTimeout(pending.timer);pending.reject(new Error("已离开当前房间"));pendingRef.current=null;}
      setBusy(false);
    };
  },[session?.code,session?.token,retryKey]);
  const send=useCallback((action:Action):Promise<void>=>{
    const ws=socketRef.current,s=stateRef.current;
    if(!s||ws?.readyState!==WebSocket.OPEN)return Promise.reject(new Error("请等待连接恢复"));
    if(pendingRef.current)return Promise.reject(new Error("上一操作正在确认"));
    setBusy(true);setError("");
    return new Promise((resolve,reject)=>{
      const packet={type:"command" as const,commandId:crypto.randomUUID(),expectedVersion:s.version,action};
      const timer=setTimeout(()=>{
        if(pendingRef.current?.packet.commandId!==packet.commandId)return;
        pendingRef.current=null;setBusy(false);setError("操作确认超时，正在同步棋盘；请查看最新状态后重试。");ws.close();reject(new Error("操作确认超时"));
      },10_000);
      pendingRef.current={packet,retries:0,resolve,reject,timer};
      ws.send(JSON.stringify(packet));
    });
  },[]);
  return {state,onlineIds,connection,error,setError,busy,offset,send,reconnect:()=>setRetryKey(n=>n+1)};
}
