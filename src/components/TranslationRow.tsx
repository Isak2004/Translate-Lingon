import { memo, useRef, useEffect, useState } from 'react';
import type { Translation, AiFinding, ReviewCategory } from '../types';

interface Props {
  translation: Translation;
  aiFindings?: AiFinding[];
  category?: ReviewCategory;
  hasHistory: boolean;
  onSave: (id: string, oldText: string, newText: string) => void;
  onToggleApproved: (id: string) => void;
  onShowHistory: () => void;
}

export const TranslationRow = memo(function TranslationRow({
  translation: t,
  aiFindings,
  category,
  hasHistory,
  onSave,
  onToggleApproved,
  onShowHistory,
}: Props) {
  const [showFindings, setShowFindings] = useState(false);
  const [localText, setLocalText] = useState(t.target_text);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  const isMissing = !t.target_text && !!t.source_text;
  const isLong =
    t.source_text.length > 80 ||
    t.target_text.length > 80 ||
    t.source_text.includes('\n') ||
    t.target_text.includes('\n');

  const isApproved = !!t.target_text && t.manually_approved_text === t.target_text;

  useEffect(() => {
    setLocalText(t.target_text);
  }, [t.target_text]);

  useEffect(() => {
    if (ref.current && 'style' in ref.current && isLong) {
      const el = ref.current as HTMLTextAreaElement;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [localText, isLong]);

  const isDirty = localText !== t.target_text;

  async function handleClickSave() {
    setSaving(true);
    await onSave(t.id, t.target_text, localText);
    setSaving(false);
  }

  const hasAiFlag = aiFindings && aiFindings.length > 0;
  const worstSeverity = hasAiFlag
    ? aiFindings!.some((f) => f.severity === 'error')
      ? 'error'
      : aiFindings!.some((f) => f.severity === 'warning')
        ? 'warning'
        : 'info'
    : null;

  const className = [
    'entry',
    isMissing ? 'missing' : '',
    isApproved ? 'manually-approved' : '',
    hasAiFlag ? `ai-flagged ai-${worstSeverity}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <div className="entry-key">
        <button
          className={`review-check ${isApproved ? 'checked' : ''}`}
          onClick={() => onToggleApproved(t.id)}
          title={isApproved ? 'Ta bort manuellt godkännande' : 'Godkänn manuellt'}
        >
          {isApproved ? '✓' : ''}
        </button>
        <code>{t.key}</code>
        {category && (
          <span className={`category-badge category-${category}`}>
            {category === 'ai-approved'
              ? '✅'
              : category === 'ai-rejected'
                ? '❌'
                : '✋'}
          </span>
        )}
        {hasAiFlag && (
          <button
            className={`ai-flag-btn ai-flag-${worstSeverity}`}
            onClick={() => setShowFindings(!showFindings)}
            title="Visa AI-granskning"
          >
            🤖 {aiFindings!.length}
          </button>
        )}
        {isMissing && !hasAiFlag && (
          <span className="ai-flag-btn ai-flag-warning">Text saknas</span>
        )}
        {hasHistory && (
          <button className="history-btn" onClick={onShowHistory} title="Visa historik">
            🕑
          </button>
        )}
      </div>
      <div className="en-col">
        <span className="col-label">EN</span>
        <div className="en-text">{t.source_text}</div>
      </div>
      <div className="sv-col">
        <span className="col-label">SV</span>
        <div className="sv-input-row">
          {isLong ? (
            <textarea
              ref={ref as React.RefObject<HTMLTextAreaElement>}
              rows={Math.min(6, Math.max(2, (localText || t.source_text).split('\n').length))}
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
            />
          ) : (
            <input
              ref={ref as React.RefObject<HTMLInputElement>}
              type="text"
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
            />
          )}
          <button
            className={`save-btn ${isDirty ? 'active' : ''}`}
            disabled={!isDirty || saving}
            onClick={handleClickSave}
            title="Spara ändringar"
          >
            {saving ? '...' : '💾'}
          </button>
        </div>
      </div>
      {hasAiFlag && showFindings && (
        <div className="ai-findings">
          {aiFindings!.map((f, i) => (
            <div key={i} className={`ai-finding ai-finding-${f.severity}`}>
              <div className="ai-finding-header">
                <span className={`ai-severity ai-severity-${f.severity}`}>
                  {f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵'}
                  {f.severity === 'error' ? ' Fel' : f.severity === 'warning' ? ' Varning' : ' Tips'}
                </span>
              </div>
              <div className="ai-finding-issue">{f.issue}</div>
              {f.suggestion && (
                <div className="ai-finding-suggestion">
                  <span className="ai-suggestion-label">Förslag:</span> {f.suggestion}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
