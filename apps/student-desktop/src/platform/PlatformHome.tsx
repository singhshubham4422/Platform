import { useEffect,useState } from 'react';
import { packsImportFile,packsList,type PackInfo } from '../lib/packs';
import { CourseView } from './CourseView';
import './platform.css';

export function PlatformHome(){const [packs,setPacks]=useState<PackInfo[]>([]);const [selected,setSelected]=useState<PackInfo|null>(null);const [path,setPath]=useState('');const [error,setError]=useState('');const [loading,setLoading]=useState(true);const refresh=()=>{setLoading(true);void packsList().then(setPacks).catch(e=>setError(String(e))).finally(()=>setLoading(false))};useEffect(refresh,[]);
 if(selected)return <CourseView pack={selected} onBack={()=>{setSelected(null);refresh()}}/>;
 return <section className="platform-page"><header className="platform-head"><div><p className="platform-eyebrow">OFFLINE LEARNING</p><h1>Platform</h1><p>Your installed course packs work without a network connection.</p></div></header>
 <div className="platform-actions"><label>Import pack file (.lpack)<input aria-label="Pack file path" value={path} onChange={e=>setPath(e.target.value)} placeholder="Paste full path to a .lpack file"/></label><button className="btn btn-primary" disabled={!path} onClick={()=>void packsImportFile(path).then(()=>{setPath('');setError('');refresh()}).catch(e=>setError(String(e)))}>Import pack file</button><button className="btn" disabled title="Available when online sync is connected">Browse catalog</button><span>Available when online sync is connected</span></div>
 {error&&<p className="platform-error" role="alert">{error}</p>}{loading?<p>Loading installed packs…</p>:packs.length===0?<div className="platform-empty"><h2>No course packs installed</h2><p>Import a signed .lpack file from your school to start learning offline.</p></div>:<div className="platform-grid">{packs.map(p=><button className="platform-pack" key={p.packId} onClick={()=>setSelected(p)}><span className="platform-eyebrow">{p.kind} · VERSION {p.version}</span><h2>{p.title}</h2><p>{p.questionCount} questions</p><small>{p.languages.join(' · ')}</small></button>)}</div>}</section>
}
