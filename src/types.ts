export interface Project {
  id: string;
  name: string;
  description: string;
  source_language: string;
  target_language: string;
  created_at: string;
  updated_at: string;
}

export interface Translation {
  id: string;
  project_id: string;
  key: string;
  source_text: string;
  target_text: string;
  reviewed: boolean;
  created_at: string;
  updated_at: string;
}

export interface HistoryEntry {
  id: string;
  translation_id: string;
  old_text: string | null;
  new_text: string;
  changed_by: string;
  created_at: string;
}

/** Plattad nyckel-värde-map (dot-notation) */
export type FlatMap = Record<string, string>;
