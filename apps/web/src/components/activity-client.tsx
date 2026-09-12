'use client';
import { Check, Copy, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Activity { id:string; kind:string; status:string; origin:string; attempt:number; error:string|null; novelTitle:string|null; chapterTitle:string|null; createdAt:number; updatedAt:number }
interface Health { healthy:boolean; heartbeatAt:number|null }
interface JobEvent { id:number; jobId:string; attempt:number; level:'info'|'error'; message:string; details:string|null; createdAt:number }
function isActivityList(value:unknown):value is Activity[]{return Array.isArray(value)&&value.every(item=>!!item&&typeof item==='object'&&'id' in item&&'status' in item&&'updatedAt' in item);}
function isHealth(value:unknown):value is Health{return !!value&&typeof value==='object'&&'healthy' in value&&typeof value.healthy==='boolean';}
function isEventList(value:unknown):value is JobEvent[]{return Array.isArray(value)&&value.every(item=>!!item&&typeof item==='object'&&typeof item.id==='number'&&typeof item.jobId==='string'&&typeof item.attempt==='number'&&(item.level==='info'||item.level==='error')&&typeof item.message==='string'&&(item.details===null||typeof item.details==='string')&&typeof item.createdAt==='number');}
function errorMessage(error:unknown):string{return error instanceof Error?error.message:'Request failed. Please try again.';}
async function requestJson(url:string,signal:AbortSignal,method='GET'):Promise<unknown>{
  const response=await fetch(url,{cache:'no-store',signal,method});
  if(!response.ok){
    let message=`Request failed (HTTP ${response.status}).`;
    try{
      const body:unknown=await response.json();
      if(body&&typeof body==='object'&&'error' in body&&body.error&&typeof body.error==='object'&&'message' in body.error&&typeof body.error.message==='string')message=`${body.error.message} (HTTP ${response.status})`;
    }catch{/* Non-JSON errors still expose the HTTP status. */}
    throw new Error(message);
  }
  return response.json();
}

function JobDetails({item,refresh}:{item:Activity;refresh:number}){
  const [events,setEvents]=useState<JobEvent[]|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [copied,setCopied]=useState(false);
  const [copyError,setCopyError]=useState<string|null>(null);
  const request=useRef<AbortController|null>(null);
  const load=useCallback(async()=>{
    if(request.current)return;
    const controller=new AbortController();request.current=controller;setLoading(true);
    try{
      const value=await requestJson(`/api/jobs/${encodeURIComponent(item.id)}/events`,controller.signal);
      if(!isEventList(value))throw new Error('Invalid job events response. Please refresh to try again.');
      if(!controller.signal.aborted){setEvents(value);setError(null);}
    }catch(cause){if(!controller.signal.aborted)setError(errorMessage(cause));}
    finally{if(request.current===controller){request.current=null;if(!controller.signal.aborted)setLoading(false);}}
  },[item.id]);
  useEffect(()=>{void load();},[load,refresh]);
  useEffect(()=>()=>{request.current?.abort();request.current=null;},[]);
  useEffect(()=>{if(!copied)return;const timer=window.setTimeout(()=>setCopied(false),2000);return()=>clearTimeout(timer);},[copied]);
  async function copyErrorLog(){
    setCopied(false);setCopyError(null);
    const errors=events?.filter(event=>event.level==='error')??[];
    const log=errors.length?errors.map(event=>`[${new Date(event.createdAt).toISOString()}] Attempt ${event.attempt}\n${event.message}${event.details?`\n${event.details}`:''}`).join('\n\n'):item.error;
    if(!log)return;
    try{
      await navigator.clipboard.writeText(`Job: ${item.id}\nKind: ${item.kind}\n\n${log}`);
      setCopied(true);
    }catch{setCopyError('Could not copy the error log. Allow clipboard access or select and copy the diagnostic text below.');}
  }
  return <div className="activity-details" id={`job-details-${item.id}`}>
    <dl className="activity-metadata"><div><dt>Job ID</dt><dd><code>{item.id}</code></dd></div><div><dt>Attempt</dt><dd>{item.attempt}</dd></div><div><dt>Created</dt><dd>{new Date(item.createdAt).toLocaleString()}</dd></div><div><dt>Updated</dt><dd>{new Date(item.updatedAt).toLocaleString()}</dd></div></dl>
    <div className="toolbar"><strong>Event timeline</strong><span className="muted">Most recent 200 events, oldest first</span><button className="btn" aria-label={copied?'Error log copied':'Copy error log'} title={copied?'Copied':'Copy error log'} disabled={events===null||(!item.error&&!events.some(event=>event.level==='error'))} onClick={()=>void copyErrorLog()}>{copied?<Check size={16}/>:<Copy size={16}/>}</button></div>
    {copyError&&<div className="error" role="alert">{copyError}</div>}
    {error&&<div className="error" role="alert">Could not load job events: {error} {events&&'Showing previously loaded events.'}<button className="btn" disabled={loading} onClick={()=>void load()}>Retry loading</button></div>}
    {events?.length===0&&<p className="muted">No recorded events for this job. Historical jobs have no diagnostic logs; retry a failed job to capture diagnostics for a new attempt.</p>}
    {!!events?.length&&<ol className="activity-events">{events.map(event=><li key={event.id} className={`activity-event activity-event-${event.level}`}><div className="toolbar muted"><time dateTime={new Date(event.createdAt).toISOString()}>{new Date(event.createdAt).toLocaleString()}</time><span className={`job-status ${event.level==='error'?'failed':''}`}>{event.level}</span><span>Attempt {event.attempt}</span></div><pre className="activity-log">{event.message}{event.details?`\n${event.details}`:''}</pre></li>)}</ol>}
  </div>;
}

export function ActivityClient(){
  const [items,setItems]=useState<Activity[]>([]);const [healthy,setHealthy]=useState(true);const [filter,setFilter]=useState('all');const [page,setPage]=useState(1);
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set());const [refresh,setRefresh]=useState(0);
  const [loaded,setLoaded]=useState(false);const [activityError,setActivityError]=useState<string|null>(null);const [healthError,setHealthError]=useState<string|null>(null);
  const [pending,setPending]=useState<Set<string>>(()=>new Set());const [actionErrors,setActionErrors]=useState<Record<string,string>>({});
  const request=useRef<AbortController|null>(null);const actions=useRef(new Map<string,AbortController>());
  const load=useCallback(async(force=false)=>{
    if(request.current&&!force)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;setRefresh(value=>value+1);
    await Promise.all([
      (async()=>{try{const value=await requestJson('/api/activity?limit=250',controller.signal);if(!isActivityList(value))throw new Error('Invalid activity response.');if(!controller.signal.aborted){setItems(value);setLoaded(true);setActivityError(null);}}catch(cause){if(!controller.signal.aborted)setActivityError(errorMessage(cause));}})(),
      (async()=>{try{const value=await requestJson('/api/health',controller.signal);if(!isHealth(value))throw new Error('Invalid worker health response.');if(!controller.signal.aborted){setHealthy(value.healthy);setHealthError(null);}}catch(cause){if(!controller.signal.aborted)setHealthError(errorMessage(cause));}})(),
    ]);
    if(request.current===controller)request.current=null;
  },[]);
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),3000);const activeActions=actions.current;return()=>{clearInterval(timer);request.current?.abort();request.current=null;for(const controller of activeActions.values())controller.abort();activeActions.clear();};},[load]);
  async function act(id:string,action:'cancel'|'retry'){
    if(actions.current.has(id))return;
    const controller=new AbortController();actions.current.set(id,controller);setPending(value=>new Set(value).add(id));setActionErrors(value=>{const next={...value};delete next[id];return next;});
    try{
      const value=await requestJson(`/api/jobs/${encodeURIComponent(id)}/${action}`,controller.signal,'POST');
      if(action==='cancel'&&(!value||typeof value!=='object'||!('cancelled' in value)||value.cancelled!==true))throw new Error('Job could not be cancelled. It may have already finished. Refresh to see its current status.');
      if(!controller.signal.aborted)await load(true);
    }catch(cause){if(!controller.signal.aborted)setActionErrors(value=>({...value,[id]:`Could not ${action} job: ${errorMessage(cause)}`}));}
    finally{if(actions.current.get(id)===controller){actions.current.delete(id);if(!controller.signal.aborted)setPending(value=>{const next=new Set(value);next.delete(id);return next;});}}
  }
  const filtered=useMemo(()=>filter==='all'?items:items.filter(item=>item.status===filter),[items,filter]);const pages=Math.max(1,Math.ceil(filtered.length/50));const currentPage=Math.min(page,pages);const visible=filtered.slice((currentPage-1)*50,currentPage*50);
  return <><section className="hero"><div><div className="eyebrow">Background work</div><h1>Activity</h1><p className="muted">Imports, downloads, checks, and translations update here while the worker runs.</p></div><div className="toolbar"><select className="select" aria-label="Filter jobs by status" value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="all">All statuses</option><option value="queued">Queued</option><option value="running">Running</option><option value="failed">Failed</option><option value="succeeded">Succeeded</option><option value="cancelled">Cancelled</option></select><button className="btn" onClick={()=>void load(true)}><RefreshCw size={16}/> Refresh</button></div></section>
    {activityError&&<div className="error activity-notice" role="alert">Could not load activity: {activityError} {loaded&&'Showing previously loaded jobs.'} Use Refresh to try again.</div>}
    {healthError&&<div className="error activity-notice" role="alert">Could not check worker health: {healthError}</div>}
    {!healthy&&!healthError&&<div className="error activity-notice">Worker offline: queued jobs will not run until a recent heartbeat is recorded.</div>}
    <section className="panel">{visible.length===0?(loaded?<div className="empty">No matching jobs.</div>:null):visible.map(item=><div className="activity-row" key={item.id}><div><span className={`job-status ${item.status}`}>{item.status}</span><div className="muted" style={{fontSize:12,marginTop:4}}>{new Date(item.createdAt).toLocaleString()}</div></div><div><strong>{item.kind.replaceAll('_',' ')}</strong><div className="muted">{item.chapterTitle??item.novelTitle??item.origin}{item.error?` · ${item.error}`:''}</div></div><div className="toolbar activity-actions"><button className="btn" aria-expanded={expanded.has(item.id)} aria-controls={`job-details-${item.id}`} onClick={()=>setExpanded(value=>{const next=new Set(value);if(next.has(item.id))next.delete(item.id);else next.add(item.id);return next;})}>{expanded.has(item.id)?'Hide details':'Details'}</button>{(item.status==='queued'||item.status==='running')&&<button className="btn danger" disabled={pending.has(item.id)} onClick={()=>void act(item.id,'cancel')} title="Cancel" aria-label="Cancel job"><XCircle size={16}/></button>}{item.status==='failed'&&<button className="btn" disabled={pending.has(item.id)} onClick={()=>void act(item.id,'retry')}><RotateCcw size={16}/> Retry</button>}{pending.has(item.id)&&<span className="muted" role="status">Updating job…</span>}</div>{actionErrors[item.id]&&<div className="error activity-action-error" role="alert">{actionErrors[item.id]}</div>}{expanded.has(item.id)&&<JobDetails item={item} refresh={refresh}/>}</div>)}{pages>1&&<div className="toolbar" style={{justifyContent:'center',marginTop:16}}><button className="btn" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Previous</button><span>{currentPage} / {pages}</span><button className="btn" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>Next</button></div>}</section>
  </>;
}
