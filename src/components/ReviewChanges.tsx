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
  const [editTexts, setEditTexts] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState<string | null>(null);
  const [totalLoaded, setTotalLoaded] = useState(0);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    const { data: proj } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();
    setProject(proj);

    let allTranslations: Translation[] = [];
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
      allTranslations = allTranslations.concat(data ?? []);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }

    setTotalLoaded(allTranslations.length);

    const changed = allTranslations.filter(
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

  function getEditText(translationId: string, currentText: string): string {
    return editTexts.get(translationId) ?? currentText;
  }

  function setEditText(translationId: string, text: string) {
    setEditTexts((prev) => {
      const next = new Map(prev);
      next.set(translationId, text);
      return next;
    });
  }

  async function handleSaveEdit(translationId: string, oldText: string, newText: string) {
    if (oldText === newText || !newText) return;

    setSaving(translationId);

    const { error: updateError } = await supabase
      .from('translations')
      .update({ target_text: newText, manually_approved_text: newText })
      .eq('id', translationId);

    if (updateError) {
      alert('Kunde inte spara: ' + updateError.message);
      setSaving(null);
      return;
    }

    await supabase.from('translation_history').insert({
      translation_id: translationId,
      old_text: oldText,
      new_text: newText,
      changed_by: 'anonymous',
      change_type: 'edit',
    });

    setEntries((prev) =>
      prev
        .map((e) => {
          if (e.translation.id !== translationId) return e;
          if (newText === e.translation.imported_target_text) return null!;
          return {
            ...e,
            translation: {
              ...e.translation,
              target_text: newText,
              manually_approved_text: newText,
            },
          };
        })
        .filter(Boolean),
    );

    setEditTexts((prev) => {
      const next = new Map(prev);
      next.delete(translationId);
      return next;
    });

    setSaving(null);
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
          if (oldText === e.translation.imported_target_text) return null!;
          return {
            ...e,
            translation: {
              ...e.translation,
              target_text: oldText,
              manually_approved_text: oldText,
            },
          };
        })
        .filter(Boolean),
    );

    setEditTexts((prev) => {
      const next = new Map(prev);
      next.delete(translationId);
      return next;
    });

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
        <span className="review-changes-count">{entries.length} ändrade nycklar (av {totalLoaded} laddade)</span>
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
            const editText = getEditText(t.id, t.target_text);
            const isDirty = editText !== t.target_text;
            const uniqueTexts = new Set<string>();
            uniqueTexts.add(t.target_text);
            if (isDirty) uniqueTexts.add(editText);

            return (
              <div key={t.id} className="review-card">
                <div className="review-card-header">
                  <code className="review-card-key">{t.key}</code>
                  <span className="review-card-source">{t.source_text}</span>
                </div>

                <div className="review-card-current">
                  <span className="review-version-label">Nuvarande text</span>
                  <div className="review-edit-row">
                    <textarea
                      className="review-edit-input"
                      value={editText}
                      onChange={(e) => setEditText(t.id, e.target.value)}
                      rows={Math.max(2, editText.split('\n').length)}
                    />
                    <button
                      className={`save-btn ${isDirty ? 'active' : ''}`}
                      disabled={!isDirty || saving === t.id}
                      onClick={() => handleSaveEdit(t.id, t.target_text, editText)}
                      title="Spara ändringar"
                    >
                      {saving === t.id ? '...' : '💾'}
                    </button>
                  </div>
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
