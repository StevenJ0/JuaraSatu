"use client";
import Link from "next/link";
import { useCallback,useEffect,useRef,useState } from "react";
import { z } from "zod";
import { MemoryViewSchema,MemorySourceSchema,MemoryWorkerResultSchema } from "../contracts";
import { BuildBusinessContextInputSchema } from "../../ai-context/contracts";
import "../../campaign-strategist/components/discussion.css";
import "../../campaign-evaluation/components/evaluation.css";
import "./memory.css";
const List=z.object({campaigns:z.array(z.object({id:z.uuid(),name:z.string(),status:z.literal("completed")})),memories:z.array(MemoryViewSchema)});
const Campaign=z.object({source:MemorySourceSchema.nullable(),sourceError:z.string().nullable(),memories:z.array(MemoryViewSchema)});
const errors:Record<string,string>={UNAUTHENTICATED:"Masuk melalui halaman diskusi menggunakan akun owner lokal.",NOT_FOUND:"Sumber tidak ditemukan untuk akun ini.",
  STALE_MEMORY_SOURCE:"Sumber evaluasi berubah atau usang. Muat ulang sumber sebelum melanjutkan.",MEMORY_SOURCE_CONFLICT:"Candidate telah berubah. Muat ulang sebelum meninjau lagi.",
  IDEMPOTENCY_CONFLICT:"Request ID dipakai untuk isi berbeda. Muat ulang dan buat request baru.",INVALID_INPUT:"Input tidak valid. Periksa pilihan sumber dan konfirmasi.",
  MEMORY_PROVIDER_UNAVAILABLE:"Provider Memory gagal. Tidak ada candidate sukses yang disimpan.",INVALID_MEMORY_OUTPUT:"Output provider tidak valid; candidate tidak disimpan.",
  MEMORY_SOURCE_MISMATCH:"Referensi atau klaim provider tidak cocok dengan evaluasi; output ditolak.",
  SYNTHETIC_MEMORY_APPROVAL_FORBIDDEN:"SQL melarang approval memory dari penyelesaian sintetis. Candidate tetap draft.",
  VERIFIED_C6_UNAVAILABLE:"Approval menunggu otoritas evaluasi/C6 terverifikasi. Flag JSON tidak menjadi bukti produksi.",
  APPROVED_MEMORY_REQUIRED:"Menunggu memory approved. Status queued pada draft belum berarti ada job indexing.",
  MEMORY_OWNER_REVIEW_REQUIRED:"Owner perlu meninjau candidate terlebih dahulu.",
  MEMORY_INDEX_READY:"Vector dan acknowledgement job tersimpan dalam satu transaksi.",MEMORY_INDEX_QUEUED:"Job indexing tersimpan; worker dapat dijalankan secara eksplisit.",
  MEMORY_INDEX_RUNNING:"Job sedang memiliki lease worker aktif.",MEMORY_INDEX_DEAD:"Batas retry habis. Kegagalan tetap tersimpan untuk ditinjau.",MEMORY_INDEX_JOB_MISSING:"Job indexing yang sesuai belum ditemukan; belum dapat mengklaim indexing berhasil.",
  ELIGIBLE_COMPLETED_EVALUATION_REQUIRED:"Sumber harus evaluasi final terbaru yang sudah direview dan completed, dengan fakta masih sesuai.",
  FAKE_MEMORY_DISABLED:"Konfigurasi provider Memory diperlukan pada server development."};
async function api(query="",body?:unknown){const r=await fetch(`/api/dev/memories${query}`,{method:body?"POST":"GET",headers:{"Content-Type":"application/json"},cache:"no-store",...(body?{body:JSON.stringify(body)}:{})});const value:unknown=await r.json();if(!r.ok){const e=z.object({code:z.string()}).safeParse(value);throw new Error(e.success?e.data.code:"MEMORY_PERSISTENCE_UNAVAILABLE");}return value;}
export function MemoryWorkspace(){
  const[list,setList]=useState<z.infer<typeof List>>({campaigns:[],memories:[]});const[source,setSource]=useState<z.infer<typeof MemorySourceSchema>|null>(null);
  const[entries,setEntries]=useState<z.infer<typeof MemoryViewSchema>[]>([]);const[selected,setSelected]=useState("");const[scenario,setScenario]=useState<"valid"|"invalid"|"failure"|"missing_evidence">("valid");
  const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[notice,setNotice]=useState("");const[confirm,setConfirm]=useState(false);const[query,setQuery]=useState("pengeluaran promosi dan checklist preorder");const[retrieval,setRetrieval]=useState("");
  const[sourceCurrent,setSourceCurrent]=useState(false);
  const[worker,setWorker]=useState<z.infer<typeof MemoryWorkerResultSchema>|null>(null);const[historyResult,setHistoryResult]=useState<z.infer<typeof BuildBusinessContextInputSchema.shape.history>|null>(null);
  const lock=useRef(false);const pending=useRef<{signature:string;requestId:string}|null>(null);const current=entries.find((m)=>m.row.id===selected)??entries[0];
  const fail=useCallback((e:unknown)=>{const code=e instanceof Error?e.message:"MEMORY_PERSISTENCE_UNAVAILABLE";setError(errors[code]??"Hasil belum dapat dipastikan. Muat ulang atau ulangi payload yang sama untuk rekonsiliasi.");},[]);
  const load=useCallback(async(id:string)=>{const value=Campaign.parse(await api(`?campaignId=${id}`));setSourceCurrent(value.source!==null);setSource(value.source??value.memories[0]?.row.lessons_json.source??null);setEntries(value.memories);setConfirm(false);if(value.sourceError)setNotice("Sumber saat ini tidak eligible atau belum tersedia. Snapshot candidate tersimpan tetap dapat dibaca.");const url=new URL(location.href);url.searchParams.set("campaignId",id);history.replaceState(null,"",url);},[]);
  useEffect(()=>{let active=true;void api().then(async(raw)=>{if(!active)return;setList(List.parse(raw));const params=new URL(location.href).searchParams;const id=params.get("campaignId");if(id)await load(id);else if(params.has("memoryId")){const stored=MemoryViewSchema.parse(await api(`?memoryId=${params.get("memoryId")}`));await load(stored.row.campaign_id);setSelected(stored.row.id);}}).catch(fail);return()=>{active=false;};},[load,fail]);
  async function run(work:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError("");setNotice("");try{await work();}catch(e){fail(e);}finally{lock.current=false;setBusy(false);}}
  function requestId(signature:string){if(pending.current?.signature!==signature)pending.current={signature,requestId:crypto.randomUUID()};return pending.current.requestId;}
  return <main lang="id" className="discussion-workspace"><div className="discussion-container"><header><Link href="/dev/evaluations">Kembali ke evaluasi</Link><h1>Business Memory</h1>
    <p className="discussion-mode">DEVELOPMENT · Fake Memory · candidate sintetis tidak eligible untuk approval produksi. Auth dan penyimpanan Supabase nyata.</p><p><Link href="/dev/discussion">Login & AI Strategist</Link></p></header>
    {error&&<p className="discussion-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <div className="discussion-layout"><aside><h2>Campaign completed</h2><ul className="discussion-sessions">{list.campaigns.map((c)=><li key={c.id}><button disabled={busy} onClick={()=>void run(async()=>{await load(c.id);setSelected("");})}>{c.name} · {c.id.slice(0,8)}</button></li>)}</ul>{!list.campaigns.length&&<p>Finalisasi campaign melalui evaluasi terlebih dahulu.</p>}</aside>
    <section className="evaluation-detail" aria-label="Memory campaign">{!source&&<p>Pilih campaign completed untuk membangun candidate dari fakta evaluasinya.</p>}
    {source&&<><h2>Pembelajaran dari evaluasi tersimpan</h2><p data-memory-source>SIMULASI · source v{source.sourceVersion} · {source.evaluationId}</p>{!sourceCurrent&&<p data-memory-archived>Snapshot sumber tersimpan; validitas sumber saat ini belum terpenuhi.</p>}<p>{source.objective}</p>
      <p><Link href={`/dev/evaluations?campaignId=${source.campaignId}`}>Buka evaluasi dan audit penyelesaian</Link></p>
      <dl className="discussion-numbers"><div><dt>Target / pengamatan simulasi</dt><dd>{source.results.plannedAdditionalUnits} / {source.results.observed.paidUnitsInWindow??"Belum diketahui"}</dd></div>
      <div><dt>Pengeluaran direview (IDR)</dt><dd>{source.results.actualPromotionSpendIdr??"Belum diketahui"}</dd></div><div><dt>Kontribusi simulasi (IDR)</dt><dd>{source.results.contributionIdr??"Belum diketahui"}</dd></div>
      <div><dt>Checklist manual</dt><dd>{source.results.completedTasks} / {source.results.totalTasks}</dd></div></dl>
      <label>Skenario Fake Memory<select id="memory-provider" value={scenario} disabled={busy} onChange={(e)=>setScenario(z.enum(["valid","invalid","failure","missing_evidence"]).parse(e.target.value))}><option value="valid">Valid</option><option value="failure">Provider gagal</option><option value="invalid">Output invalid</option><option value="missing_evidence">Bukti tidak lengkap</option></select></label>
      <button id="memory-generate" disabled={busy||!sourceCurrent||entries.length>0} onClick={()=>void run(async()=>{const signature=JSON.stringify({action:"generate",id:source.evaluationId,hash:source.contextHash,scenario});const result=MemoryViewSchema.parse(await api("",{action:"generate",campaignId:source.campaignId,evaluationId:source.evaluationId,expectedContextHash:source.contextHash,scenario,requestId:requestId(signature)}));pending.current=null;await load(source.campaignId);setSelected(result.row.id);setNotice("Candidate draft tersimpan. Tidak ada approval atau indexing otomatis.");})}>Generate candidate draft</button>
      {entries.length>0&&<p>Satu candidate disimpan per evaluation/source version. Riwayat revisi immutable memerlukan kontrak database tambahan.</p>}
      <ul className="evaluation-history">{entries.map((m)=><li key={m.row.id}><button className="discussion-secondary" data-memory-select={m.row.id} onClick={()=>{setSelected(m.row.id);setConfirm(false);}}>{m.row.review_status} · {m.row.lessons_json.ownerReview.decision} · {m.row.id.slice(0,8)}</button></li>)}</ul>
      {current&&<article className="evaluation-report" data-memory-report><h3>Candidate {current.row.id.slice(0,8)}</h3><p data-memory-state>{current.row.review_status} · {current.row.lessons_json.ownerReview.decision} · embedding {current.row.embedding_status} · {current.stale?"sumber usang":"sumber sesuai"}</p>
        <p>{current.row.summary_text}</p><h4>Pembelajaran dan rekomendasi</h4><ul>{[...current.row.lessons_json.interpretation.lessons,...current.row.lessons_json.interpretation.risks,...current.row.lessons_json.interpretation.recommendations].map((text,i)=><li key={i}>{text}</li>)}</ul>
        <h4>Keterbatasan sumber</h4><ul>{current.row.limitations_json.map((text)=><li key={text}>{text}</li>)}</ul>
        <label><input id="memory-review-confirm" type="checkbox" checked={confirm} onChange={(e)=>setConfirm(e.target.checked)}/> Saya telah meninjau fakta, pembelajaran, dan provenance sintetis ini.</label>
        {(["reviewed","rejected"] as const).map((decision)=><button key={decision} id={`memory-${decision}`} disabled={busy||!confirm||current.stale||current.row.review_status!=="draft"} onClick={()=>void run(async()=>{const signature=JSON.stringify({action:"review",id:current.row.id,hash:current.row.content_hash,decision});await api("",{action:"review",memoryId:current.row.id,expectedContentHash:current.row.content_hash,decision,confirm:true,requestId:requestId(signature)});pending.current=null;await load(source.campaignId);setNotice("Keputusan review draft tersimpan; candidate tetap belum approved.");})}>{decision==="reviewed"?"Simpan review draft":"Tandai tidak digunakan"}</button>)}
        <h4>Approval dan indexing</h4><ul data-memory-blockers>{current.approval.blockers.map((code)=><li key={code}>{errors[code]??code}</li>)}</ul>
        <button id="memory-approve" disabled={busy||!confirm||!current.approval.eligible} onClick={()=>void run(async()=>{await api("",{action:"approve",memoryId:current.row.id,expectedContentHash:current.row.content_hash,confirm:true});await load(source.campaignId);setNotice("Approval dan enqueue job terkonfirmasi dari database.");})}>{current.approval.eligible?"Approve candidate dan antrekan indexing":"Approval tidak tersedia untuk sumber ini"}</button><p data-memory-indexing>{errors[current.indexing.code]??"Status indexing belum dapat dipastikan."}</p>
        {current.indexing.job&&<p data-memory-job>Job {current.indexing.job.id} · {current.indexing.job.status} · attempt {current.indexing.job.attempt_count} {current.indexing.job.last_error_code??""}</p>}
        <button id="memory-refresh" className="discussion-secondary" disabled={busy} onClick={()=>void run(()=>load(source.campaignId))}>Muat ulang candidate</button>
      </article>}</>}
      <h2>Worker indexing lokal</h2><p>Menjalankan maksimal satu job memory approved yang kompatibel untuk usaha ini. Job pembayaran dan email tidak diambil.</p>
      <button id="memory-run-worker" disabled={busy} onClick={()=>void run(async()=>{setWorker(MemoryWorkerResultSchema.parse(await api("",{action:"run_worker"})));if(source)await load(source.campaignId);})}>Jalankan worker memory</button>
      {worker&&<p data-memory-worker role="status">{worker.status==="idle"?"Worker idle: tidak ada job approved yang kompatibel. Ini bukan indexing sukses.":`${worker.claimed} job diklaim; ${worker.succeeded} tersimpan, ${worker.failed} gagal. Periksa status job setelah refresh.`}</p>}
      <h2>Riwayat yang tersedia untuk strategi berikutnya</h2><p>Hanya memory approved, ready, kompatibel, dan dengan sumber eligible yang dapat menjadi bukti historis. Embedding hanya dipakai untuk memory approved dengan sumber eligible.</p>
      <label>Pencarian pembelajaran<input id="memory-query" value={query} maxLength={1200} onChange={(e)=>setQuery(e.target.value)}/></label>
      <button id="memory-retrieve" disabled={busy||query.trim().length<3} onClick={()=>void run(async()=>{const r=z.object({history:BuildBusinessContextInputSchema.shape.history}).parse(await api("",{action:"retrieve",query,limit:3}));setRetrieval(r.history.status);setHistoryResult(r.history);})}>Periksa sumber historis</button>
      <p data-memory-retrieval>{retrieval==="cold_start"?"Cold-start: belum ada memory approved yang eligible untuk profil ini. Candidate sintetis tidak diambil.":retrieval==="unavailable"?"Retrieval unavailable. Ini tidak berarti usaha tidak memiliki sejarah.":retrieval==="no_match"?"Memory eligible ada, tetapi tidak ada hasil yang melewati ambang relevansi.":retrieval==="available"?"Sumber historis eligible tersedia.":"Belum ada pencarian."}</p>
      {historyResult?.status==="available"&&<ul data-memory-results>{historyResult.memories.map(m=><li key={m.memoryId}><Link href={`/dev/memories?memoryId=${m.memoryId}`}>Memory {m.memoryId} · source v{m.sourceVersion}</Link><p>{m.summary}</p><Link href={`/dev/evaluations?campaignId=${m.campaignId}`}>Evaluasi sumber</Link></li>)}</ul>}
      <p><Link href="/dev/discussion">Buka diskusi berikutnya dengan fakta preorder terbaru</Link></p>
    </section></div></div></main>;
}
