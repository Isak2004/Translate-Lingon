import { memo, useRef, useEffect } from 'react';
import type { Translation } from '../types';

interface Props {
  translation: Translation;
  isEdited: boolean;
  onEdit: (id: string, key: string, newText: string) => void;
  onToggleReviewed: (id: string) => void;
  onShowHistory: () => void;
}

export const TranslationRow = memo(function TranslationRow({
  translation: t,
  isEdited,
  onEdit,
  onToggleReviewed,
  onShowHistory,
}: Props) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const isMissing = !t.target_text && !!t.source_text;
  const isLong =
    t.source_text.length > 80 ||
    t.target_text.length > 80 ||
    t.source_text.includes('\n') ||
    t.target_text.includes('\n');

  // Auto-resize textarea
  useEffect(() => {
    if (ref.current && 'style' in ref.current && isLong) {
      const el = ref.current as HTMLTextAreaElement;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [t.target_text, isLong]);

  const className = [
    'entry',
    isEdited ? 'edited' : '',
    isMissing ? 'missing' : '',
    t.reviewed ? 'reviewed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <div className="entry-key">
        <button
          className={`review-check ${t.reviewed ? 'checked' : ''}`}
          onClick={() => onToggleReviewed(t.id)}
          title={t.reviewed ? 'Markera som ej granskad' : 'Markera som granskad'}
        >
          {t.reviewed ? '✓' : ''}
        </button>
        <code>{t.key}</code>
        <button className="history-btn" onClick={onShowHistory} title="Visa historik">
          🕑
        </button>
      </div>
      <div className="en-col">
        <span className="col-label">EN</span>
        <div className="en-text">{t.source_text}</div>
      </div>
      <div className="sv-col">
        <span className="col-label">
          SV {isEdited && <span className="edited-indicator">ändrad</span>}
        </span>
        {isLong ? (
          <textarea
            ref={ref as React.RefObject<HTMLTextAreaElement>}
            rows={Math.min(6, Math.max(2, (t.target_text || t.source_text).split('\n').length))}
            defaultValue={t.target_text}
            onInput={(e) =>
              onEdit(t.id, t.key, (e.target as HTMLTextAreaElement).value)
            }
          />
        ) : (
          <input
            ref={ref as React.RefObject<HTMLInputElement>}
            type="text"
            defaultValue={t.target_text}
            onInput={(e) =>
              onEdit(t.id, t.key, (e.target as HTMLInputElement).value)
            }
          />
        )}
      </div>
    </div>
  );
});
