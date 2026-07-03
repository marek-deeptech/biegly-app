import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { buildIVChapter } from "./lib/opinion/build";
import { buildIvRedactPrompt, type IvRedactKind } from "./lib/opinion/redact";
(async () => {
  const env: Record<string,string> = {};
  for (const l of readFileSync("./.env.local","utf8").split("\n")) if(l.includes("=")&&!l.startsWith("#")){const i=l.indexOf("=");env[l.slice(0,i)]=l.slice(i+1).trim();}
  const B=env["NEXT_PUBLIC_SUPABASE_URL"].replace(/\/$/,""),K=env["SUPABASE_SERVICE_ROLE_KEY"],H={apikey:K,Authorization:"Bearer "+K};
  const get=async(p:string)=>(await fetch(B+p,{headers:H})).json();
  const up=async(row:any)=>fetch(`${B}/rest/v1/subanalyses?on_conflict=case_id,kind`,{method:"POST",headers:{...H,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)});
  const cl=new Anthropic({apiKey:env.ANTHROPIC_API_KEY});
  const c=((await get("/rest/v1/cases?select=id,name,signature")) as any[]).find(x=>x.name==="HUBTECH");
  const metrics=await get(`/rest/v1/metrics?case_id=eq.${c.id}&select=key,value,unit,session_day&limit=6000`) as any[];
  const documents=await get(`/rest/v1/documents?case_id=eq.${c.id}&select=rel_path,provenance,doc_type&limit=3000`) as any[];
  const subs=await get(`/rest/v1/subanalyses?case_id=eq.${c.id}&select=kind,data`) as any[];
  const days=[...new Set(metrics.filter(m=>m.session_day).map(m=>m.session_day))].sort();
  const period=days.length?`od ${days[0]} do ${days[days.length-1]}`:null;
  const counts:Record<string,number>={}; for(const d of documents) counts[d.doc_type]=(counts[d.doc_type]??0)+1;
  const baseInv=Object.entries(counts).map(([k,v])=>`${v} × ${k}`);
  const events=(subs.find((s:any)=>s.kind==="espi_events")?.data?.events??[]) as any[];
  const evInv=events.slice(0,15).map((e:any)=>`ESPI zdarzenie: ${e.date||"—"} — ${(e.type||"").trim()}${e.subject?" — "+e.subject:""}${e.session?` (zbieżne z sesją ${e.session})`:""}`);
  const asText=(t:any)=>t?.head&&t.rows?.length?`${t.caption?t.caption.replace(/^Tabela\.\s*/,"")+":\n":""}${t.head.join(" | ")}\n${t.rows.slice(0,120).map((r:string[])=>r.join(" | ")).join("\n")}`:null;
  for (const kind of ["ekofin","aktywnosc","wash"] as IvRedactKind[]) {
    const result=buildIVChapter(kind as any, c.name, metrics, documents, null) as any;
    const tbls=result.data.tables ?? (result.data.table?[result.data.table]:[]);
    const tableText=tbls.map(asText).filter(Boolean).join("\n\n")||null;
    const inv=[...baseInv, ...(kind==="aktywnosc"||kind==="ekofin"?evInv:[])];
    const p=buildIvRedactPrompt({kind,title:result.title,caseName:c.name,signature:c.signature,period,tableText,findings:result.data.findings,inventory:inv,legalRefs:result.data.legalRefs});
    const m=await cl.messages.create({model:"claude-opus-4-8",max_tokens:4000,system:p.system,messages:[{role:"user",content:p.user}]});
    const prose=(m.content as any[]).filter(b=>b.type==="text").map(b=>b.text).join("\n").trim();
    await up({case_id:c.id,kind,chapter_no:result.chapterNo,title:result.title,body_md:prose,data:result.data,status:"zatwierdzona",approved_at:new Date().toISOString()});
    console.log(`${result.chapterNo} ${kind}: ${prose.length} zn., tabel=${tbls.length}, zatwierdzone (stop=${(m as any).stop_reason})`);
  }
})().catch(e=>{console.error("ERR:",e.message);process.exit(1);});
