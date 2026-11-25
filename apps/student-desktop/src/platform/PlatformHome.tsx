import { useEffect, useState } from 'react';
import { installPackFromBroker, listCatalog, packsImportFile, packsList, type PackInfo } from '../lib/packs';
import type { CatalogEntry } from '../lib/catalog';
import { OFFLINE_FIRST } from '../lib/offline-config';
import { CourseView } from './CourseView';
import './platform.css';

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function PlatformHome() {
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [selected, setSelected] = useState<PackInfo | null>(null);
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    void packsList()
      .then(setPacks)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const browse = () => {
    setCatalogBusy(true);
    setError('');
    void listCatalog()
      .then(setCatalog)
      .catch((e) => setError(navigator.onLine ? String(e) : 'You are offline. Connect to the internet to browse the catalog.'))
      .finally(() => setCatalogBusy(false));
  };

  const install = (entry: CatalogEntry) => {
    setInstalling(entry.packId);
    setError('');
    void installPackFromBroker(entry.packId)
      .then(() => {
        refresh();
        browse();
      })
      .catch((e) => setError(String(e)))
      .finally(() => setInstalling(null));
  };

  if (selected)
    return (
      <CourseView
        pack={selected}
        onBack={() => {
          setSelected(null);
          refresh();
        }}
      />
    );

  return (
    <section className="platform-page">
      <header className="platform-head">
        <div>
          <p className="platform-eyebrow">OFFLINE LEARNING</p>
          <h1>Platform</h1>
          <p>Your installed course packs work without a network connection.</p>
        </div>
      </header>
      <div className="platform-actions">
        <label>
          Import pack file (.lpack)
          <input aria-label="Pack file path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Paste full path to a .lpack file" />
        </label>
        <button
          className="btn btn-primary"
          disabled={!path}
          onClick={() =>
            void packsImportFile(path)
              .then(() => {
                setPath('');
                setError('');
                refresh();
              })
              .catch((e) => setError(String(e)))
          }
        >
          Import pack file
        </button>
        {OFFLINE_FIRST ? (
          <button className="btn" onClick={browse} disabled={catalogBusy}>
            {catalogBusy ? 'Loading catalog…' : 'Browse catalog'}
          </button>
        ) : (
          <>
            <button className="btn" disabled title="Available when online sync is connected">
              Browse catalog
            </button>
            <span>Available when online sync is connected</span>
          </>
        )}
      </div>
      {error && (
        <p className="platform-error" role="alert">
          {error}
        </p>
      )}
      {catalog && (
        <section className="platform-topic" aria-label="Course catalog">
          <h2>Catalog</h2>
          {catalog.length === 0 ? (
            <p>No published courses are available to you yet.</p>
          ) : (
            <div className="platform-question-list">
              {catalog.map((c) => (
                <div className="platform-question" key={c.courseId}>
                  <strong>{c.title}</strong>
                  <span>
                    Version {c.version} · {mb(c.size)} · {c.languages.join(' · ')}
                  </span>
                  {c.state === 'INSTALLED' ? (
                    <small>Installed</small>
                  ) : (
                    <button className="btn btn-sm" disabled={installing !== null} onClick={() => install(c)}>
                      {installing === c.packId ? 'Downloading…' : c.state === 'UPDATE_AVAILABLE' ? `Update from version ${c.installedVersion}` : 'Download'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {loading ? (
        <p>Loading installed packs…</p>
      ) : packs.length === 0 ? (
        <div className="platform-empty">
          <h2>No course packs installed</h2>
          <p>{OFFLINE_FIRST ? 'Browse the catalog while online, or import a signed .lpack file from your college.' : 'Import a signed .lpack file from your school to start learning offline.'}</p>
        </div>
      ) : (
        <div className="platform-grid">
          {packs
            .filter((p) => p.kind === 'COURSE')
            .map((p) => (
              <button className="platform-pack" key={p.packId} onClick={() => setSelected(p)}>
                <span className="platform-eyebrow">
                  {p.kind} · VERSION {p.version}
                </span>
                <h2>{p.title}</h2>
                <p>{p.questionCount} questions</p>
                <small>{p.languages.join(' · ')}</small>
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
