'use client';
import Link from 'next/link';
import { BookPlus, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface Novel { id:string; displayTitle:string; sourceTitle:string; author:string|null; sourceId:string; chapterCount:number; downloadedCount:number; translatedCount:number; currentChapterId:string|null; coverUrl:string|null; updatedAt:number }
function isNovel(value:unknown):value is Novel{return !!value&&typeof value==='object'&&'id' in value&&'displayTitle' in value&&'chapterCount' in value;}

export function LibraryClient() {
  const [novels,setNovels]=useState<Novel[]>([]);const [search,setSearch]=useState('');const [open,setOpen]=useState(false);const [url,setUrl]=useState('');const [includeStart,setIncludeStart]=useState(true);const [message,setMessage]=useState('');const [error,setError]=useState('');
  const [title,setTitle]=useState('');const [description,setDescription]=useState('');const [chapterNumber,setChapterNumber]=useState('');const [pending,setPending]=useState(false);
  const load=useCallback(async()=>{const response=await fetch(`/api/novels?search=${encodeURIComponent(search)}`,{cache:'no-store'});const value:unknown=await response.json();if(response.ok&&Array.isArray(value)&&value.every(isNovel))setNovels(value);},[search]);
  useEffect(()=>{void load();},[load]);
  async function submit(event:React.FormEvent){
    event.preventDefault();
    if(pending)return;
    setError('');
    const trimmedTitle=title.trim();const trimmedDescription=description.trim();const number=Number(chapterNumber);
    if(!trimmedTitle||trimmedTitle.length>300){setError('Enter a novel title of 1–300 characters.');return;}
    if(trimmedDescription.length>10000){setError('Description must be 10,000 characters or fewer.');return;}
    if(!chapterNumber.trim()||!Number.isSafeInteger(number)||number<1){setError('Enter a positive whole chapter number no greater than 9,007,199,254,740,991.');return;}
    let parsed:URL;try{parsed=new URL(url);}catch{setError('Enter a valid chapter URL.');return;}
    if(parsed.protocol!=='https:'||!['piaotia.com','www.piaotia.com'].includes(parsed.hostname)){setError('Enter a supported HTTPS piaotia.com chapter URL.');return;}
    setPending(true);
    try{
      const response=await fetch('/api/imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,includeStart,title:trimmedTitle,description:trimmedDescription||null,chapterNumber:number})});
      if(!response.ok){
        const value:unknown=await response.json().catch(()=>null);
        const apiError=value&&typeof value==='object'&&'error' in value?value.error:null;
        setError(apiError&&typeof apiError==='object'&&'message' in apiError&&typeof apiError.message==='string'?apiError.message:'Import request was rejected. Please try again.');
        return;
      }
      setMessage('Import queued. Chapters will appear as the worker downloads them.');setOpen(false);setUrl('');setTitle('');setDescription('');setChapterNumber('');setIncludeStart(true);window.setTimeout(()=>void load(),1500);
    }catch{setError('Could not reach the server. Check your connection and try again.');}
    finally{setPending(false);}
  }
  return <>
    <section className="hero"><div><div className="eyebrow">Your private shelf</div><h1>Stories, gathered and translated.</h1><p className="muted">Import a Chinese chapter URL, keep your place, and switch cleanly between English and 中文.</p></div><button className="btn primary" onClick={()=>setOpen(true)}><BookPlus size={17}/> Add novel</button></section>
    <div className="toolbar" style={{marginBottom:22}}><label style={{position:'relative',maxWidth:380,width:'100%'}}><Search size={17} style={{position:'absolute',left:12,top:12,color:'#777'}}/><input className="input" style={{paddingLeft:38}} placeholder="Search title or author" value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
    {message&&<p className="notice">{message}</p>}
    {novels.length===0?<div className="empty"><h2>No books on this shelf</h2><p>Import a chapter URL to create your first library entry.</p></div>:<div className="grid">{novels.map(novel=><Link className="card novel-card" href={`/novels/${novel.id}`} key={novel.id}><div className="cover">{novel.coverUrl&&<img src={novel.coverUrl} alt=""/>}<div className="cover-placeholder">{novel.displayTitle}</div></div><div className="card-body"><h3>{novel.displayTitle}</h3><div className="muted">{novel.author??'Unknown author'}</div><div className="meta"><span className="badge">{novel.downloadedCount}/{novel.chapterCount} downloaded</span><span className="badge">{novel.translatedCount} translated</span>{novel.currentChapterId&&<span className="badge">Continue reading</span>}</div></div></Link>)}</div>}
    {open&&<div className="dialog-backdrop" role="presentation"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:20}}><h2 id="import-title">Import a novel</h2><button className="btn" aria-label="Close" disabled={pending} onClick={()=>setOpen(false)}><X size={17}/></button></div>
      <form className="stack" onSubmit={submit} aria-busy={pending}>
        <p className="muted" id="import-metadata-help">Enter the novel title and optional description yourself. Neither is scraped from the source.</p>
        <label className="field">Novel title<input className="input" required maxLength={300} value={title} disabled={pending} aria-describedby="import-metadata-help" onChange={event=>setTitle(event.target.value)}/></label>
        <label className="field">Description (optional)<textarea className="textarea" maxLength={10000} rows={4} value={description} disabled={pending} aria-describedby="import-metadata-help" onChange={event=>setDescription(event.target.value)}/></label>
        <label className="field">Chinese chapter URL<input className="input" type="url" required placeholder="https://www.piaotia.com/..." value={url} disabled={pending} onChange={event=>setUrl(event.target.value)}/></label>
        <label className="field">Chapter number<input className="input" type="number" required min={1} max={Number.MAX_SAFE_INTEGER} step={1} value={chapterNumber} disabled={pending} aria-describedby="import-number-help" onChange={event=>setChapterNumber(event.target.value)}/></label>
        <p className="muted" id="import-number-help">This is the number of the chapter at the supplied URL (N). The next chapter is N+1. If you exclude the submitted chapter, importing starts at N+1.</p>
        <label style={{display:'flex',gap:10,alignItems:'center'}}><input type="checkbox" checked={includeStart} disabled={pending} onChange={event=>setIncludeStart(event.target.checked)}/> Include the submitted chapter</label>
        {error&&<div className="error" role="alert">{error}</div>}
        <button className="btn primary" type="submit" disabled={pending}>{pending?'Queueing import…':'Queue import'}</button>
      </form>
    </div></div>}
  </>;
}
