import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import {
  onInstallProgress,
  runtimesAvailable,
  runtimesInstall,
  runtimesList,
  runtimesRemove,
  type IndexEntry,
  type LanguageId,
  type RuntimeInfo,
  type RuntimeInstallProgress,
} from '../lib/runtimes';

const languages: LanguageId[] = ['PYTHON', 'C', 'CPP', 'JAVA'];
const prettyError = (value: unknown) => {
  const message = value instanceof Error ? value.message : String(value);
  const code = message.split(':')[0];
  return ({
    PACK_KEY_NOT_CONFIGURED: 'Runtime signing key is not configured in this app build.',
    SIGNATURE_INVALID: 'The runtime signature could not be verified.',
    HASH_MISMATCH: 'The downloaded runtime does not match the published checksum.',
    UNSAFE_ARCHIVE: 'The runtime archive contains an unsafe file.',
    SMOKE_TEST_FAILED: 'The runtime failed its startup check.',
    NETWORK: 'Could not download the runtime. Check your connection and try again.',
  } as Record<string, string>)[code] ?? message;
};

export function RuntimeManager() {
  const [available, setAvailable] = useState<IndexEntry[]>([]);
  const [installed, setInstalled] = useState<RuntimeInfo[]>([]);
  const [progress, setProgress] = useState<Record<LanguageId, RuntimeInstallProgress | undefined>>({} as Record<LanguageId, RuntimeInstallProgress | undefined>);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [a, i] = await Promise.all([runtimesAvailable(), runtimesList()]); setAvailable(a); setInstalled(i); }
    catch (e) { setError(prettyError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); let unlisten: (() => void) | undefined; let active = true;
    void onInstallProgress((p) => setProgress((all) => ({ ...all, [p.language]: p }))).then((fn) => { if (active) unlisten = fn; else fn(); }).catch((e) => { if (active) setError(prettyError(e)); });
    return () => { active = false; unlisten?.(); };
  }, [refresh]);
  const latest = useMemo(() => {
    const map = new Map<LanguageId, IndexEntry>();
    for (const p of [...available].sort((a,b) => a.version.localeCompare(b.version))) map.set(p.language,p);
    return map;
  }, [available]);
  const install = async (language: LanguageId) => {
    setError(null); setProgress((all) => ({ ...all, [language]: { language, stage:'download', receivedBytes:0, totalBytes:0, message:'Starting' } }));
    try { await runtimesInstall(language); await refresh(); }
    catch (e) { setError(prettyError(e)); }
    finally { setProgress((all) => ({ ...all, [language]: undefined })); }
  };
  const remove = async (item: RuntimeInfo) => {
    setError(null); try { await runtimesRemove(item.language,item.version); await refresh(); } catch (e) { setError(prettyError(e)); }
  };
  return <section className="sv-card" aria-labelledby="runtime-manager-title">
    <div className="sv-card-head"><div><h2 id="runtime-manager-title">Language runtimes</h2><p>Install the tools needed to run code offline. They stay inside this app’s data folder.</p></div>
      <button className="btn" onClick={() => void refresh()} disabled={loading} aria-label="Refresh runtimes"><RefreshCw size={15}/> Refresh</button></div>
    {error && <p role="alert" className="error-text">{error}</p>}
    {loading ? <p>Loading runtimes…</p> : <div className="sv-list">
      {languages.map((language) => {
        const target=latest.get(language);const have=installed.filter((x)=>x.language===language);const current=progress[language];
        return <article className="sv-card sv-card-compact" key={language}>
          <div className="sv-card-head"><div><strong>{language}</strong><p>{have.length ? have.map((x)=>x.version).join(', ') : 'Not installed'}</p></div>
            <button className="btn btn-primary" disabled={!target || Boolean(current)} onClick={() => void install(language)}><Download size={15}/> Install{target?` ${target.version}`:''}</button></div>
          {current && <div aria-live="polite"><p>{current.message} · {current.stage}</p><progress aria-label={`${language} install progress`} max={current.totalBytes || 1} value={Math.min(current.receivedBytes,current.totalBytes || 1)}/></div>}
          {have.map((item)=><div className="sv-card-head" key={item.version}><span>{item.version}</span><button className="btn" onClick={() => void remove(item)}><Trash2 size={14}/> Remove</button></div>)}
        </article>;
      })}
    </div>}
  </section>;
}
