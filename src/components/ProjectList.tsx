import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { ThemeToggle } from './ThemeToggle';
import type { Project } from '../types';

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Kunde inte ladda projekt:', error);
    } else {
      setProjects(data ?? []);
    }
    setLoading(false);
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    const { error } = await supabase
      .from('projects')
      .insert({ name: name.trim() });

    if (error) {
      alert('Kunde inte skapa projekt: ' + error.message);
    } else {
      setName('');
      await loadProjects();
    }
    setCreating(false);
  }

  async function deleteProject(id: string, projectName: string) {
    if (!confirm(`Ta bort "${projectName}" och alla dess översättningar?`)) return;

    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) {
      alert('Kunde inte ta bort: ' + error.message);
    } else {
      await loadProjects();
    }
  }

  if (loading) {
    return <div className="page-center">Laddar...</div>;
  }

  return (
    <div className="page-center">
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <img src="/logo.svg" alt="Lingon" style={{ width: 48, height: 48, marginBottom: 12 }} />
        <h1>Translation Editor</h1>
        <p className="subtitle" style={{ marginBottom: 0 }}>by lingon.io</p>
      </div>

      <form className="create-form" onSubmit={createProject}>
        <input
          type="text"
          placeholder="Nytt projektnamn, t.ex. PDH Frontend"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={creating || !name.trim()}>
          Skapa
        </button>
      </form>

      {projects.length === 0 ? (
        <p className="empty">Inga projekt ännu. Skapa ett ovan.</p>
      ) : (
        <div className="project-list">
          {projects.map((p) => (
            <div key={p.id} className="project-card">
              <Link to={`/project/${p.id}`} className="project-link">
                <span className="project-name">{p.name}</span>
                <span className="project-meta">
                  {p.source_language.toUpperCase()} → {p.target_language.toUpperCase()}
                  {' · '}
                  Uppdaterad {new Date(p.updated_at).toLocaleDateString('sv-SE')}
                </span>
              </Link>
              <button
                className="delete-btn"
                onClick={() => deleteProject(p.id, p.name)}
                title="Ta bort projekt"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
