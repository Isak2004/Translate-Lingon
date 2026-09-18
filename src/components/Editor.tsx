import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { TranslationRow } from './TranslationRow';
import { ThemeToggle } from './ThemeToggle';
import { History } from './History';
import type { Project, Translation, FlatMap, AiFinding, GlossaryTerm, ReviewCategory } from '../types';

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

// ── Kategori-helper ──

function getCategory(
  t: Translation,
  hasFinding: boolean,
): ReviewCategory {
  const isMissing = !t.target_text && !!t.source_text;
  if (isMissing) return 'ai-rejected';
  if (hasFinding) {
    return t.target_text && t.manually_approved_text === t.target_text
      ? 'ai-rejected-manually-approved'
      : 'ai-rejected';
  }
  return 'ai-approved';
}

// ── Typer ──

interface Section { key: string; count: number; }

type Filter = 'all' | 'ai-approved' | 'ai-rejected' | 'ai-rejected-manually-approved' | 'manually-changed' | 'conflicts';

export function Editor() {
  const { id } = useParams<{ id: string }>();

  const [project, setProject] = useState<Project | null>(null);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const translationsRef = useRef<Translation[]>([]);
  translationsRef.current = translations;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(100);

  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [historyTranslationId, setHistoryTranslationId] = useState<string | null>(null);

  const [aiFindings, setAiFindings] = useState<AiFinding[]>([]);
  const [aiReviewing, setAiReviewing] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiSummary, setAiSummary] = useState<{
    approved: number; rejected: number; manuallyApproved: number;
    total: number; findings: number;
  } | null>(null);

  const [glossary, setGlossary] = useState<GlossaryTerm[]>([]);

  const [showImportModal, setShowImportModal] = useState(false);
  const [enFile, setEnFile] = useState<File | null>(null);
  const [svFile, setSvFile] = useState<File | null>(null);
  const [glossaryFile, setGlossaryFile] = useState<File | null>(null);

  const [saveStatus, setSaveStatus] = useState('');
  const [showAiConfirm, setShowAiConfirm] = useState(false);

  // ── Ladda projekt och översättningar ──

  useEffect(() => {
    if (!id) return;
    loadProject();
    loadTranslations();
    loadGlossary();
    loadAiFindings();
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

  async function loadGlossary() {
    const { data } = await supabase
      .from('glossary_terms')
      .select('*')
      .eq('project_id', id)
      .order('source_term');
    setGlossary(data ?? []);
  }

  async function loadAiFindings() {
    const { data } = await supabase
      .from('ai_findings')
      .select('*')
      .eq('project_id', id);

    if (data && data.length > 0) {
      const findings: AiFinding[] = data.map((row) => ({
        key: row.key,
        issue: row.issue,
        suggestion: row.suggestion,
        severity: row.severity,
      }));
      setAiFindings(findings);
    }
  }

  // ── Import av ordlista ──

  async function importGlossaryFromFile(file: File) {
    const raw = JSON.parse(await file.text());
    const terms = raw.terms ?? raw;

    if (!Array.isArray(terms)) {
      throw new Error('Ordlistefilen innehåller inte en terms-array');
    }

    const existingByTerm = new Map<string, GlossaryTerm>();
    for (const g of glossary) {
      existingByTerm.set(g.source_term, g);
    }

    const toInsert: {
      project_id: string; source_term: string; definition: string;
      approved_translation: string | null; notes: string; do_not_translate: boolean;
    }[] = [];
    const toUpdate: {
      id: string; definition: string; approved_translation: string | null;
      notes: string; do_not_translate: boolean;
    }[] = [];

    for (const term of terms) {
      const svTranslation = term.approved_translations?.sv ?? null;
      const existing = existingByTerm.get(term.source_term);

      if (!existing) {
        toInsert.push({
          project_id: id!,
          source_term: term.source_term,
          definition: term.definition ?? '',
          approved_translation: svTranslation,
          notes: term.notes ?? '',
          do_not_translate: term.do_not_translate ?? false,
        });
      } else {
        const changed =
          existing.definition !== (term.definition ?? '') ||
          existing.approved_translation !== svTranslation ||
          existing.notes !== (term.notes ?? '') ||
          existing.do_not_translate !== (term.do_not_translate ?? false);

        if (changed) {
          toUpdate.push({
            id: existing.id,
            definition: term.definition ?? '',
            approved_translation: svTranslation,
            notes: term.notes ?? '',
            do_not_translate: term.do_not_translate ?? false,
          });
        }
      }
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from('glossary_terms').insert(toInsert);
      if (error) throw error;
    }

    for (const item of toUpdate) {
      const { error } = await supabase
        .from('glossary_terms')
        .update({
          definition: item.definition,
          approved_translation: item.approved_translation,
          notes: item.notes,
          do_not_translate: item.do_not_translate,
        })
        .eq('id', item.id);
      if (error) throw error;
    }

    await loadGlossary();

    return { inserted: toInsert.length, updated: toUpdate.length, total: terms.length };
  }

  // ── Import (unified: en.json + sv.json + valfri ordlista) ──

  function handleImport() {
    setEnFile(null);
    setSvFile(null);
    setGlossaryFile(null);
    setShowImportModal(true);
  }

  async function doImport() {
    if (!enFile || !svFile) return;
    setShowImportModal(false);
    setImporting(true);

    try {
      await importFiles(enFile, svFile);

      if (glossaryFile) {
        const gStats = await importGlossaryFromFile(glossaryFile);
        const parts: string[] = [];
        if (gStats.inserted > 0) parts.push(`${gStats.inserted} nya`);
        if (gStats.updated > 0) parts.push(`${gStats.updated} uppdaterade`);
        const unchanged = gStats.total - gStats.inserted - gStats.updated;
        if (unchanged > 0) parts.push(`${unchanged} oförändrade`);
        setSaveStatus((prev) => prev + ` | Ordlista: ${parts.join(', ')}`);
      }
    } catch (err) {
      alert('Import misslyckades: ' + (err as Error).message);
    }

    setImporting(false);
  }

  async function importFiles(enFile: File, svFile: File) {
    const enRaw = JSON.parse(await enFile.text());
    const svRaw = JSON.parse(await svFile.text());
    const enFlat = flatten(enRaw);
    const svFlat = flatten(svRaw);
    const allKeys = [...new Set([...Object.keys(enFlat), ...Object.keys(svFlat)])].sort();

    const existingByKey = new Map<string, Translation>();
    for (const t of translations) {
      existingByKey.set(t.key, t);
    }

    const toInsert: {
      project_id: string; key: string; source_text: string;
      target_text: string; imported_target_text: string;
    }[] = [];
    const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];

    for (const key of allKeys) {
      const existing = existingByKey.get(key);
      const newSourceText = enFlat[key] ?? '';
      const newTargetText = svFlat[key] ?? '';

      if (!existing) {
        toInsert.push({
          project_id: id!,
          key,
          source_text: newSourceText,
          target_text: newTargetText,
          imported_target_text: newTargetText,
        });
      } else {
        const fields: Record<string, unknown> = {
          imported_target_text: newTargetText,
        };
        if (existing.source_text !== newSourceText) {
          fields.source_text = newSourceText;
        }
        const userHasEdited =
          existing.target_text !== existing.imported_target_text;
        const importTextChanged =
          newTargetText !== existing.imported_target_text;

        if (userHasEdited && importTextChanged) {
          fields.has_conflict = true;
        } else if (!userHasEdited && importTextChanged) {
          fields.target_text = newTargetText;
          fields.has_conflict = false;
        } else {
          fields.has_conflict = false;
        }
        toUpdate.push({ id: existing.id, fields });
      }
    }

    // Infoga nya nycklar
    for (let i = 0; i < toInsert.length; i += 500) {
      const batch = toInsert.slice(i, i + 500);
      const { error } = await supabase.from('translations').insert(batch);
      if (error) throw error;
    }

    // Uppdatera befintliga (imported_target_text + ev. source_text)
    for (let i = 0; i < toUpdate.length; i += 50) {
      const batch = toUpdate.slice(i, i + 50);
      await Promise.all(
        batch.map(async (item) => {
          const { error } = await supabase
            .from('translations')
            .update(item.fields)
            .eq('id', item.id);
          if (error) throw error;
        })
      );
    }

    // Ta bort nycklar som inte längre finns i filerna
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

    const sourceUpdated = toUpdate.filter((u) => u.fields.source_text !== undefined).length;
    const stats: string[] = [];
    if (toInsert.length > 0) stats.push(`${toInsert.length} nya`);
    if (sourceUpdated > 0) stats.push(`${sourceUpdated} uppdaterade`);
    if (toDelete.length > 0) stats.push(`${toDelete.length} borttagna`);
    const unchanged = allKeys.length - toInsert.length - sourceUpdated;
    if (unchanged > 0) stats.push(`${unchanged} oförändrade`);
    setSaveStatus(`Import: ${stats.join(', ')}`);
  }

  // ── Spara en översättning (= manuellt godkänd) ──

  const handleSave = useCallback(async (translationId: string, oldText: string, newText: string) => {
    if (oldText === newText) return;

    setSaveStatus('Sparar...');

    const { error: updateError } = await supabase
      .from('translations')
      .update({ target_text: newText, manually_approved_text: newText })
      .eq('id', translationId);

    if (updateError) {
      console.error('Sparfel:', updateError);
      setSaveStatus('Fel vid sparning!');
      return;
    }

    await supabase.from('translation_history').insert({
      translation_id: translationId,
      old_text: oldText,
      new_text: newText,
      changed_by: 'anonymous',
      change_type: 'edit',
    });

    setTranslations((prev) =>
      prev.map((t) =>
        t.id === translationId
          ? { ...t, target_text: newText, manually_approved_text: newText }
          : t
      )
    );

    const time = new Date().toLocaleTimeString('sv-SE', {
      hour: '2-digit',
      minute: '2-digit',
    });
    setSaveStatus(`Sparad ${time}`);
  }, []);

  // ── Manuellt godkännande (toggle) ──

  const handleToggleApproved = useCallback(async (translationId: string) => {
    const t = translationsRef.current.find((tr) => tr.id === translationId);
    if (!t || !t.target_text) return;

    const isApproved = t.manually_approved_text === t.target_text;
    const newApprovedText = isApproved ? null : t.target_text;

    const { error } = await supabase
      .from('translations')
      .update({ manually_approved_text: newApprovedText })
      .eq('id', translationId);

    if (error) {
      console.error('Kunde inte uppdatera godkännande:', error);
      return;
    }

    setTranslations((prev) =>
      prev.map((tr) =>
        tr.id === translationId ? { ...tr, manually_approved_text: newApprovedText } : tr
      )
    );
  }, []);

  // ── Konflikthantering ──

  const handleResolveConflict = useCallback(async (translationId: string, keepOurs: boolean) => {
    const t = translationsRef.current.find((tr) => tr.id === translationId);
    if (!t) return;

    const updates: Record<string, unknown> = { has_conflict: false };
    if (!keepOurs) {
      updates.target_text = t.imported_target_text;
    }

    const { error } = await supabase
      .from('translations')
      .update(updates)
      .eq('id', translationId);

    if (error) {
      console.error('Kunde inte lösa konflikt:', error);
      return;
    }

    setTranslations((prev) =>
      prev.map((tr) =>
        tr.id === translationId
          ? { ...tr, has_conflict: false, ...(keepOurs ? {} : { target_text: t.imported_target_text! }) }
          : tr
      )
    );
  }, []);

  // ── Export av ändrade nycklar ──

  function handleExportChanged() {
    const flat: FlatMap = {};
    let emptyCount = 0;

    for (const t of translations) {
      if (t.imported_target_text === null) continue;
      if (t.target_text === t.imported_target_text) continue;
      if (!t.target_text) {
        emptyCount++;
        continue;
      }
      flat[t.key] = t.target_text;
    }

    if (emptyCount > 0) {
      alert(`Varning: ${emptyCount} ändrade nycklar hoppades över för att de har tom text.`);
    }

    if (Object.keys(flat).length === 0) {
      alert('Inga ändrade texter att exportera.');
      return;
    }

    const nested = unflatten(flat);
    const json = JSON.stringify(nested, null, 2) + '\n';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.target_language ?? 'sv'}-changes.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── AI-granskning ──

  async function handleAiReview() {
    if (translations.length === 0) return;

    const toReview = translations.filter((t) => t.target_text && t.source_text && !t.ai_reviewed_at);

    if (toReview.length === 0) {
      setAiProgress('Alla nycklar är redan AI-granskade.');
      setShowAiModal(true);
      return;
    }

    setAiReviewing(true);
    setShowAiModal(true);
    setAiSummary(null);
    const existingFindings = [...aiFindings];

    const BATCH_SIZE = 100;
    const newFindings: AiFinding[] = [];
    const totalBatches = Math.ceil(toReview.length / BATCH_SIZE);
    let failedBatches = 0;
    let lastError = '';

    for (let i = 0; i < toReview.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      setAiProgress(`Granskar batch ${batchNum} av ${totalBatches} (${toReview.length} nya nycklar)...`);

      const batch = toReview.slice(i, i + BATCH_SIZE).map((t) => ({
        key: t.key,
        source_text: t.source_text,
        target_text: t.target_text,
      }));

      const glossaryForApi = glossary.map((g) => ({
        source_term: g.source_term,
        definition: g.definition,
        approved_translation: g.approved_translation,
        notes: g.notes,
        do_not_translate: g.do_not_translate,
      }));

      try {
        const res = await fetch('/.netlify/functions/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ translations: batch, glossary: glossaryForApi }),
        });

        if (!res.ok) {
          const text = await res.text();
          let detail = `HTTP ${res.status}`;
          try {
            const err = JSON.parse(text);
            detail = err.error ?? err.detail ?? detail;
          } catch {
            if (text.includes('TimeoutError') || text.includes('Task timed out')) {
              detail = 'Funktionen tog för lång tid (timeout)';
            } else {
              detail += `: ${text.substring(0, 100)}`;
            }
          }
          console.error('AI review error:', res.status, text);
          lastError = detail;
          failedBatches++;
          continue;
        }

        const data = await res.json();
        if (data.findings?.length > 0) {
          newFindings.push(...data.findings);
          setAiFindings([...existingFindings, ...newFindings]);
        }
      } catch (err) {
        console.error('Network error:', err);
        lastError = 'Kunde inte nå servern';
        failedBatches++;
      }
    }

    // Städa nya findings
    const VALID_SEVERITY = ['error', 'warning', 'info'];
    const cleanNewFindings: AiFinding[] = [];
    for (const f of newFindings) {
      const key = typeof f.key === 'string' ? f.key.trim() : '';
      const issue = typeof f.issue === 'string' ? f.issue.trim() : '';
      if (!key || !issue) {
        console.warn('AI-finding saknar key/issue — hoppas över:', f);
        continue;
      }
      cleanNewFindings.push({
        key,
        issue,
        suggestion: typeof f.suggestion === 'string' ? f.suggestion : null,
        severity: (VALID_SEVERITY.includes(f.severity)
          ? f.severity
          : 'info') as AiFinding['severity'],
      });
    }

    const allFindings = [...existingFindings, ...cleanNewFindings];
    setAiFindings(allFindings);

    if (failedBatches === totalBatches) {
      setAiProgress(`Granskningen misslyckades. ${lastError}`);
    } else if (failedBatches > 0) {
      setAiProgress(
        `${failedBatches} av ${totalBatches} batchar misslyckades. ${cleanNewFindings.length} nya problem hittade.`
      );
    } else {
      setAiProgress(
        cleanNewFindings.length > 0
          ? `Klar! ${cleanNewFindings.length} nya problem hittade (${toReview.length} nycklar granskade).`
          : `Klar! Inga problem i ${toReview.length} nya nycklar.`
      );
    }
    setAiReviewing(false);

    // Spara bara NYA findings till DB
    if (failedBatches < totalBatches && cleanNewFindings.length > 0) {
      const rows = cleanNewFindings.map((f) => ({
        project_id: id!,
        key: f.key,
        issue: f.issue,
        suggestion: f.suggestion,
        severity: f.severity,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error: insertErr } = await supabase.from('ai_findings').insert(batch);
        if (insertErr) {
          console.error('Kunde inte spara AI-findings:', insertErr);
          setSaveStatus('AI-resultat kunde inte sparas till databasen');
          break;
        }
      }
    }

    // Markera granskade nycklar med tidstämpel
    if (failedBatches < totalBatches) {
      const now = new Date().toISOString();
      const reviewedIds = toReview.map((t) => t.id);
      for (let i = 0; i < reviewedIds.length; i += 500) {
        const batch = reviewedIds.slice(i, i + 500);
        await supabase
          .from('translations')
          .update({ ai_reviewed_at: now })
          .in('id', batch);
      }

      const reviewedIdSet = new Set(reviewedIds);
      setTranslations((prev) =>
        prev.map((t) =>
          reviewedIdSet.has(t.id) ? { ...t, ai_reviewed_at: now } : t
        )
      );
    }

    // Sammanfattning med ALLA findings (gamla + nya)
    if (failedBatches < totalBatches) {
      const flaggedKeys = new Set(allFindings.map((f) => f.key));
      let approved = 0, rejected = 0, manuallyApproved = 0;
      for (const t of translations) {
        const isMissing = !t.target_text && !!t.source_text;
        if (isMissing) { rejected++; continue; }
        if (flaggedKeys.has(t.key)) {
          if (t.target_text && t.manually_approved_text === t.target_text) {
            manuallyApproved++;
          } else {
            rejected++;
          }
        } else if (t.target_text || t.source_text) {
          approved++;
        }
      }
      setAiSummary({
        approved,
        rejected,
        manuallyApproved,
        total: translations.length,
        findings: allFindings.length,
      });
    }
  }

  // ── Memoized maps och beräkningar ──

  const aiFindingsByKey = useMemo(() => {
    const map = new Map<string, AiFinding[]>();
    for (const f of aiFindings) {
      const list = map.get(f.key) ?? [];
      list.push(f);
      map.set(f.key, list);
    }
    return map;
  }, [aiFindings]);

  const aiDone = useMemo(() => translations.some((t) => !!t.ai_reviewed_at), [translations]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, ReviewCategory>();
    if (!aiDone) return map;
    for (const t of translations) {
      map.set(t.id, getCategory(t, aiFindingsByKey.has(t.key)));
    }
    return map;
  }, [translations, aiDone, aiFindingsByKey]);

  const categoryCounts = useMemo(() => {
    let approved = 0, rejected = 0, manuallyApproved = 0;
    for (const cat of categoryMap.values()) {
      if (cat === 'ai-approved') approved++;
      else if (cat === 'ai-rejected') rejected++;
      else manuallyApproved++;
    }
    return { approved, rejected, manuallyApproved };
  }, [categoryMap]);

  const manuallyChangedCount = useMemo(() => {
    let count = 0;
    for (const t of translations) {
      if (t.imported_target_text !== null && t.target_text !== t.imported_target_text && t.target_text) {
        count++;
      }
    }
    return count;
  }, [translations]);

  const conflictCount = useMemo(() => {
    let count = 0;
    for (const t of translations) {
      if (t.has_conflict) count++;
    }
    return count;
  }, [translations]);

  // ── Sektioner ──

  const sections: Section[] = useMemo(() => {
    const tree: Record<string, Translation[]> = {};
    for (const t of translations) {
      const top = t.key.split('.')[0];
      if (!tree[top]) tree[top] = [];
      tree[top].push(t);
    }
    return Object.entries(tree).map(([key, items]) => ({
      key,
      count: items.length,
    }));
  }, [translations]);

  // ── Filtrering ──

  const filteredTranslations = useMemo(() => {
    let items = translations;

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

    if (filter === 'conflicts') {
      items = items.filter((t) => t.has_conflict);
    } else if (filter === 'manually-changed') {
      items = items.filter((t) => t.imported_target_text !== null && t.target_text !== t.imported_target_text && t.target_text);
    } else if (aiDone && filter !== 'all') {
      items = items.filter((t) => categoryMap.get(t.id) === filter);
    }

    return items;
  }, [translations, search, activeSection, filter, aiDone, categoryMap]);

  useEffect(() => {
    setVisibleCount(100);
  }, [search, activeSection, filter]);

  const visibleTranslations = useMemo(
    () => filteredTranslations.slice(0, visibleCount),
    [filteredTranslations, visibleCount]
  );

  // ── Stats ──

  const totalKeys = translations.length;

  // ── Render ──

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="loading-box">
          <div className="spinner" />
          <p>Laddar översättningar...</p>
        </div>
      </div>
    );
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
        <div className="topbar-row">
          <Link to="/" className="back-link" title="Tillbaka till projekt">
            ←
          </Link>
          <span className="brand">{project.name}</span>
          {saveStatus && <span className="save-indicator">{saveStatus}</span>}

          <div className="topbar-spacer" />

          {glossary.length > 0 && (
            <span className="glossary-badge">📖 {glossary.length} termer</span>
          )}
          <button className="action-btn import-btn" onClick={handleImport} disabled={importing}>
            {importing ? 'Importerar...' : 'Importera'}
          </button>
          {manuallyChangedCount > 0 && (
            <Link to={`/project/${id}/review`} className="action-btn review-btn">
              Granska ändrade
            </Link>
          )}
          <button
            className="action-btn ai-btn"
            onClick={() => setShowAiConfirm(true)}
            disabled={aiReviewing || translations.length === 0}
          >
            {aiReviewing ? '🤖 Granskar...' : '🤖 Granska med AI'}
          </button>
          <button
            className="action-btn download-btn"
            onClick={handleExportChanged}
            disabled={translations.length === 0}
          >
            Exportera ändrade
          </button>
          <ThemeToggle />
        </div>

        <div className="topbar-row topbar-row-filters">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Sök nyckel, engelsk text eller översättning..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="topbar-spacer" />

          <div className="filter-pills">
            <button
              className={`pill ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              <span>Alla</span>
              <span className="pill-count">{totalKeys.toLocaleString('sv-SE')}</span>
            </button>
            {aiDone && (
              <>
                <button
                  className={`pill pill-approved ${filter === 'ai-approved' ? 'active' : ''}`}
                  onClick={() => setFilter('ai-approved')}
                >
                  <span className="pill-dot" />
                  <span>AI-godkänd</span>
                  <span className="pill-count">{categoryCounts.approved.toLocaleString('sv-SE')}</span>
                </button>
                <button
                  className={`pill pill-rejected ${filter === 'ai-rejected' ? 'active' : ''}`}
                  onClick={() => setFilter('ai-rejected')}
                >
                  <span className="pill-dot" />
                  <span>Ej godkänd</span>
                  <span className="pill-count">{categoryCounts.rejected.toLocaleString('sv-SE')}</span>
                </button>
                <button
                  className={`pill pill-manually-approved ${filter === 'ai-rejected-manually-approved' ? 'active' : ''}`}
                  onClick={() => setFilter('ai-rejected-manually-approved')}
                >
                  <span className="pill-dot" />
                  <span>Manuellt godkänd</span>
                  <span className="pill-count">{categoryCounts.manuallyApproved.toLocaleString('sv-SE')}</span>
                </button>
              </>
            )}
            {manuallyChangedCount > 0 && (
              <button
                className={`pill pill-changed ${filter === 'manually-changed' ? 'active' : ''}`}
                onClick={() => setFilter('manually-changed')}
              >
                <span className="pill-dot" />
                <span>Ändrade</span>
                <span className="pill-count">{manuallyChangedCount}</span>
              </button>
            )}
            {conflictCount > 0 && (
              <button
                className={`pill pill-conflict ${filter === 'conflicts' ? 'active' : ''}`}
                onClick={() => setFilter('conflicts')}
              >
                <span className="pill-dot" />
                <span>Konflikter</span>
                <span className="pill-count">{conflictCount}</span>
              </button>
            )}
          </div>
        </div>
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
              <span className="count">{sec.count}</span>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="content">
          {filteredTranslations.length === 0 ? (
            <div className="no-results">
              {translations.length === 0
                ? 'Inga översättningar ännu. Klicka "Importera" för att ladda in filer.'
                : 'Inga nycklar matchar.'}
            </div>
          ) : (
            <>
              {visibleTranslations.map((t) => (
                <TranslationRow
                  key={t.id}
                  translation={t}
                  aiFindings={aiFindingsByKey.get(t.key)}
                  category={aiDone ? categoryMap.get(t.id) : undefined}
                  hasHistory={true}
                  onSave={handleSave}
                  onToggleApproved={handleToggleApproved}
                  onResolveConflict={handleResolveConflict}
                  onShowHistory={() => {
                    setHistoryKey(t.key);
                    setHistoryTranslationId(t.id);
                  }}
                />
              ))}
              {visibleCount < filteredTranslations.length && (
                <button
                  className="load-more-btn"
                  onClick={() => setVisibleCount((c) => c + 100)}
                >
                  Visa fler ({filteredTranslations.length - visibleCount} kvar)
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Import-modal */}
      {showImportModal && (
        <div className="modal-backdrop" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Importera filer</h2>
              <button className="modal-close" onClick={() => setShowImportModal(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="import-fields">
                <label className="import-field">
                  <span className="import-label">
                    Engelska (en.json)
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
                    Svenska (sv.json)
                    {svFile && <span className="import-ok">✓ {svFile.name}</span>}
                  </span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => setSvFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="import-field">
                  <span className="import-label">
                    Ordlista (valfri)
                    {glossaryFile && <span className="import-ok">✓ {glossaryFile.name}</span>}
                  </span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => setGlossaryFile(e.target.files?.[0] ?? null)}
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

      {/* AI-modal (progress + resultat) */}
      {showAiModal && (
        <div className="modal-backdrop" onClick={aiReviewing ? undefined : () => { setShowAiModal(false); setAiSummary(null); }}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460 }}
          >
            <div className="modal-header">
              <h2>{aiReviewing ? '🤖 AI-granskning pågår' : aiSummary ? '🤖 AI-granskning klar!' : '🤖 AI-granskning'}</h2>
              {!aiReviewing && (
                <button className="modal-close" onClick={() => { setShowAiModal(false); setAiSummary(null); }}>
                  ✕
                </button>
              )}
            </div>
            <div className="modal-body">
              {aiReviewing ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <div className="spinner" />
                  <p style={{ margin: '16px 0 0', color: 'var(--muted)' }}>{aiProgress}</p>
                </div>
              ) : aiSummary ? (
                <>
                  <p style={{ margin: '0 0 12px', fontWeight: 600 }}>
                    {aiSummary.total} texter analyserade:
                  </p>
                  <ul style={{ margin: '0 0 16px', paddingLeft: 20, lineHeight: 1.8 }}>
                    <li style={{ color: 'var(--sage)' }}>
                      ✅ {aiSummary.approved} AI-godkända
                    </li>
                    <li style={{ color: 'var(--berry)' }}>
                      ❌ {aiSummary.rejected} behöver granskas
                    </li>
                    {aiSummary.manuallyApproved > 0 && (
                      <li style={{ color: 'var(--amber)' }}>
                        ✋ {aiSummary.manuallyApproved} tidigare manuellt godkända
                      </li>
                    )}
                  </ul>
                  {aiSummary.findings > 0 && (
                    <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 13 }}>
                      AI hittade {aiSummary.findings} problem i texterna.
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      className="action-btn"
                      style={{ flex: 1, padding: '10px', justifyContent: 'center', background: 'var(--panel-2)', color: 'var(--ink)' }}
                      onClick={() => { setShowAiModal(false); setAiSummary(null); }}
                    >
                      Stäng
                    </button>
                    {aiSummary.rejected > 0 && (
                      <button
                        className="action-btn ai-btn"
                        style={{ flex: 1, padding: '10px', justifyContent: 'center' }}
                        onClick={() => {
                          setShowAiModal(false);
                          setAiSummary(null);
                          setFilter('ai-rejected');
                        }}
                      >
                        Visa ej godkända
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <p style={{ margin: '0 0 16px' }}>{aiProgress}</p>
                  <button
                    className="action-btn"
                    style={{ padding: '10px 24px', background: 'var(--panel-2)', color: 'var(--ink)' }}
                    onClick={() => { setShowAiModal(false); setAiSummary(null); }}
                  >
                    OK
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import-overlay */}
      {importing && (
        <div className="loading-overlay">
          <div className="loading-box">
            <div className="spinner" />
            <p>Importerar översättningar...</p>
          </div>
        </div>
      )}

      {/* AI-bekräftelse */}
      {showAiConfirm && (
        <div className="modal-backdrop" onClick={() => setShowAiConfirm(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460 }}
          >
            <div className="modal-header">
              <h2>AI-analys</h2>
              <button className="modal-close" onClick={() => setShowAiConfirm(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ margin: '0 0 20px', lineHeight: 1.6 }}>
                AI-analysen görs bara en gång på varje nyckel. Nya nycklar processas,
                gamla lämnas som de är. Om du vill börja från början med alla nycklar,
                öppna ett nytt projekt.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  className="action-btn"
                  style={{ background: 'var(--panel-2)', color: 'var(--ink)' }}
                  onClick={() => setShowAiConfirm(false)}
                >
                  Avbryt
                </button>
                <button
                  className="action-btn ai-btn"
                  onClick={() => {
                    setShowAiConfirm(false);
                    handleAiReview();
                  }}
                >
                  🤖 Kör AI-analys
                </button>
              </div>
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
