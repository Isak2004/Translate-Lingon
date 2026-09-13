import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { ThemeToggle } from './ThemeToggle';
import type { Project, Translation, HistoryEntry } from '../types';

interface ChangedEntry {
  translation: Translation;
  history: HistoryEntry[];
}

export function ReviewChanges() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [entries, setEntries] = useState<ChangedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    const [{ data: proj }, { data: allTranslations }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase
        .from('translations')
        .select('*')
        .eq('project_id', id)
        .order('key'),
    ]);

    setProject(proj);

    const changed = (allTranslations ?? []).filter(
      (t) =>
        t.imported_target_text !== null &&
        t.target_text !== t.imported_target_text &&
        t.target_text,
    );

    if (changed.length === 0) {
      setEntries([]);
      setLoading(false);
      return;
    }

    const ids = changed.map((t) => t.id);
    let allHistory: HistoryEntry[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const { data } = await supabase
        .from('translation_history')
        .select('*')
        .in('translation_id', batch)
        .order('created_at', { ascending: false });
      allHistory = allHistory.concat(data ?? []);
    }

    const historyByTranslation = new Map<string, HistoryEntry[]>();
    for (const h of allHistory) {
      const list = historyByTranslation.get(h.translation_id) ?? [];
      list.push(h);
      historyByTranslation.set(h.translation_id, list);
    }

    setEntries(
      changed.map((t) => ({
        translation: t,
        history: historyByTranslation.get(t.id) ?? [],
      })),
    );
    setLoading(false);
  }

  async function handleRevert(translationId: string, oldText: string, currentText: string) {
    if (!confirm(`Återställ till: "${oldText}"?`)) return;

    setReverting(translationId);

    const { error: updateError } = await supabase
      .from('translations')
      .update({ target_text: oldText, manually_approved_text: oldText })
      .eq('id', translationId);

    if (updateError) {
      alert('Kunde inte återställa: ' + updateError.message);
      setReverting(null);
      return;
    }

    await supabase.from('translation_history').insert({
      translation_id: translationId,
      old_text: currentText,
      new_text: oldText,
      changed_by: 'anonymous',
      change_type: 'edit',
    });

    setEntries((prev) =>
      prev
        .map((e) => {
          if (e.translation.id !== translationId) return e;
          const updated = {
            ...e.translation,
            target_text: oldText,
            manually_approved_text: oldText,
          };
          if (oldText === e.translation.imported_target_text) return null!;
          return { ...e, translation: updated };
        })
        .filter(Boolean),
    );

    setReverting(null);
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('sv-SE') +
      ' ' +
      d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    );
  }

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
    <div className="review-changes-layout">
      <div className="review-changes-topbar">
        <Link to={`/project/${id}`} className="back-link" title="Tillbaka till editor">
          ←
        </Link>
        <span className="brand">{project.name}</span>
        <span className="review-changes-title">Granska ändrade</span>
        <span className="review-changes-count">{entries.length} ändrade nycklar</span>
        <ThemeToggle />
      </div>

      <div className="review-changes-content">
        {entries.length === 0 ? (
          <div className="no-results">
            Inga ändrade texter att granska.
          </div>
        ) : (
          entries.map((entry) => {
            const t = entry.translation;
            const uniqueTexts = new Set<string>();
            uniqueTexts.add(t.target_text);

            return (
              <div key={t.id} className="review-card">
                <div className="review-card-header">
                  <code className="review-card-key">{t.key}</code>
                  <span className="review-card-source">{t.source_text}</span>
                </div>

                <div className="review-card-current">
                  <span className="review-version-label">Nuvarande text</span>
                  <div className="review-version-text current">{t.target_text}</div>
                </div>

                {t.imported_target_text && t.imported_target_text !== t.target_text && (
                  <div className="review-card-version">
                    <div className="review-version-row">
                      <div>
                        <span className="review-version-label">Vid import</span>
                        <div className="review-version-text">{t.imported_target_text}</div>
                      </div>
                      <button
                        className="revert-btn"
                        disabled={reverting === t.id}
                        onClick={() =>
                          handleRevert(t.id, t.imported_target_text!, t.target_text)
                        }
                      >
                        Återställ
                      </button>
                    </div>
                  </div>
                )}

                {entry.history.length > 0 && (
                  <div className="review-card-history">
                    <span className="review-version-label">Historik</span>
                    {entry.history.map((h) => {
                      const text = h.old_text ?? '';
                      if (!text || uniqueTexts.has(text)) return null;
                      uniqueTexts.add(text);
                      const isSameAsCurrent = text === t.target_text;
                      return (
                        <div key={h.id} className="review-version-row">
                          <div>
                            <span className="review-history-date">
                              {formatDate(h.created_at)}
                            </span>
                            <div className="review-version-text">{text}</div>
                          </div>
                          {!isSameAsCurrent && (
                            <button
                              className="revert-btn"
                              disabled={reverting === t.id}
                              onClick={() => handleRevert(t.id, text, t.target_text)}
                            >
                              Återställ
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
