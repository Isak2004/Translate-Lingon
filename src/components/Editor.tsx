import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { TranslationRow } from './TranslationRow';
import { ThemeToggle } from './ThemeToggle';
import { History } from './History';
import type { Project, Translation, FlatMap, AiFinding } from '../types';

// ── JSON plattning ──

function flatten(obj: Record<string, unknown>, prefix = ''): FlatMap {
  const result: FlatMap = {};
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flatten(val as Record<string, unknown>, path));
    } else {
      result[path] = String(val ?? '');
    }
  }
  return result;
}

function unflatten(flat: FlatMap): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(flat).sort()) {
    const parts = key.split('.');
    let cur = result as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in cur)) cur[parts[i]] = {};
      cur = cur[parts[i]] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = flat[key];
  }
  return result;
}

// ── Typer för sektioner ──

interface Section {
  key: string;
  count: number;
  editedCount: number;
  missingCount: number;
}

type Filter = 'all' | 'edited' | 'missing' | 'long' | 'unreviewed' | 'ai-flagged';

export function Editor() {
  const { id } = useParams<{ id: string }>();

  const [project, setProject] = useState<Project | null>(null);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  // Redigeringsstate
  const [editedKeys, setEditedKeys] = useState<Set<string>>(new Set());
  const [pendingSaves, setPendingSaves] = useState<Map<string, string>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filter & sökning
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [activeSection, setActiveSection] = useState<string | null>(null);

  // Historik
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [historyTranslationId, setHistoryTranslationId] = useState<string | null>(null);

  // AI-granskning
  const [aiFindings, setAiFindings] = useState<AiFinding[]>([]);
  const [aiReviewing, setAiReviewing] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiDone, setAiDone] = useState(false);

  // Statusindicator
  const [saveStatus, setSaveStatus] = useState('');

  // ── Ladda projekt och översättningar ──

  useEffect(() => {
    if (!id) return;
    loadProject();
    loadTranslations();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadProject() {
    const { data } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();
    setProject(data);
  }

  async function loadTranslations() {
    // Supabase returnerar max 1000 rader per anrop — hämta alla med paginering
    let all: Translation[] = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('translations')
        .select('*')
        .eq('project_id', id)
        .order('key')
        .range(from, from + pageSize - 1);

      if (error) {
        console.error('Kunde inte ladda översättningar:', error);
        break;
      }

      all = all.concat(data ?? []);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }

    setTranslations(all);
    setLoading(false);
  }

  // ── Import av JSON-filer ──

  const [showImportModal, setShowImportModal] = useState(false);
  const [enFile, setEnFile] = useState<File | null>(null);
  const [svFile, setSvFile] = useState<File | null>(null);

  function handleImport() {
    setEnFile(null);
    setSvFile(null);
    setShowImportModal(true);
  }

  async function doImport() {
    if (!enFile || !svFile) return;
    setShowImportModal(false);
    await importFiles(enFile, svFile);
  }

  async function importFiles(enFile: File, svFile: File) {
    setImporting(true);
    try {
      const enRaw = JSON.parse(await enFile.text());
      const svRaw = JSON.parse(await svFile.text());
      const enFlat = flatten(enRaw);
      const svFlat = flatten(svRaw);
      const allKeys = [...new Set([...Object.keys(enFlat), ...Object.keys(svFlat)])].sort();

      // Hämta befintliga nycklar från databasen
      const existingByKey = new Map<string, Translation>();
      for (const t of translations) {
        existingByKey.set(t.key, t);
      }

      const toInsert: { project_id: string; key: string; source_text: string; target_text: string }[] = [];
      const toUpdate: { id: string; source_text: string }[] = [];

      for (const key of allKeys) {
        const existing = existingByKey.get(key);
        const newSourceText = enFlat[key] ?? '';
        const newTargetText = svFlat[key] ?? '';

        if (!existing) {
          // Ny nyckel → lägg till
          toInsert.push({
            project_id: id!,
            key,
            source_text: newSourceText,
            target_text: newTargetText,
          });
        } else if (existing.source_text !== newSourceText) {
          // Engelska texten har ändrats → uppdatera source + markera ogranskad
          toUpdate.push({
            id: existing.id,
            source_text: newSourceText,
          });
        }
        // Annars: ingen ändring → ignorera
      }

      // Infoga nya nycklar i batchar
      for (let i = 0; i < toInsert.length; i += 500) {
        const batch = toInsert.slice(i, i + 500);
        const { error } = await supabase.from('translations').insert(batch);
        if (error) throw error;
      }

      // Uppdatera ändrade engelska texter + sätt reviewed = false
      for (const item of toUpdate) {
        const { error } = await supabase
          .from('translations')
          .update({ source_text: item.source_text, reviewed: false })
          .eq('id', item.id);
        if (error) throw error;
      }

      // Ta bort nycklar som inte längre finns i JSON-filerna
      const importedKeySet = new Set(allKeys);
      const toDelete = translations.filter((t) => !importedKeySet.has(t.key));

      if (toDelete.length > 0) {
        const deleteIds = toDelete.map((t) => t.id);
        for (let i = 0; i < deleteIds.length; i += 500) {
          const batch = deleteIds.slice(i, i + 500);
          const { error } = await supabase
            .from('translations')
            .delete()
            .in('id', batch);
          if (error) throw error;
        }
      }

      await loadTranslations();

      const stats: string[] = [];
      if (toInsert.length > 0) stats.push(`${toInsert.length} nya`);
      if (toUpdate.length > 0) stats.push(`${toUpdate.length} uppdaterade`);
      if (toDelete.length > 0) stats.push(`${toDelete.length} borttagna`);
      const ignored = allKeys.length - toInsert.length - toUpdate.length;
      if (ignored > 0) stats.push(`${ignored} oförändrade`);
      setSaveStatus(`Import: ${stats.join(', ')}`);
    } catch (err) {
      alert('Import misslyckades: ' + (err as Error).message);
    }
    setImporting(false);
  }

  // ── Redigering med debounced sparning ──

  const handleEdit = useCallback(
    (translationId: string, key: string, newText: string) => {
      // Uppdatera lokalt state direkt
      setTranslations((prev) =>
        prev.map((t) => (t.id === translationId ? { ...t, target_text: newText } : t))
      );
      setEditedKeys((prev) => new Set(prev).add(key));

      // Köa sparning
      setPendingSaves((prev) => {
        const next = new Map(prev);
        next.set(translationId, newText);
        return next;
      });

      // Debounce
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => flushSaves(), 800);
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  async function flushSaves() {
    const saves = new Map(pendingSaves);
    if (saves.size === 0) return;
    setPendingSaves(new Map());

    setSaveStatus('Sparar...');

    for (const [translationId, newText] of saves) {
      // Hämta gammal text för historik
      const existing = translations.find((t) => t.id === translationId);
      const oldText = existing?.target_text ?? '';

      // Uppdatera översättningen
      const { error: updateError } = await supabase
        .from('translations')
        .update({ target_text: newText })
        .eq('id', translationId);

      if (updateError) {
        console.error('Sparfel:', updateError);
        setSaveStatus('Fel vid sparning!');
        return;
      }

      // Logga historik (bara om texten faktiskt ändrades)
      if (oldText !== newText) {
        await supabase.from('translation_history').insert({
          translation_id: translationId,
          old_text: oldText,
          new_text: newText,
          changed_by: 'anonymous', // TODO: koppla auth
        });
      }
    }

    const time = new Date().toLocaleTimeString('sv-SE', {
      hour: '2-digit',
      minute: '2-digit',
    });
    setSaveStatus(`Sparad ${time}`);
  }

  // ── Granskad-toggle ──

  const handleToggleReviewed = useCallback(async (translationId: string) => {
    const t = translations.find((tr) => tr.id === translationId);
    if (!t) return;

    const newValue = !t.reviewed;

    // Uppdatera lokalt direkt
    setTranslations((prev) =>
      prev.map((tr) => (tr.id === translationId ? { ...tr, reviewed: newValue } : tr))
    );

    // Spara till Supabase
    const { error } = await supabase
      .from('translations')
      .update({ reviewed: newValue })
      .eq('id', translationId);

    if (error) {
      console.error('Kunde inte uppdatera granskad-status:', error);
      // Ångra lokalt
      setTranslations((prev) =>
        prev.map((tr) => (tr.id === translationId ? { ...tr, reviewed: !newValue } : tr))
      );
    }
  }, [translations]);

  // ── Export till JSON ──

  function handleExport() {
    const flat: FlatMap = {};
    for (const t of translations) {
      flat[t.key] = t.target_text;
    }
    const nested = unflatten(flat);
    const json = JSON.stringify(nested, null, 2) + '\n';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.target_language ?? 'sv'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── AI-granskning ──

  async function handleAiReview() {
    if (translations.length === 0) return;
    setAiReviewing(true);
    setAiFindings([]);
    setShowAiPanel(true);
    setAiDone(false);

    // Filtrera bort tomma — inget att granska
    const toReview = translations.filter((t) => t.target_text && t.source_text);

    // Skicka i batchar om ~100 nycklar
    const BATCH_SIZE = 100;
    const allFindings: AiFinding[] = [];
    const totalBatches = Math.ceil(toReview.length / BATCH_SIZE);
    let failedBatches = 0;
    let lastError = '';

    for (let i = 0; i < toReview.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      setAiProgress(`Granskar batch ${batchNum} av ${totalBatches}...`);

      const batch = toReview.slice(i, i + BATCH_SIZE).map((t) => ({
        key: t.key,
        source_text: t.source_text,
        target_text: t.target_text,
      }));

      try {
        const res = await fetch('/.netlify/functions/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ translations: batch }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Okänt fel' }));
          console.error('AI review error:', err);
          lastError = err.error ?? err.detail ?? 'Okänt fel';
          failedBatches++;
          continue;
        }

        const data = await res.json();
        if (data.findings?.length > 0) {
          allFindings.push(...data.findings);
          setAiFindings([...allFindings]);
        }
      } catch (err) {
        console.error('Network error:', err);
        lastError = 'Kunde inte nå servern';
        failedBatches++;
      }
    }

    setAiFindings(allFindings);

    if (failedBatches === totalBatches) {
      setAiProgress(`❌ Granskningen misslyckades. ${lastError}`);
    } else if (failedBatches > 0) {
      setAiProgress(
        `⚠️ ${failedBatches} av ${totalBatches} batchar misslyckades. ${allFindings.length} problem hittade.`
      );
    } else {
      setAiProgress(
        allFindings.length > 0
          ? `✅ Klar! ${allFindings.length} problem hittade.`
          : '✅ Klar! Inga problem hittades.'
      );
    }
    setAiReviewing(false);
    setAiDone(true);
  }

  // Map för snabb uppslagning: key → finding(s)
  const aiFindingsByKey = (() => {
    const map = new Map<string, AiFinding[]>();
    for (const f of aiFindings) {
      const list = map.get(f.key) ?? [];
      list.push(f);
      map.set(f.key, list);
    }
    return map;
  })();

  // ── Sektioner (top-level nycklar) ──

  const sections: Section[] = (() => {
    const tree: Record<string, Translation[]> = {};
    for (const t of translations) {
      const top = t.key.split('.')[0];
      if (!tree[top]) tree[top] = [];
      tree[top].push(t);
    }
    return Object.entries(tree).map(([key, items]) => ({
      key,
      count: items.length,
      editedCount: items.filter((t) => editedKeys.has(t.key)).length,
      missingCount: items.filter((t) => !t.target_text && t.source_text).length,
    }));
  })();

  // ── Filtrering ──

  const filteredTranslations = (() => {
    let items = translations;

    // Sökfilter (globalt, ignorerar sektion)
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (t) =>
          t.key.toLowerCase().includes(q) ||
          t.source_text.toLowerCase().includes(q) ||
          t.target_text.toLowerCase().includes(q)
      );
    } else if (activeSection) {
      items = items.filter(
        (t) => t.key === activeSection || t.key.startsWith(activeSection + '.')
      );
    }

    // Kategorifilter
    if (filter === 'edited') {
      const base = search ? items : translations;
      items = base.filter((t) => editedKeys.has(t.key));
    } else if (filter === 'missing') {
      const base = search ? items : translations;
      items = base.filter((t) => !t.target_text && t.source_text);
    } else if (filter === 'long') {
      items = items.filter(
        (t) => t.source_text.length > 80 || t.target_text.length > 80
      );
    } else if (filter === 'unreviewed') {
      const base = search ? items : translations;
      items = base.filter((t) => !t.reviewed);
    } else if (filter === 'ai-flagged') {
      const base = search ? items : translations;
      items = base.filter((t) => aiFindingsByKey.has(t.key));
    }

    return items;
  })();

  // ── Stats ──

  const totalKeys = translations.length;
  const editedCount = editedKeys.size;
  const missingCount = translations.filter((t) => !t.target_text && t.source_text).length;
  const reviewedCount = translations.filter((t) => t.reviewed).length;

  // ── Render ──

  if (loading) {
    return <div className="page-center">Laddar...</div>;
  }

  if (!project) {
    return (
      <div className="page-center">
        <p>Projektet hittades inte.</p>
        <Link to="/">← Tillbaka</Link>
      </div>
    );
  }

  return (
    <div className="editor-layout">
      {/* Topbar */}
      <div className="topbar">
        <Link to="/" className="back-link" title="Tillbaka till projekt">
          ←
        </Link>
        <span className="brand">{project.name}</span>

        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Sök nyckel eller text..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="filter-pills">
          {(['all', 'unreviewed', 'edited', 'missing', 'long', ...(aiFindings.length > 0 ? ['ai-flagged'] : [])] as Filter[]).map((f) => (
            <button
              key={f}
              className={`pill ${filter === f ? 'active' : ''} ${f === 'ai-flagged' ? 'pill-ai' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'Alla' : f === 'unreviewed' ? 'Ej granskade' : f === 'edited' ? 'Ändrade' : f === 'missing' ? 'Saknas' : f === 'long' ? 'Långa' : `🤖 AI (${aiFindings.length})`}
            </button>
          ))}
        </div>

        <div className="stats">
          <span className="stat-reviewed">
            <span className="stat-num">{reviewedCount}</span> / {totalKeys} granskade
          </span>
          <span className="stat-edited">
            <span className="stat-num">{editedCount}</span> ändrade
          </span>
          <span className="stat-missing">
            <span className="stat-num">{missingCount}</span> saknas
          </span>
        </div>

        <button className="action-btn import-btn" onClick={handleImport} disabled={importing}>
          {importing ? 'Importerar...' : 'Importera JSON'}
        </button>
        <button
          className="action-btn ai-btn"
          onClick={handleAiReview}
          disabled={aiReviewing || translations.length === 0}
        >
          {aiReviewing ? '🤖 Granskar...' : '🤖 Granska med AI'}
        </button>
        <button
          className="action-btn download-btn"
          onClick={handleExport}
          disabled={translations.length === 0}
        >
          Ladda ner
        </button>

        {saveStatus && <span className="save-indicator">{saveStatus}</span>}
        <ThemeToggle />
      </div>

      {/* Body */}
      <div className="editor-body">
        {/* Sidebar */}
        <div className="sidebar">
          <div
            className={`sidebar-section ${activeSection === null && !search ? 'active' : ''}`}
            onClick={() => {
              setActiveSection(null);
              setSearch('');
            }}
          >
            <span>Alla sektioner</span>
            <span className="count">{totalKeys}</span>
          </div>
          {sections.map((sec) => (
            <div
              key={sec.key}
              className={`sidebar-section ${activeSection === sec.key ? 'active' : ''}`}
              onClick={() => {
                setActiveSection(sec.key);
                setSearch('');
              }}
            >
              <span>{sec.key}</span>
              {sec.editedCount > 0 && <span className="badge badge-edited" />}
              {sec.missingCount > 0 && <span className="badge badge-missing" />}
              <span className="count">{sec.count}</span>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="content">
          {/* AI-granskning progress/resultat */}
          {(aiReviewing || aiFindings.length > 0 || aiDone) && showAiPanel && (
            <div className="ai-panel">
              <div className="ai-panel-header">
                <span className="ai-panel-title">🤖 AI-granskning</span>
                <span className="ai-panel-status">{aiProgress}</span>
                {!aiReviewing && (
                  <button
                    className="ai-panel-close"
                    onClick={() => setShowAiPanel(false)}
                  >
                    ✕
                  </button>
                )}
              </div>
              {aiReviewing && (
                <div className="ai-progress-bar">
                  <div className="ai-progress-bar-fill" />
                </div>
              )}
              {aiFindings.length > 0 && (
                <div className="ai-panel-summary">
                  <span className="ai-count ai-count-error">
                    🔴 {aiFindings.filter((f) => f.severity === 'error').length} fel
                  </span>
                  <span className="ai-count ai-count-warning">
                    🟡 {aiFindings.filter((f) => f.severity === 'warning').length} varningar
                  </span>
                  <span className="ai-count ai-count-info">
                    🔵 {aiFindings.filter((f) => f.severity === 'info').length} tips
                  </span>
                  <button
                    className="pill pill-ai"
                    onClick={() => setFilter('ai-flagged')}
                  >
                    Visa alla flaggade
                  </button>
                </div>
              )}
            </div>
          )}

          {filteredTranslations.length === 0 ? (
            <div className="no-results">
              {translations.length === 0
                ? 'Inga översättningar ännu. Klicka "Importera JSON" för att ladda in filer.'
                : 'Inga nycklar matchar.'}
            </div>
          ) : (
            filteredTranslations.map((t) => (
              <TranslationRow
                key={t.id}
                translation={t}
                isEdited={editedKeys.has(t.key)}
                aiFindings={aiFindingsByKey.get(t.key)}
                onEdit={handleEdit}
                onToggleReviewed={handleToggleReviewed}
                onShowHistory={() => {
                  setHistoryKey(t.key);
                  setHistoryTranslationId(t.id);
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* Import-modal */}
      {showImportModal && (
        <div className="modal-backdrop" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Importera JSON-filer</h2>
              <button className="modal-close" onClick={() => setShowImportModal(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="import-fields">
                <label className="import-field">
                  <span className="import-label">
                    Engelska (referens)
                    {enFile && <span className="import-ok">✓ {enFile.name}</span>}
                  </span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => setEnFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="import-field">
                  <span className="import-label">
                    Svenska (redigerbar)
                    {svFile && <span className="import-ok">✓ {svFile.name}</span>}
                  </span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => setSvFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <button
                className="action-btn import-btn"
                style={{ marginTop: '16px', width: '100%', padding: '10px' }}
                disabled={!enFile || !svFile}
                onClick={doImport}
              >
                Importera
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historik-modal */}
      {historyKey && historyTranslationId && (
        <History
          translationKey={historyKey}
          translationId={historyTranslationId}
          onClose={() => {
            setHistoryKey(null);
            setHistoryTranslationId(null);
          }}
        />
      )}
    </div>
  );
}
