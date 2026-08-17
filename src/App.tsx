import { Routes, Route } from 'react-router-dom';
import { ProjectList } from './components/ProjectList';
import { Editor } from './components/Editor';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectList />} />
      <Route path="/project/:id" element={<Editor />} />
    </Routes>
  );
}
