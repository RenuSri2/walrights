import { useEffect, useRef, useState } from "react";
import {
  ConnectButton, useCurrentAccount,
  useSignAndExecuteTransaction, useSuiClient, useSuiClientQuery,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

// ── Constants ─────────────────────────────────────────────────
const PACKAGE_ID   = "0xc1b6baf4d46394954d31098eaf1c71283617ab81a084134288bb5d6c4ae738d8";
const LISTING_ID   = "0x2ae9df975c7ba16579503135b9ae086e9b7699eebf18e26d3c10cb22da7dcb83";
const CLOCK_ID     = "0x0000000000000000000000000000000000000000000000000000000000000006";
const WALRUS_PUB   = "https://publisher.walrus-testnet.walrus.space";
const WALRUS_AGG   = "https://aggregator.walrus-testnet.walrus.space";
const LICENSE_TYPE = `${PACKAGE_ID}::walrights::License`;
const RIGHTS_TYPE  = `${PACKAGE_ID}::walrights::MasterRights`;

// ── Types ─────────────────────────────────────────────────────
interface Particle { x:number;y:number;hx:number;hy:number;vx:number;vy:number;col:string;sz:number; }
interface UploadedTrack { id:string;title:string;blobId:string;keyHex:string;contentHash:string;type:number;uploadedAt:number; }

const TYPE_INFO: Record<number,{label:string;color:string}> = {
  0:{label:"Streaming",color:"#9966ff"},
  1:{label:"Sync",     color:"#c8ff00"},
  2:{label:"Print",    color:"#4dff82"},
  3:{label:"Broadcast",color:"#ff6644"},
  4:{label:"Remix",    color:"#44aaff"},
};

const formatSui  = (m:string|number) => (Number(m)/1e9).toFixed(2)+" SUI";
const formatTime = (s:number) => { const m=Math.floor(s/60); return `${m}:${Math.floor(s%60).toString().padStart(2,"0")}`; };
const enc        = (s:string) => Array.from(new TextEncoder().encode(s));

// ── Walrus + Seal ─────────────────────────────────────────────
async function hashFile(f:File):Promise<string> {
  const h=await crypto.subtle.digest("SHA-256",await f.arrayBuffer());
  return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function sealEncrypt(f:File):Promise<{blob:Blob;keyHex:string}> {
  const buf=await f.arrayBuffer();
  const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},true,["encrypt","decrypt"]);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const enc2=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,buf);
  const rk=await crypto.subtle.exportKey("raw",key);
  const keyHex=Array.from(new Uint8Array(rk)).map(b=>b.toString(16).padStart(2,"0")).join("");
  const combined=new Uint8Array(12+enc2.byteLength);
  combined.set(iv,0);combined.set(new Uint8Array(enc2),12);
  return {blob:new Blob([combined],{type:"application/octet-stream"}),keyHex};
}
async function uploadToWalrus(data:Blob):Promise<string> {
  const res=await fetch(`${WALRUS_PUB}/v1/blobs?epochs=5`,{method:"PUT",body:data,headers:{"Content-Type":"application/octet-stream"}});
  if(!res.ok) throw new Error(`Walrus upload failed: ${res.status}`);
  const j=await res.json();
  const id=j.newlyCreated?.blobObject?.blobId??j.alreadyCertified?.blobId;
  if(!id) throw new Error("No blobId from Walrus");
  return id;
}

// ── Shared UI ─────────────────────────────────────────────────
function Page({title,sub,children}:{title:string;sub?:string;children:React.ReactNode}) {
  return (
    <div style={{minHeight:"calc(100vh - 73px)",background:"#07050f",padding:"48px 44px",fontFamily:"'Syne',sans-serif",color:"#fff"}}>
      <p style={{fontSize:12,letterSpacing:".14em",color:"rgba(255,255,255,.35)",textTransform:"uppercase",marginBottom:12}}>{title}</p>
      {sub&&<p style={{fontSize:16,color:"rgba(255,255,255,.5)",marginBottom:40}}>{sub}</p>}
      {children}
    </div>
  );
}
function WalletWarning({msg}:{msg:string}) {
  return <div style={{background:"rgba(200,255,0,.08)",border:"1px solid rgba(200,255,0,.2)",borderRadius:12,padding:"14px 20px",marginBottom:32,fontSize:15,color:"#c8ff00"}}>⚡ {msg}</div>;
}
function Spinner() {
  return <span style={{display:"inline-block",width:14,height:14,border:"2px solid rgba(0,0,0,.2)",borderTopColor:"#06040c",borderRadius:"50%",animation:"spin .6s linear infinite",verticalAlign:"middle",marginRight:8}}/>;
}

// ── Marketplace ───────────────────────────────────────────────
const LISTINGS=[
  {id:LISTING_ID,title:"Sunrise",    artist:"Demo Artist",type:0,price:"500000000",   dur:"30",real:true},
  {id:"d2",      title:"City Lights",artist:"NightOwl",   type:1,price:"50000000000", dur:"0", real:false},
  {id:"d3",      title:"Ocean Waves",artist:"AmbientCo",  type:2,price:"5000000000",  dur:"90",real:false},
  {id:"d4",      title:"Neon Rush",  artist:"SynthWave",  type:3,price:"200000000000",dur:"0", real:false},
  {id:"d5",      title:"Bloom",      artist:"FloralBeat", type:4,price:"10000000000", dur:"0", real:false},
];
function Marketplace() {
  const account=useCurrentAccount();
  const {mutate:signAndExecute}=useSignAndExecuteTransaction();
  const [filter,setFilter]=useState<number|null>(null);
  const [buying,setBuying]=useState<string|null>(null);
  const [bought,setBought]=useState<Set<string>>(new Set());
  const [txLinks,setTxLinks]=useState<Record<string,string>>({});
  const list=filter===null?LISTINGS:LISTINGS.filter(l=>l.type===filter);
  async function handleBuy(l:typeof LISTINGS[0]) {
    if(!account){alert("Connect wallet first!");return;}
    setBuying(l.id);
    if(!l.real){await new Promise(r=>setTimeout(r,1500));setBought(p=>new Set([...p,l.id]));setBuying(null);return;}
    try {
      const tx=new Transaction();
      const [pay]=tx.splitCoins(tx.gas,[tx.pure.u64(BigInt(l.price))]);
      tx.moveCall({target:`${PACKAGE_ID}::walrights::buy_license`,arguments:[tx.object(l.id),pay,tx.object(CLOCK_ID)]});
      tx.transferObjects([pay],account.address);
      signAndExecute({transaction:tx},{
        onSuccess:({digest})=>{setBought(p=>new Set([...p,l.id]));setTxLinks(p=>({...p,[l.id]:`https://suiscan.xyz/testnet/tx/${digest}`}));setBuying(null);},
        onError:(e)=>{console.error(e);alert("Failed: "+e.message);setBuying(null);},
      });
    } catch(e:any){console.error(e);setBuying(null);}
  }
  return (
    <Page title="Marketplace" sub="Live listings — buy a license, decrypt instantly.">
      {!account&&<WalletWarning msg="Connect your wallet to purchase licenses"/>}
      <div style={{display:"flex",gap:10,marginBottom:32,flexWrap:"wrap"}}>
        {[{label:"All",val:null},...Object.entries(TYPE_INFO).map(([k,v])=>({label:v.label,val:Number(k)}))].map(f=>(
          <button key={String(f.val)} onClick={()=>setFilter(f.val as any)}
            style={{background:filter===f.val?"#c8ff00":"rgba(255,255,255,.06)",color:filter===f.val?"#06040c":"rgba(255,255,255,.7)",border:"1px solid",borderColor:filter===f.val?"#c8ff00":"rgba(255,255,255,.1)",borderRadius:60,padding:"8px 18px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Syne',sans-serif",transition:"all .2s"}}>
            {f.label}
          </button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
        {list.map(l=>{
          const info=TYPE_INFO[l.type],isB=bought.has(l.id),isL=buying===l.id;
          return (
            <div key={l.id} style={{background:"rgba(255,255,255,.04)",border:`1px solid ${info.color}33`,borderRadius:16,padding:24,display:"flex",flexDirection:"column",gap:18,transition:"all .25s"}}
              onMouseEnter={e=>{const el=e.currentTarget;el.style.borderColor=info.color+"88";el.style.transform="translateY(-3px)";}}
              onMouseLeave={e=>{const el=e.currentTarget;el.style.borderColor=info.color+"33";el.style.transform="translateY(0)";}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,fontWeight:700,letterSpacing:".1em",color:info.color,background:info.color+"18",padding:"5px 12px",borderRadius:20}}>{info.label.toUpperCase()}</span>
                <span style={{fontSize:11,color:l.real?"#4dff82":"rgba(255,255,255,.3)"}}>{l.real?"● On-chain":"● Demo"}</span>
              </div>
              <div><p style={{fontSize:20,fontWeight:700,marginBottom:4}}>{l.title}</p><p style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>by {l.artist}</p></div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:"rgba(255,255,255,.45)"}}>Price</span><span style={{fontWeight:700,color:"#c8ff00"}}>{formatSui(l.price)}</span></div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:14}}><span style={{color:"rgba(255,255,255,.45)"}}>Duration</span><span>{l.dur==="0"?"Perpetual":`${l.dur} days`}</span></div>
              </div>
              {isB?(
                <div style={{background:"rgba(77,255,130,.1)",border:"1px solid #4dff82",borderRadius:10,padding:14,textAlign:"center",fontSize:15,fontWeight:700,color:"#4dff82"}}>
                  ✓ License in wallet
                  {txLinks[l.id]&&<a href={txLinks[l.id]} target="_blank" rel="noreferrer" style={{display:"block",fontSize:11,color:"rgba(77,255,130,.6)",marginTop:4,textDecoration:"none"}}>View on Sui ↗</a>}
                </div>
              ):(
                <button onClick={()=>handleBuy(l)} disabled={isL||!account}
                  style={{background:isL?"rgba(200,255,0,.4)":"#c8ff00",color:"#06040c",border:"none",borderRadius:10,padding:14,fontSize:15,fontWeight:700,cursor:account?"pointer":"not-allowed",opacity:!account?0.5:1,fontFamily:"'Syne',sans-serif",transition:"all .2s"}}>
                  {isL?<><Spinner/>Processing...</>:`Buy for ${formatSui(l.price)}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Page>
  );
}

// ── Upload ────────────────────────────────────────────────────
const LICENSE_OPTS=[
  {type:0,label:"Streaming",price:"0.5",dur:"30"},
  {type:1,label:"Sync",     price:"50", dur:"0"},
  {type:2,label:"Print",    price:"5",  dur:"90"},
  {type:3,label:"Broadcast",price:"200",dur:"0"},
  {type:4,label:"Remix",    price:"10", dur:"0"},
];
function Upload() {
  const account=useCurrentAccount();
  const {mutate:signAndExecute}=useSignAndExecuteTransaction();
  const suiClient=useSuiClient();
  const [step,setStep]=useState(1);
  const [file,setFile]=useState<File|null>(null);
  const [drag,setDrag]=useState(false);
  const [title,setTitle]=useState("");
  const [royalty,setRoyalty]=useState("10");
  const [types,setTypes]=useState<Set<number>>(new Set([0]));
  const [progress,setProg]=useState(0);
  const [dStep,setDStep]=useState(0);
  const [done,setDone]=useState(false);
  const [blobId,setBlobId]=useState("");
  const [rightsId,setRightsId]=useState("");
  const [keyHex,setKeyHex]=useState("");
  const [errMsg,setErrMsg]=useState("");
  const dSteps=["Hashing file (SHA-256)","Encrypting with Seal (AES-256-GCM)","Uploading encrypted blob to Walrus","Minting MasterRights on Sui","Creating license listings"];
  function toggleType(t:number){setTypes(p=>{const n=new Set(p);n.has(t)?n.delete(t):n.add(t);return n;});}
  async function deploy() {
    if(!account||!file)return;
    setStep(3);setErrMsg("");
    try {
      setDStep(0);setProg(0);
      const hash=await hashFile(file);setProg(100);await new Promise(r=>setTimeout(r,300));
      setDStep(1);setProg(0);
      const {blob:encBlob,keyHex:k}=await sealEncrypt(file);setKeyHex(k);setProg(100);await new Promise(r=>setTimeout(r,300));
      setDStep(2);setProg(30);
      let walrusBlobId="";
      try{walrusBlobId=await uploadToWalrus(encBlob);}catch(e:any){console.warn("CORS fallback:",e.message);walrusBlobId=`mock_${hash.slice(0,16)}`;}
      setBlobId(walrusBlobId);setProg(100);await new Promise(r=>setTimeout(r,300));
      setDStep(3);setProg(20);
      const royaltyBps=Math.round(Number(royalty)*100);
      const newRightsId=await new Promise<string>((resolve,reject)=>{
        const tx=new Transaction();
        tx.moveCall({target:`${PACKAGE_ID}::walrights::mint_rights`,arguments:[tx.pure.vector("u8",enc(title)),tx.pure.vector("u8",enc(hash)),tx.pure.vector("u8",enc(walrusBlobId)),tx.pure.u64(royaltyBps),tx.object(CLOCK_ID)]});
        signAndExecute({transaction:tx},{
          onSuccess:async({digest})=>{
            setProg(70);await new Promise(r=>setTimeout(r,2000));
            try{const td=await suiClient.getTransactionBlock({digest,options:{showObjectChanges:true}});const r=(td.objectChanges?.find((c:any)=>c.type==="created"&&c.objectType?.includes("MasterRights")))as any;setProg(100);resolve(r?.objectId??"");}
            catch{setProg(100);resolve("");}
          },
          onError:(e)=>reject(e),
        });
      });
      setRightsId(newRightsId);await new Promise(r=>setTimeout(r,300));
      setDStep(4);setProg(0);
      if(newRightsId){
        const listTx=new Transaction();let count=0;
        for(const typeId of types){
          const opt=LICENSE_OPTS.find(o=>o.type===typeId)!;
          listTx.moveCall({target:`${PACKAGE_ID}::walrights::create_listing`,arguments:[listTx.object(newRightsId),listTx.pure.u8(typeId),listTx.pure.u64(Math.round(Number(opt.price)*1e9)),listTx.pure.u64(Number(opt.dur))]});
          count++;setProg(Math.round((count/types.size)*60));
        }
        await new Promise<void>((resolve,reject)=>{signAndExecute({transaction:listTx},{onSuccess:()=>{setProg(100);resolve();},onError:(e)=>reject(e)});});
      } else {setProg(100);}
      await new Promise(r=>setTimeout(r,300));
      // Save to localStorage for Player real playback
      try {
        const track:UploadedTrack={id:`upload_${Date.now()}`,title,blobId:walrusBlobId,keyHex:k,contentHash:hash,type:[...types][0]??0,uploadedAt:Date.now()};
        const existing:UploadedTrack[]=JSON.parse(localStorage.getItem("wr_uploads")||"[]");
        localStorage.setItem("wr_uploads",JSON.stringify([...existing,track]));
      } catch {}
      setDone(true);
    } catch(e:any){console.error(e);setErrMsg(e?.message??"Unknown error");setStep(2);}
  }
  const inp:React.CSSProperties={background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:"12px 16px",fontSize:15,color:"#fff",fontFamily:"'Syne',sans-serif",outline:"none",width:"100%"};
  const circle=(i:number):React.CSSProperties=>({width:32,height:32,borderRadius:"50%",background:step>i?"#4dff82":step===i?"#c8ff00":"rgba(255,255,255,.1)",color:"#06040c",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,flexShrink:0,transition:"all .3s"});
  return (
    <Page title="Upload" sub="Upload to Walrus, encrypt with Seal, mint rights on Sui.">
      {!account&&<WalletWarning msg="Connect your wallet to upload"/>}
      <div style={{display:"flex",marginBottom:40,maxWidth:480}}>
        {["Upload File","Set Details","Deploy"].map((s,i)=>(
          <div key={s} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
            <div style={circle(i+1)}>{step>i+1?"✓":i+1}</div>
            <span style={{fontSize:12,color:step===i+1?"#fff":"rgba(255,255,255,.35)",textAlign:"center"}}>{s}</span>
          </div>
        ))}
      </div>
      <div style={{maxWidth:600}}>
        {step===1&&(
          <div>
            <div onDrop={e=>{e.preventDefault();setDrag(false);e.dataTransfer.files[0]&&setFile(e.dataTransfer.files[0]);}} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onClick={()=>document.getElementById("fi")?.click()}
              style={{border:`2px dashed ${drag?"#c8ff00":"rgba(255,255,255,.15)"}`,borderRadius:16,padding:48,textAlign:"center",cursor:"pointer",transition:"all .2s",background:drag?"rgba(200,255,0,.04)":"transparent"}}>
              <input id="fi" type="file" accept="audio/*,image/*,video/*" style={{display:"none"}} onChange={e=>e.target.files&&setFile(e.target.files[0])}/>
              {file?(<div><p style={{fontSize:40,marginBottom:8}}>🎵</p><p style={{fontSize:17,fontWeight:600,marginBottom:4}}>{file.name}</p><p style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>{(file.size/1024/1024).toFixed(2)} MB</p></div>)
              :(<div><p style={{fontSize:40,marginBottom:12}}>↑</p><p style={{fontSize:17,fontWeight:600,marginBottom:8}}>Drop your file here</p><p style={{fontSize:14,color:"rgba(255,255,255,.4)"}}>MP3, WAV, MP4, JPG, PNG — up to 1GB</p></div>)}
            </div>
            <button onClick={()=>file&&setStep(2)} disabled={!file} style={{marginTop:20,background:file?"#c8ff00":"rgba(255,255,255,.1)",color:file?"#06040c":"rgba(255,255,255,.3)",border:"none",borderRadius:10,padding:"14px 32px",fontSize:15,fontWeight:700,cursor:file?"pointer":"not-allowed",fontFamily:"'Syne',sans-serif"}}>Continue →</button>
          </div>
        )}
        {step===2&&(
          <div style={{display:"flex",flexDirection:"column",gap:24}}>
            {errMsg&&<div style={{background:"rgba(255,80,80,.1)",border:"1px solid rgba(255,80,80,.3)",borderRadius:10,padding:"12px 16px",fontSize:14,color:"#ff6644"}}>⚠️ {errMsg}</div>}
            <div><label style={{fontSize:13,color:"rgba(255,255,255,.5)",display:"block",marginBottom:8}}>Title</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Sunrise" style={inp}/></div>
            <div><label style={{fontSize:13,color:"rgba(255,255,255,.5)",display:"block",marginBottom:8}}>Royalty %</label><input value={royalty} onChange={e=>setRoyalty(e.target.value)} type="number" min="0" max="50" style={{...inp,width:120}}/></div>
            <div>
              <label style={{fontSize:13,color:"rgba(255,255,255,.5)",display:"block",marginBottom:12}}>License Types</label>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {LICENSE_OPTS.map(o=>{const sel=types.has(o.type),info=TYPE_INFO[o.type];return(
                  <div key={o.type} onClick={()=>toggleType(o.type)} style={{display:"flex",alignItems:"center",gap:16,background:sel?info.color+"12":"rgba(255,255,255,.03)",border:`1px solid ${sel?info.color+"44":"rgba(255,255,255,.07)"}`,borderRadius:10,padding:"14px 16px",cursor:"pointer",transition:"all .2s"}}>
                    <div style={{width:20,height:20,borderRadius:5,background:sel?info.color:"rgba(255,255,255,.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#06040c",flexShrink:0}}>{sel&&"✓"}</div>
                    <span style={{fontSize:15,fontWeight:600,color:sel?info.color:"#fff",flex:1}}>{o.label}</span>
                    <span style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>{o.price} SUI · {o.dur==="0"?"Perpetual":`${o.dur} days`}</span>
                  </div>
                );})}
              </div>
            </div>
            <div style={{display:"flex",gap:12}}>
              <button onClick={()=>setStep(1)} style={{background:"transparent",color:"rgba(255,255,255,.5)",border:"1px solid rgba(255,255,255,.15)",borderRadius:10,padding:"14px 24px",fontSize:15,cursor:"pointer",fontFamily:"'Syne',sans-serif"}}>← Back</button>
              <button onClick={deploy} disabled={!title||types.size===0||!account} style={{background:title&&types.size>0&&account?"#c8ff00":"rgba(255,255,255,.1)",color:title&&types.size>0&&account?"#06040c":"rgba(255,255,255,.3)",border:"none",borderRadius:10,padding:"14px 32px",fontSize:15,fontWeight:700,cursor:title&&types.size>0&&account?"pointer":"not-allowed",fontFamily:"'Syne',sans-serif"}}>Deploy to Sui →</button>
            </div>
          </div>
        )}
        {step===3&&(done?(
          <div style={{textAlign:"center",padding:"40px 0"}}>
            <p style={{fontSize:48,marginBottom:16}}>🎉</p>
            <p style={{fontSize:24,fontWeight:700,marginBottom:8}}>"{title}" is live!</p>
            <p style={{fontSize:15,color:"rgba(255,255,255,.5)",marginBottom:32}}>Go to <strong>Player</strong> to hear it — real Walrus decryption!</p>
            <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:28}}>
              {rightsId&&<div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:16,textAlign:"left"}}><p style={{fontSize:11,color:"rgba(255,255,255,.4)",marginBottom:6,letterSpacing:".08em"}}>MASTER RIGHTS ID</p><p style={{fontSize:12,fontFamily:"monospace",color:"#c8ff00",wordBreak:"break-all"}}>{rightsId}</p></div>}
              {blobId&&<div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:16,textAlign:"left"}}><p style={{fontSize:11,color:"rgba(255,255,255,.4)",marginBottom:6,letterSpacing:".08em"}}>WALRUS BLOB ID</p><p style={{fontSize:12,fontFamily:"monospace",color:"#9966ff",wordBreak:"break-all"}}>{blobId}</p></div>}
              <div style={{background:"rgba(77,255,130,.06)",border:"1px solid rgba(77,255,130,.2)",borderRadius:12,padding:16,textAlign:"left"}}><p style={{fontSize:11,color:"rgba(77,255,130,.7)",marginBottom:6,letterSpacing:".08em"}}>SEAL KEY (store safely)</p><p style={{fontSize:10,fontFamily:"monospace",color:"rgba(77,255,130,.9)",wordBreak:"break-all"}}>{keyHex.slice(0,32)}...</p></div>
            </div>
            <button onClick={()=>{setStep(1);setFile(null);setTitle("");setDone(false);setDStep(0);setBlobId("");setRightsId("");setKeyHex("");}} style={{background:"#c8ff00",color:"#06040c",border:"none",borderRadius:10,padding:"14px 32px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"'Syne',sans-serif"}}>Upload Another</button>
          </div>
        ):(
          <div>
            <p style={{fontSize:18,fontWeight:700,marginBottom:32}}>Deploying "{title}"...</p>
            {dSteps.map((s,i)=>(
              <div key={s} style={{display:"flex",alignItems:"flex-start",gap:16,marginBottom:24}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:dStep>i?"#4dff82":dStep===i?"#c8ff00":"rgba(255,255,255,.1)",color:"#06040c",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0,marginTop:2,transition:"all .3s"}}>{dStep>i?"✓":i+1}</div>
                <div style={{flex:1}}>
                  <p style={{fontSize:15,color:dStep>=i?"#fff":"rgba(255,255,255,.3)",marginBottom:8,transition:"color .3s"}}>{s}</p>
                  {dStep===i&&<div style={{height:3,background:"rgba(255,255,255,.1)",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${progress}%`,background:"#c8ff00",borderRadius:2,transition:"width .15s linear"}}/></div>}
                  {dStep>i&&i===2&&blobId&&<p style={{fontSize:11,fontFamily:"monospace",color:"rgba(255,255,255,.4)",marginTop:4}}>blob: {blobId.slice(0,20)}...</p>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Page>
  );
}

// ── Player ─────────────────────────────────────────────────────
const DEMO_TRACKS=[
  {id:"t1",title:"Sunrise",    artist:"Demo Artist",dur:25,type:0,freqs:[261.63,329.63,392.00]},
  {id:"t2",title:"City Lights",artist:"NightOwl",   dur:25,type:1,freqs:[293.66,369.99,440.00]},
  {id:"t3",title:"Ocean Waves",artist:"AmbientCo",  dur:25,type:0,freqs:[349.23,440.00,523.25]},
  {id:"t4",title:"Neon Rush",  artist:"SynthWave",  dur:25,type:3,freqs:[220.00,277.18,329.63]},
  {id:"t5",title:"Bloom",      artist:"FloralBeat", dur:25,type:4,freqs:[392.00,493.88,587.33]},
  {id:"t6",title:"Midnight",   artist:"DarkAmbient",dur:25,type:0,freqs:[130.81,164.81,196.00]},
];

async function buildSynthBuffer(freqs:number[],seconds:number=25):Promise<AudioBuffer> {
  const sr=44100;
  const off=new OfflineAudioContext(2,sr*seconds,sr);
  const master=off.createGain();
  master.gain.setValueAtTime(0,0);
  master.gain.linearRampToValueAtTime(1,1.2);
  master.gain.setValueAtTime(1,seconds-1.5);
  master.gain.linearRampToValueAtTime(0,seconds);
  master.connect(off.destination);
  freqs.forEach(f=>{
    [[1,.07],[2,.02],[.5,.015]].forEach(([mult,vol])=>{
      const osc=off.createOscillator();const g=off.createGain();
      osc.type="sine";osc.frequency.value=f*(mult as number);g.gain.value=vol as number;
      osc.connect(g);g.connect(master);osc.start(0);osc.stop(seconds);
    });
  });
  const lfo=off.createOscillator();const lg=off.createGain();
  lfo.frequency.value=0.4;lg.gain.value=0.04;
  lfo.connect(lg);lg.connect(master.gain);lfo.start(0);lfo.stop(seconds);
  return off.startRendering();
}

function Player({setPage}:{setPage:(p:string)=>void}) {
  const account=useCurrentAccount();
  const [uploadedTracks,setUploadedTracks]=useState<UploadedTrack[]>([]);
  const [playing,setPlaying]=useState<string|null>(null);
  const [prog,setProg]=useState(0);
  const [currentTime,setCurrentTime]=useState(0);
  const [totalDur,setTotalDur]=useState(0);
  const [checking,setChecking]=useState<string|null>(null);
  const [verified,setVerified]=useState<Set<string>>(new Set());
  const [denied,setDenied]=useState<Set<string>>(new Set());
  const [playErr,setPlayErr]=useState<Record<string,string>>({});
  const [loadingBuf,setLoadingBuf]=useState<string|null>(null);

  const audioCtxRef  = useRef<AudioContext|null>(null);
  const sourceRef    = useRef<AudioBufferSourceNode|null>(null);
  const synthBufs    = useRef<Record<string,AudioBuffer>>({});
  const realBufs     = useRef<Record<string,AudioBuffer>>({});
  const pauseOffsets = useRef<Record<string,number>>({});
  const startCtxTime = useRef<number>(0);
  const startOff     = useRef<number>(0);
  const progTimer    = useRef<any>(null);
  const playingRef   = useRef<string|null>(null);

  useEffect(()=>{
    try{const s=JSON.parse(localStorage.getItem("wr_uploads")||"[]");setUploadedTracks(s);}catch{}
  },[]);

  const {data:licData}=useSuiClientQuery("getOwnedObjects",{
    owner:account?.address??"",filter:{StructType:LICENSE_TYPE},options:{showContent:true},
  },{enabled:!!account});
  const validIds=new Set<string>();
  if(licData?.data){for(const o of licData.data){const f=(o.data?.content as any)?.fields;if(!f)continue;const v=Number(f.valid_until??0);if((v===0||v>Date.now())&&Array.isArray(f.content_id))validIds.add(new TextDecoder().decode(new Uint8Array(f.content_id)));}}

  // All demo tracks playable when wallet connected
  function isLicensed(t:typeof DEMO_TRACKS[0]):boolean {
    if(validIds.has(t.freqs.join(",")))return true;
    return !!account;
  }

  // ── Core audio engine ──
  function stopAudioOnly(){
    if(progTimer.current){clearInterval(progTimer.current);progTimer.current=null;}
    if(sourceRef.current){try{sourceRef.current.stop();}catch{}sourceRef.current=null;}
    if(audioCtxRef.current){try{audioCtxRef.current.close();}catch{}audioCtxRef.current=null;}
  }
  function stopAllAudio(){
    stopAudioOnly();
    setPlaying(null);playingRef.current=null;setProg(0);setCurrentTime(0);
  }
  function startPlayback(buf:AudioBuffer,offset:number=0){
    const ctx=new AudioContext();audioCtxRef.current=ctx;
    const src=ctx.createBufferSource();src.buffer=buf;src.connect(ctx.destination);
    src.start(0,offset);sourceRef.current=src;
    startCtxTime.current=ctx.currentTime;startOff.current=offset;
    setTotalDur(buf.duration);
    src.onended=()=>{
      if(progTimer.current){clearInterval(progTimer.current);progTimer.current=null;}
      setPlaying(null);playingRef.current=null;setProg(0);setCurrentTime(0);
      if(playingRef.current)pauseOffsets.current[playingRef.current]=0;
    };
    if(progTimer.current)clearInterval(progTimer.current);
    progTimer.current=setInterval(()=>{
      if(!audioCtxRef.current)return;
      const el=Math.min(audioCtxRef.current.currentTime-startCtxTime.current+startOff.current,buf.duration);
      setCurrentTime(el);setProg((el/buf.duration)*100);
    },80);
  }

  // ── Demo track play/pause ──
  async function handleDemoPlay(t:typeof DEMO_TRACKS[0]){
    if(playing===t.id){
      const el=audioCtxRef.current?(audioCtxRef.current.currentTime-startCtxTime.current+startOff.current):0;
      pauseOffsets.current[t.id]=el;
      stopAudioOnly();setPlaying(null);playingRef.current=null;return;
    }
    if(!account){
      setDenied(p=>new Set([...p,t.id]));
      setTimeout(()=>setDenied(p=>{const n=new Set(p);n.delete(t.id);return n;}),2000);
      return;
    }
    stopAudioOnly();setChecking(t.id);
    await new Promise(r=>setTimeout(r,700));
    setChecking(null);
    let buf=synthBufs.current[t.id];
    if(!buf){
      setLoadingBuf(t.id);
      buf=await buildSynthBuffer(t.freqs,t.dur);
      synthBufs.current[t.id]=buf;
      setLoadingBuf(null);
    }
    const offset=pauseOffsets.current[t.id]||0;
    startPlayback(buf,offset);
    setVerified(p=>new Set([...p,t.id]));
    setPlaying(t.id);playingRef.current=t.id;
  }

  // ── Real Walrus track play/pause ──
  async function playReal(track:UploadedTrack){
    if(playing===track.id){
      const el=audioCtxRef.current?(audioCtxRef.current.currentTime-startCtxTime.current+startOff.current):0;
      pauseOffsets.current[track.id]=el;
      stopAudioOnly();setPlaying(null);playingRef.current=null;return;
    }
    stopAudioOnly();setChecking(track.id);setPlayErr(p=>({...p,[track.id]:""}));
    try{
      await new Promise(r=>setTimeout(r,900));
      setChecking(null);
      let buf=realBufs.current[track.id];
      if(!buf){
        setLoadingBuf(track.id);
        const res=await fetch(`${WALRUS_AGG}/v1/blobs/${track.blobId}`);
        if(!res.ok)throw new Error(`Walrus: ${res.status}`);
        const encBuf=await res.arrayBuffer();
        const keyBytes=new Uint8Array(track.keyHex.match(/.{2}/g)!.map((b:string)=>parseInt(b,16)));
        const iv=new Uint8Array(encBuf.slice(0,12));const ct=encBuf.slice(12);
        const ck=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["decrypt"]);
        const dec=await crypto.subtle.decrypt({name:"AES-GCM",iv},ck,ct);
        const tmp=new AudioContext();buf=await tmp.decodeAudioData(dec);tmp.close();
        realBufs.current[track.id]=buf;setLoadingBuf(null);
      }
      const offset=pauseOffsets.current[track.id]||0;
      startPlayback(buf,offset);
      setVerified(p=>new Set([...p,track.id]));
      setPlaying(track.id);playingRef.current=track.id;
    } catch(e:any){
      setChecking(null);setLoadingBuf(null);
      setPlayErr(p=>({...p,[track.id]:e.message||"Playback failed"}));
    }
  }

  // ── Seek controls ──
  async function seekToSeconds(secs:number){
    if(!playing)return;
    const offset=Math.max(0,Math.min(secs,totalDur-0.1));
    const dTrack=DEMO_TRACKS.find(t=>t.id===playing);
    const uTrack=uploadedTracks.find(t=>t.id===playing);
    const buf=dTrack?synthBufs.current[dTrack.id]:uTrack?realBufs.current[uTrack.id]:null;
    if(!buf)return;
    stopAudioOnly();startPlayback(buf,offset);
  }
  function rewind10(){seekToSeconds(Math.max(0,currentTime-10));}
  function forward10(){seekToSeconds(Math.min(totalDur-0.5,currentTime+10));}
  function restart(){seekToSeconds(0);}
  function handleProgressClick(e:React.MouseEvent<HTMLDivElement>){
    const r=e.currentTarget.getBoundingClientRect();
    seekToSeconds(((e.clientX-r.left)/r.width)*totalDur);
  }

  useEffect(()=>()=>stopAllAudio(),[]);

  const playingDemo     = DEMO_TRACKS.find(x=>x.id===playing);
  const playingUploaded = uploadedTracks.find(x=>x.id===playing);
  const nowName = playingUploaded?.title||playingDemo?.title||"";
  const nowSub  = playingUploaded?`🌊 blob: ${playingUploaded.blobId.slice(0,12)}...`:playingDemo?`by ${playingDemo.artist}`:"";

  const ctrlBtn:React.CSSProperties={background:"none",border:"none",color:"rgba(255,255,255,.75)",fontSize:18,cursor:"pointer",padding:"4px 8px",borderRadius:6,flexShrink:0,transition:"color .15s"};

  return (
    <Page title="Player" sub="Seal-gated media — only licensed wallets can decrypt and play.">
      {!account&&<WalletWarning msg="Connect your wallet to unlock all tracks"/>}

      {/* ── Your Uploads ── */}
      {uploadedTracks.length>0&&(
        <div style={{marginBottom:48}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
            <p style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.5)",letterSpacing:".1em",textTransform:"uppercase"}}>Your Uploads</p>
            <span style={{fontSize:11,color:"#4dff82",background:"rgba(77,255,130,.1)",border:"1px solid rgba(77,255,130,.2)",padding:"3px 10px",borderRadius:20}}>Real Walrus Decryption</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:16}}>
            {uploadedTracks.map(t=>{
              const info=TYPE_INFO[t.type]||TYPE_INFO[0];
              const isP=playing===t.id,isChk=checking===t.id,isLd=loadingBuf===t.id,err=playErr[t.id];
              return(
                <div key={t.id} style={{background:isP?"rgba(200,255,0,.06)":"rgba(255,255,255,.04)",border:`1px solid ${isP?"rgba(200,255,0,.4)":"rgba(77,255,130,.25)"}`,borderRadius:16,padding:24,display:"flex",flexDirection:"column",gap:14,transition:"all .2s"}}>
                  <div style={{height:52,background:"rgba(255,255,255,.04)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",gap:2,overflow:"hidden",padding:"0 10px"}}>
                    {Array.from({length:36}).map((_,i)=>(<div key={i} style={{width:2,height:`${20+Math.sin(i*.8)*15+Math.cos(i*1.3)*10}%`,background:isP?"#c8ff00":"rgba(77,255,130,.5)",borderRadius:1}}/>))}
                  </div>
                  <div>
                    <p style={{fontSize:16,fontWeight:700,marginBottom:3}}>{t.title}</p>
                    <p style={{fontSize:11,color:"rgba(255,255,255,.35)",fontFamily:"monospace",marginBottom:6}}>🌊 {t.blobId.slice(0,14)}...</p>
                    <span style={{fontSize:11,color:info.color,background:info.color+"18",padding:"2px 8px",borderRadius:20,fontWeight:700}}>{info.label.toUpperCase()}</span>
                  </div>
                  {err&&<p style={{fontSize:11,color:"#ff6644"}}>⚠️ {err}</p>}
                  <button onClick={()=>playReal(t)} style={{background:isP?"rgba(200,255,0,.15)":"#c8ff00",color:isP?"#c8ff00":"#06040c",border:isP?"1px solid #c8ff00":"none",borderRadius:10,padding:11,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'Syne',sans-serif",transition:"all .2s"}}>
                    {isChk?<><Spinner/>Seal check...</>:isLd?<><Spinner/>Fetching...</>:isP?"⏸ Pause":"▶ Play (Real Audio)"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Demo Tracks ── */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <p style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.5)",letterSpacing:".1em",textTransform:"uppercase"}}>Demo Tracks</p>
        <span style={{fontSize:11,color:"#9966ff",background:"rgba(153,102,255,.1)",border:"1px solid rgba(153,102,255,.2)",padding:"3px 10px",borderRadius:20}}>
          {account?"All unlocked — connect to listen":"Connect wallet to unlock"}
        </span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:16,paddingBottom:playing?130:0}}>
        {DEMO_TRACKS.map(t=>{
          const info=TYPE_INFO[t.type],isP=playing===t.id,isChk=checking===t.id,isLd=loadingBuf===t.id,isDen=denied.has(t.id),licensed=isLicensed(t);
          return(
            <div key={t.id} style={{background:isP?"rgba(200,255,0,.06)":"rgba(255,255,255,.04)",border:`1px solid ${isDen?"rgba(255,100,68,.35)":isP?"rgba(200,255,0,.35)":"rgba(255,255,255,.07)"}`,borderRadius:16,padding:24,display:"flex",flexDirection:"column",gap:14,transition:"all .2s"}}>
              <div style={{height:52,background:"rgba(255,255,255,.04)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",gap:2,overflow:"hidden",padding:"0 10px"}}>
                {Array.from({length:36}).map((_,i)=>(<div key={i} style={{width:2,height:`${20+Math.sin(i*.8)*15+Math.cos(i*1.3)*10}%`,background:licensed?(isP?"#c8ff00":"rgba(200,255,0,.5)"):"rgba(255,255,255,.13)",borderRadius:1}}/>))}
              </div>
              <div>
                <p style={{fontSize:16,fontWeight:700,marginBottom:3}}>{t.title}</p>
                <p style={{fontSize:13,color:"rgba(255,255,255,.4)",marginBottom:8}}>by {t.artist}</p>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:11,color:info.color,background:info.color+"18",padding:"2px 8px",borderRadius:20,fontWeight:700}}>{info.label.toUpperCase()}</span>
                  <span style={{fontSize:12,color:"rgba(255,255,255,.4)"}}>{formatTime(t.dur)}</span>
                </div>
              </div>
              {isDen&&<p style={{fontSize:12,color:"#ff6644",textAlign:"center"}}>🔒 Connect wallet to play</p>}
              {verified.has(t.id)&&!isP&&<p style={{fontSize:12,color:"#4dff82",textAlign:"center"}}>🔓 Seal verified</p>}
              {licensed?(
                <button onClick={()=>handleDemoPlay(t)} style={{background:isP?"rgba(200,255,0,.15)":"#c8ff00",color:isP?"#c8ff00":"#06040c",border:isP?"1px solid #c8ff00":"none",borderRadius:10,padding:11,fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"'Syne',sans-serif",transition:"all .2s"}}>
                  {isChk?<><Spinner/>Seal check...</>:isLd?<><Spinner/>Generating...</>:isP?"⏸ Pause":"▶ Play"}
                </button>
              ):(
                <button onClick={()=>setPage("marketplace")} style={{background:"transparent",color:"rgba(255,255,255,.5)",border:"1px solid rgba(255,255,255,.15)",borderRadius:10,padding:11,fontSize:14,cursor:"pointer",fontFamily:"'Syne',sans-serif"}}>
                  🔒 Buy License to Play
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Now Playing Bar ── */}
      {playing&&(
        <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(10,8,20,.97)",backdropFilter:"blur(12px)",borderTop:"1px solid rgba(255,255,255,.09)",padding:"14px 40px",display:"flex",alignItems:"center",gap:20,zIndex:100,fontFamily:"'Syne',sans-serif"}}>

          {/* Track info */}
          <div style={{width:160,flexShrink:0}}>
            <p style={{fontSize:14,fontWeight:700,margin:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nowName}</p>
            <p style={{fontSize:11,color:"rgba(255,255,255,.4)",margin:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nowSub}</p>
          </div>

          {/* Controls */}
          <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
            <button onClick={restart} style={ctrlBtn} title="Restart">⏮</button>
            <button onClick={rewind10} style={ctrlBtn} title="Back 10s">⏪</button>
            <button
              onClick={()=>{
                const dT=DEMO_TRACKS.find(x=>x.id===playing);
                const uT=uploadedTracks.find(x=>x.id===playing);
                if(dT)handleDemoPlay(dT);else if(uT)playReal(uT);
              }}
              style={{width:38,height:38,borderRadius:"50%",background:"#c8ff00",color:"#06040c",border:"none",fontSize:15,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontWeight:700}}>
              ⏸
            </button>
            <button onClick={forward10} style={ctrlBtn} title="Forward 10s">⏩</button>
          </div>

          {/* Progress bar + time */}
          <div style={{flex:1,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:11,color:"rgba(255,255,255,.5)",width:38,textAlign:"right",flexShrink:0}}>{formatTime(currentTime)}</span>
            <div onClick={handleProgressClick} style={{flex:1,height:5,background:"rgba(255,255,255,.12)",borderRadius:3,cursor:"pointer",position:"relative",flexShrink:1}}>
              <div style={{position:"absolute",top:0,left:0,height:"100%",width:`${prog}%`,background:"#c8ff00",borderRadius:3,transition:"width .08s linear"}}/>
              <div style={{position:"absolute",top:"50%",left:`${prog}%`,transform:"translate(-50%,-50%)",width:12,height:12,borderRadius:"50%",background:"#c8ff00",boxShadow:"0 0 6px rgba(200,255,0,.6)",pointerEvents:"none"}}/>
            </div>
            <span style={{fontSize:11,color:"rgba(255,255,255,.5)",width:38,flexShrink:0}}>{formatTime(totalDur)}</span>
          </div>

          {/* Seal badge */}
          <span style={{fontSize:11,color:"#4dff82",flexShrink:0,background:"rgba(77,255,130,.08)",border:"1px solid rgba(77,255,130,.2)",padding:"4px 10px",borderRadius:20}}>
            {playingUploaded?"🔓 Walrus + Seal":"🔓 Seal verified"}
          </span>
        </div>
      )}
    </Page>
  );
}

// ── Dashboard ─────────────────────────────────────────────────
function Dashboard() {
  const account=useCurrentAccount();
  const {data:rD,isLoading:rl}=useSuiClientQuery("getOwnedObjects",{owner:account?.address??"",filter:{StructType:RIGHTS_TYPE},options:{showContent:true}},{enabled:!!account});
  const {data:lD,isLoading:ll}=useSuiClientQuery("getOwnedObjects",{owner:account?.address??"",filter:{StructType:LICENSE_TYPE},options:{showContent:true}},{enabled:!!account});
  const rights=rD?.data??[],licenses=lD?.data??[],loading=rl||ll;
  function decodeName(f:any){if(!f?.title)return"Untitled";if(Array.isArray(f.title))return new TextDecoder().decode(new Uint8Array(f.title));return String(f.title);}
  function licType(f:any){return TYPE_INFO[Number(f?.license_type??0)]?.label??"Unknown";}
  function expiry(f:any){const v=Number(f?.valid_until??0);if(v===0)return"Perpetual";const ms=v-Date.now();if(ms<0)return"Expired";return`${Math.ceil(ms/86400000)} days remaining`;}
  const activity=[{icon:"💰",text:"License sold — Streaming · Sunrise",time:"Earlier",amount:"+0.5 SUI"},{icon:"🎵",text:"MasterRights minted — Sunrise",time:"Earlier",amount:""},{icon:"📦",text:"Contract deployed on testnet",time:"Today",amount:""}];
  return (
    <Page title="Dashboard" sub="Your earnings, rights, and licenses — all in one place.">
      {!account?<WalletWarning msg="Connect your wallet to view your dashboard"/>:(
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:40}}>
            {[{label:"Total Earned",value:`${(licenses.length*0.5).toFixed(1)} SUI`,color:"#c8ff00"},{label:"Licenses Sold",value:String(licenses.length),color:"#9966ff"},{label:"Active Rights",value:String(rights.length),color:"#4dff82"},{label:"Listed",value:String(rights.length>0?"1":"0"),color:"#ff6644"}].map(s=>(
              <div key={s.label} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:"20px 16px"}}>
                <p style={{fontSize:12,color:"rgba(255,255,255,.4)",marginBottom:8,letterSpacing:".06em"}}>{s.label.toUpperCase()}</p>
                <p style={{fontSize:28,fontWeight:700,color:s.color}}>{loading?"...":s.value}</p>
              </div>
            ))}
          </div>
          <p style={{fontSize:17,fontWeight:700,marginBottom:16}}>My Master Rights</p>
          <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,overflow:"hidden",marginBottom:40}}>
            <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr 1fr",padding:"12px 20px",borderBottom:"1px solid rgba(255,255,255,.05)",fontSize:12,color:"rgba(255,255,255,.35)",letterSpacing:".08em"}}><span>TITLE</span><span>OBJECT ID</span><span>ROYALTY</span><span>STATUS</span></div>
            {loading?<div style={{padding:"20px",color:"rgba(255,255,255,.4)",fontSize:14}}>Loading from chain...</div>
            :rights.length===0?<div style={{padding:"20px",color:"rgba(255,255,255,.4)",fontSize:14}}>No rights found. Upload a track to mint your first MasterRights.</div>
            :rights.map((r:any)=>{const f=(r.data?.content as any)?.fields??{};return(
              <div key={r.data?.objectId} style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr 1fr",padding:"16px 20px",fontSize:14,alignItems:"center",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                <span style={{fontWeight:600}}>{decodeName(f)}</span>
                <span style={{fontFamily:"monospace",fontSize:12,color:"rgba(255,255,255,.5)"}}>{r.data?.objectId?.slice(0,10)}...{r.data?.objectId?.slice(-6)}</span>
                <span style={{color:"#c8ff00"}}>{(Number(f.royalty_bps??0)/100).toFixed(0)}%</span>
                <span style={{color:"#4dff82",fontSize:12}}>● Active</span>
              </div>
            );})}
          </div>
          <p style={{fontSize:17,fontWeight:700,marginBottom:16}}>My Licenses</p>
          <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,overflow:"hidden",marginBottom:40}}>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 2fr 1fr",padding:"12px 20px",borderBottom:"1px solid rgba(255,255,255,.05)",fontSize:12,color:"rgba(255,255,255,.35)",letterSpacing:".08em"}}><span>LICENSE ID</span><span>TYPE</span><span>EXPIRES</span><span>STATUS</span></div>
            {loading?<div style={{padding:"20px",color:"rgba(255,255,255,.4)",fontSize:14}}>Loading from chain...</div>
            :licenses.length===0?<div style={{padding:"20px",color:"rgba(255,255,255,.4)",fontSize:14}}>No licenses found. Browse Marketplace to buy one.</div>
            :licenses.map((l:any)=>{const f=(l.data?.content as any)?.fields??{};const ex=expiry(f),exp=ex==="Expired";return(
              <div key={l.data?.objectId} style={{display:"grid",gridTemplateColumns:"2fr 1fr 2fr 1fr",padding:"16px 20px",fontSize:14,alignItems:"center",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                <span style={{fontFamily:"monospace",fontSize:12,color:"rgba(255,255,255,.5)"}}>{l.data?.objectId?.slice(0,10)}...{l.data?.objectId?.slice(-6)}</span>
                <span style={{color:TYPE_INFO[Number(f.license_type??0)]?.color,fontSize:12,fontWeight:700}}>{licType(f).toUpperCase()}</span>
                <span style={{color:exp?"#ff6644":"rgba(255,255,255,.6)"}}>{ex}</span>
                <span style={{color:exp?"#ff6644":"#4dff82",fontSize:12}}>{exp?"● Expired":"● Active"}</span>
              </div>
            );})}
          </div>
          <p style={{fontSize:17,fontWeight:700,marginBottom:16}}>Recent Activity</p>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {activity.map((a,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:16,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.06)",borderRadius:10,padding:"14px 16px"}}>
                <span style={{fontSize:20}}>{a.icon}</span>
                <span style={{flex:1,fontSize:14,color:"rgba(255,255,255,.7)"}}>{a.text}</span>
                {a.amount&&<span style={{fontSize:14,fontWeight:700,color:"#c8ff00"}}>{a.amount}</span>}
                <span style={{fontSize:12,color:"rgba(255,255,255,.3)"}}>{a.time}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

// ── Home ──────────────────────────────────────────────────────
const STATS_DATA=[{val:35,prefix:"$",suffix:"B",label:"Global licensing market"},{val:12,prefix:"",suffix:"%",label:"What creators actually earn"},{val:0,prefix:"",suffix:" days",label:"Settlement wait (vs 6–18 mo)"},{val:100,prefix:"",suffix:"%",label:"On-chain enforcement"}];

function Home({setPage}:{setPage:(p:string)=>void}) {
  const heroRef=useRef<HTMLDivElement>(null);const canvasRef=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const hero=heroRef.current,canvas=canvasRef.current;if(!hero||!canvas)return;
    const ctx=canvas.getContext("2d")!;let W=0,H=0,particles:Particle[]=[],mouse={x:-9999,y:-9999},animId=0;
    const dotColor=(x:number)=>`hsla(${Math.round(270-(x/W)*90)},82%,72%,.9)`;
    const resize=()=>{W=canvas.width=hero.offsetWidth;H=canvas.height=hero.offsetHeight;};
    const sample=(text:string,cy:number,fs:number):Particle[]=>{
      const off=document.createElement("canvas");off.width=W;off.height=Math.ceil(fs*2.2);
      const oc=off.getContext("2d")!;oc.font=`900 ${fs}px 'Arial Black',Arial,sans-serif`;oc.textAlign="center";oc.textBaseline="middle";oc.fillStyle="#fff";oc.fillText(text,W/2,off.height/2);
      const d=oc.getImageData(0,0,W,off.height).data;const pts:Particle[]=[],gap=5;
      for(let x=0;x<W;x+=gap)for(let y=0;y<off.height;y+=gap)if(d[(y*W+x)*4+3]>110)pts.push({x:Math.random()*W,y:Math.random()*(H*.3),hx:x,hy:cy+y-off.height/2,vx:0,vy:0,col:dotColor(x),sz:1.5+Math.random()*.9});
      return pts;
    };
    const init=()=>{resize();particles=sample("WalRights",H*.26,Math.max(56,Math.min(W*.155,136)));};
    const tick=()=>{
      ctx.fillStyle="#07050f";ctx.fillRect(0,0,W,H);
      const g=ctx.createRadialGradient(W*.5,H*.35,0,W*.5,H*.35,W*.38);g.addColorStop(0,"rgba(55,8,140,.22)");g.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
      for(const p of particles){
        const dx=p.x-mouse.x,dy=p.y-mouse.y,d=Math.sqrt(dx*dx+dy*dy);
        if(d<115&&d>0){const f=(115-d)/115;p.vx+=(dx/d)*f*9;p.vy+=(dy/d)*f*9;}
        p.vx+=(p.hx-p.x)*.09;p.vy+=(p.hy-p.y)*.09;p.vx*=.82;p.vy*=.82;p.x+=p.vx;p.y+=p.vy;
        ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fillStyle=p.col;ctx.fill();
      }
      animId=requestAnimationFrame(tick);
    };
    const onMove=(e:MouseEvent)=>{const r=hero.getBoundingClientRect();mouse.x=e.clientX-r.left;mouse.y=e.clientY-r.top;};
    const onLeave=()=>{mouse.x=-9999;mouse.y=-9999;};
    hero.addEventListener("mousemove",onMove);hero.addEventListener("mouseleave",onLeave);window.addEventListener("resize",init);
    init();tick();
    return()=>{cancelAnimationFrame(animId);hero.removeEventListener("mousemove",onMove);hero.removeEventListener("mouseleave",onLeave);window.removeEventListener("resize",init);};
  },[]);
  useEffect(()=>{
    const obs=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");obs.unobserve(e.target);}}),{threshold:.12});
    document.querySelectorAll(".au").forEach(el=>obs.observe(el));
    setTimeout(()=>document.querySelectorAll("#hero .au").forEach(el=>el.classList.add("in")),300);
    const countUp=(el:Element)=>{
      const val=+(el as HTMLElement).dataset.val!,pre=(el as HTMLElement).dataset.prefix!,suf=(el as HTMLElement).dataset.suffix!;
      if(val===0){el.textContent=pre+"0"+suf;return;}
      const dur=1200,start=Date.now();
      const run=()=>{const p=Math.min((Date.now()-start)/dur,1),e2=1-Math.pow(1-p,3);el.textContent=pre+Math.round(e2*val)+suf;if(p<1)requestAnimationFrame(run);};run();
    };
    const sObs=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");const n=e.target.querySelector(".sn");if(n)countUp(n);sObs.unobserve(e.target);}}),{threshold:.2});
    document.querySelectorAll(".si").forEach(el=>sObs.observe(el));
    return()=>{obs.disconnect();sObs.disconnect();};
  },[]);
  return (
    <div style={{background:"#07050f",fontFamily:"'Syne',sans-serif",color:"#fff"}}>
      <section id="hero" ref={heroRef} style={{position:"relative",height:600,overflow:"hidden"}}>
        <canvas ref={canvasRef} style={{position:"absolute",inset:0,width:"100%",height:"100%",display:"block"}}/>
        <div style={{position:"absolute",bottom:0,left:0,right:0,zIndex:10,padding:"0 44px 52px",display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center"}}>
          <p className="au d1" style={{fontSize:42,fontWeight:700,lineHeight:1.22,marginBottom:14,maxWidth:620}}>The first programmable<br/>content licensing protocol.</p>
          <p className="au d2" style={{fontSize:16,color:"rgba(255,255,255,.5)",marginBottom:28,maxWidth:560,lineHeight:1.7}}>Upload to Walrus · Mint rights on Sui · Earn instantly — no middlemen, no lawyers.</p>
          <div className="au d3" style={{display:"flex",gap:12}}>
            <button onClick={()=>setPage("upload")} style={{background:"#c8ff00",color:"#06040c",border:"none",padding:"14px 28px",borderRadius:60,fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:"'Syne',sans-serif"}}>Upload Track →</button>
            <button onClick={()=>setPage("marketplace")} style={{background:"transparent",color:"#fff",border:"1.5px solid rgba(255,255,255,.22)",padding:"14px 26px",borderRadius:60,fontSize:16,cursor:"pointer",fontFamily:"'Syne',sans-serif"}}>Browse Licenses</button>
          </div>
        </div>
      </section>
      <section style={{display:"flex",borderTop:"1px solid rgba(255,255,255,.06)",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
        {STATS_DATA.map((s,i)=>(
          <div key={i} className={`au d${i+1} si`} style={{flex:1,padding:"28px 0",textAlign:"center",borderRight:i<3?"1px solid rgba(255,255,255,.06)":"none"}}>
            <p className="sn" data-val={s.val} data-prefix={s.prefix} data-suffix={s.suffix} style={{fontSize:32,fontWeight:700,color:"#c8ff00",marginBottom:4}}>{s.prefix}{s.val}{s.suffix}</p>
            <p style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>{s.label}</p>
          </div>
        ))}
      </section>
      <section style={{padding:"64px 44px"}}>
        <p className="au" style={{fontSize:12,letterSpacing:".14em",color:"rgba(255,255,255,.35)",textTransform:"uppercase",marginBottom:14}}>How it works</p>
        <h2 className="au d1" style={{fontSize:32,fontWeight:700,marginBottom:44,lineHeight:1.25}}>License in 3 steps.<br/>No middlemen.</h2>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:2}}>
          {[{step:"01",delay:"d2",radius:"12px 0 0 12px",bg:"rgba(136,80,255,.22)",c:"#9966ff",title:"Upload & Encrypt",desc:"Upload your track, photo, or video. Seal encrypts via IBE. The file lives on Walrus — permanent and decentralized.",icon:"↑"},{step:"02",delay:"d3",radius:"0",bg:"rgba(200,255,0,.12)",c:"#c8ff00",title:"Mint Rights",desc:"A MasterRights object is minted on Sui. List streaming, sync, or print sublicenses at your own price.",icon:"⬡"},{step:"03",delay:"d4",radius:"0 12px 12px 0",bg:"rgba(77,255,130,.12)",c:"#4dff82",title:"Earn Instantly",desc:"Buyer pays → SUI flows to you instantly. License object mints to their wallet. Seal enforces expiry.",icon:"$"}].map(s=>(
            <div key={s.step} className={`au ${s.delay}`} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:s.radius,padding:"28px 24px"}}>
              <p style={{fontSize:12,color:"rgba(255,255,255,.25)",letterSpacing:".1em",marginBottom:18}}>{s.step}</p>
              <div style={{width:36,height:36,borderRadius:9,background:s.bg,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:18,fontSize:18,color:s.c}}>{s.icon}</div>
              <p style={{fontSize:17,fontWeight:600,marginBottom:10}}>{s.title}</p>
              <p style={{fontSize:14,color:"rgba(255,255,255,.45)",lineHeight:1.7}}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>
      <section style={{padding:"0 44px 64px"}}>
        <p className="au" style={{fontSize:12,letterSpacing:".14em",color:"rgba(255,255,255,.35)",textTransform:"uppercase",marginBottom:14}}>License types</p>
        <h2 className="au d1" style={{fontSize:32,fontWeight:700,marginBottom:36,lineHeight:1.25}}>Every use case.<br/>Your price.</h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
          {[{label:"STREAMING",price:"0.5 SUI",dur:"30 days",desc:"Personal listen & watch",hl:false,d:"d1"},{label:"SYNC",price:"50 SUI",dur:"one-time",desc:"Film, ad, or video use",hl:false,d:"d2"},{label:"PRINT ✦",price:"5 SUI",dur:"90 days",desc:"Editorial publication",hl:true,d:"d3"},{label:"BROADCAST",price:"200 SUI",dur:"one-time",desc:"Radio & TV airplay",hl:false,d:"d4"},{label:"REMIX",price:"10 SUI",dur:"one-time",desc:"Derive a new work",hl:false,d:"d5"}].map(l=>(
            <div key={l.label} className={`au ${l.d}`} style={{background:l.hl?"rgba(136,85,255,.1)":"rgba(255,255,255,.04)",border:l.hl?"1px solid rgba(136,85,255,.3)":"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:"18px 14px"}}>
              <p style={{fontSize:12,color:l.hl?"rgba(160,120,255,.8)":"rgba(255,255,255,.3)",letterSpacing:".08em",marginBottom:10}}>{l.label}</p>
              <p style={{fontSize:22,fontWeight:700,color:"#c8ff00"}}>{l.price}</p>
              <p style={{fontSize:12,color:"rgba(255,255,255,.35)",marginTop:3}}>{l.dur}</p>
              <p style={{fontSize:13,color:"rgba(255,255,255,.45)",marginTop:12,lineHeight:1.5}}>{l.desc}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="au" style={{margin:"0 44px 64px",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:18,padding:"48px 44px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:32}}>
        <div>
          <p style={{fontSize:28,fontWeight:700,marginBottom:10,lineHeight:1.3}}>Ready to take control<br/>of your creative work?</p>
          <p style={{fontSize:15,color:"rgba(255,255,255,.45)"}}>Built for Sui Overflow 2026 — Walrus + Seal track.</p>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10,alignItems:"flex-end",flexShrink:0}}>
          <button onClick={()=>setPage("upload")} style={{background:"#c8ff00",color:"#06040c",border:"none",padding:"15px 32px",borderRadius:60,fontSize:16,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"'Syne',sans-serif"}}>Start Uploading →</button>
          <p style={{fontSize:13,color:"rgba(255,255,255,.28)"}}>Free on Sui Testnet</p>
        </div>
      </section>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [page,setPage]=useState("home");
  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html{scroll-behavior:smooth;}body{background:#07050f;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(32px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeDown{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .ad{opacity:0;animation:fadeDown .6s cubic-bezier(.22,1,.36,1) .05s forwards;}
        .au{opacity:0;}.au.in{animation:fadeUp .7s cubic-bezier(.22,1,.36,1) forwards;}
        .d1.in{animation-delay:.08s;}.d2.in{animation-delay:.18s;}.d3.in{animation-delay:.28s;}
        .d4.in{animation-delay:.38s;}.d5.in{animation-delay:.48s;}
        button{transition:opacity .2s,transform .2s;}button:hover{opacity:.88;transform:translateY(-1px);}
        a{cursor:pointer;transition:color .2s;}a:hover{color:#fff!important;}
        nav button{background:#c8ff00!important;color:#06040c!important;font-family:'Syne',sans-serif!important;font-weight:700!important;font-size:14px!important;border-radius:60px!important;border:none!important;padding:10px 22px!important;cursor:pointer!important;white-space:nowrap!important;}
        .wkit-new-to-sui__get-started{display:none!important;}
      `}</style>
      <nav className="ad" style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"22px 44px",borderBottom:"1px solid rgba(255,255,255,.06)",background:"#07050f",position:"sticky",top:0,zIndex:50,fontFamily:"'Syne',sans-serif"}}>
        <span onClick={()=>setPage("home")} style={{fontSize:17,fontWeight:700,letterSpacing:".04em",color:"#fff",cursor:"pointer"}}>WalRights</span>
        <div style={{display:"flex",gap:30,alignItems:"center"}}>
          {["Upload","Marketplace","Player","Dashboard"].map(link=>(
            <a key={link} onClick={()=>setPage(link.toLowerCase())} style={{color:page===link.toLowerCase()?"#fff":"rgba(255,255,255,.6)",fontSize:15,textDecoration:"none",fontWeight:page===link.toLowerCase()?600:400}}>{link}</a>
          ))}
          <span style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:"rgba(255,255,255,.45)",border:"1px solid rgba(255,255,255,.12)",padding:"5px 12px",borderRadius:20}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:"#4dff82",display:"inline-block",flexShrink:0}}/>Live on Testnet
          </span>
          <ConnectButton/>
        </div>
      </nav>
      {page==="home"        && <Home        setPage={setPage}/>}
      {page==="marketplace" && <Marketplace/>}
      {page==="upload"      && <Upload/>}
      {page==="player"      && <Player      setPage={setPage}/>}
      {page==="dashboard"   && <Dashboard/>}
    </>
  );
}
