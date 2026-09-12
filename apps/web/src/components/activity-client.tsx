'use client';
import { RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface Activity { id:string; kind:string; status:string; origin:string; attempt:number; error:string|null; novelTitle:string|null; chapterTitle:string|null; createdAt:number }
interface Health { healthy:boolean; heartbeatAt:number|null }
function isActivityList(value:unknown):value is Activity[]{return Array.isArray(value)&&value.every(item=>!!item&&typeof item==='object'&&'id' in item&&'status' in item);}
function isHealth(value:unknown):value is Health{return !!value&&typeof value==='object'&&'healthy' in value;}

export function ActivityClient(){
  const [items,setItems]=useState<Activity[]>([]);const [healthy,setHealthy]=useState(true);const [filter,setFilter]=useState('all');const [page,setPage]=useState(1);
  const load=useCallback(async()=>{const [activityResponse,healthResponse]=await Promise.all([fetch('/api/activity?limit=500',{cache:'no-store'}),fetch('/api/health',{cache:'no-store'})]);const activityValue:unknown=await activityResponse.json();const healthValue:unknown=await healthResponse.json();if(activityResponse.ok&&isActivityList(activityValue))setItems(activityValue);if(healthResponse.ok&&isHealth(healthValue))setHealthy(healthValue.healthy);},[]);
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),3000);return()=>clearInterval(timer);},[load]);
  async function cancel(id:string){await fetch(`/api/jobs/${id}/cancel`,{method:'POST'});void load();}
  async function retry(id:string){await fetch(`/api/jobs/${id}/retry`,{method:'POST'});void load();}
  const filtered=useMemo(()=>filter==='all'?items:items.filter(item=>item.status===filter),[items,filter]);const pages=Math.max(1,Math.ceil(filtered.length/50));const visible=filtered.slice((page-1)*50,page*50);
  return <><section className="hero"><div><div className="eyebrow">Background work</div><h1>Activity</h1><p className="muted">Imports, downloads, checks, and translations update here while the worker runs.</p></div><div className="toolbar"><select className="select" value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="all">All statuses</option><option value="queued">Queued</option><option value="running">Running</option><option value="failed">Failed</option><option value="succeeded">Succeeded</option><option value="cancelled">Cancelled</option></select><button className="btn" onClick={()=>void load()}><RefreshCw size={16}/> Refresh</button></div></section>
    {!healthy&&<div className="error" style={{marginBottom:18}}>Worker offline: queued jobs will not run until a recent heartbeat is recorded.</div>}
    <section className="panel">{visible.length===0?<div className="empty">No matching jobs.</div>:visible.map(item=><div className="activity-row" key={item.id}><div><span className={`job-status ${item.status}`}>{item.status}</span><div className="muted" style={{fontSize:12,marginTop:4}}>{new Date(item.createdAt).toLocaleString()}</div></div><div><strong>{item.kind.replaceAll('_',' ')}</strong><div className="muted">{item.chapterTitle??item.novelTitle??item.origin}{item.error?` · ${item.error}`:''}</div></div><div className="toolbar">{(item.status==='queued'||item.status==='running')&&<button className="btn danger" onClick={()=>void cancel(item.id)} title="Cancel"><XCircle size={16}/></button>}{item.status==='failed'&&<button className="btn" onClick={()=>void retry(item.id)}><RotateCcw size={16}/> Retry</button>}</div></div>)}{pages>1&&<div className="toolbar" style={{justifyContent:'center',marginTop:16}}><button className="btn" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><span>{page} / {pages}</span><button className="btn" disabled={page===pages} onClick={()=>setPage(page+1)}>Next</button></div>}</section>
  </>;
}
