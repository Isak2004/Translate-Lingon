import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import type { HistoryEntry } from '../types';

interface Props {
  translationKey: string;
  translationId: string;
  onClose: () => void;
}

export function History({ translationKey, translationId, onClose }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, [translationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadHistory() {
    const { data, error } = await supabase
      .from('translation_history')
      .select('*')
      .eq('translation_id', translationId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Kunde inte ladda historik:', error);
    } else {
      setEntries(data ?? []);
    }
    setLoading(false);
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('sv-SE') +
      ' ' +
      d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Historik</h2>
          <code>{translationKey}</code>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <p>Laddar...</p>
          ) : entries.length === 0 ? (
            <p className="empty">Inga ändringar loggade ännu.</p>
          ) : (
            <div className="history-list">
              {entries.map((entry) => (
                <div key={entry.id} className="history-entry">
                  <div className="history-meta">
                    <span className="history-date">{formatDate(entry.created_at)}</span>
                    <span className="history-author">{entry.changed_by}</span>
                  </div>
                  <div className="history-diff">
                    {entry.old_text !== null && (
                      <div className="diff-old">
                        <span className="diff-label">−</span>
                        <span>{entry.old_text || '(tom)'}</span>
                      </div>
                    )}
                    <div className="diff-new">
                      <span className="diff-label">+</span>
                      <span>{entry.new_text}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
