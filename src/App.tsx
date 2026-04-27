import { useEffect, useMemo, useState, type FormEvent } from "react";
import { loadProjects, saveProjects } from "./storage";
import type { Project, Song } from "./types";

type ProjectForm = Pick<Project, "name" | "description">;
type SongForm = Omit<Song, "id">;
type SongMode = { type: "create" } | { type: "edit"; songId: string };

const emptyProjectForm: ProjectForm = {
  name: "",
  description: ""
};

const emptySongForm: SongForm = {
  title: "",
  bpm: 120,
  timeSignatureNumerator: 4,
  timeSignatureDenominator: 4,
  countInBars: 1,
  notes: ""
};

const denominatorOptions = [2, 4, 8, 16];

function createId() {
  return window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(Math.round(value), min), max);
}

function normalizeSongForm(form: SongForm): SongForm {
  const denominator = denominatorOptions.includes(form.timeSignatureDenominator)
    ? form.timeSignatureDenominator
    : 4;

  return {
    title: form.title.trim(),
    bpm: clampNumber(form.bpm, 20, 300),
    timeSignatureNumerator: clampNumber(form.timeSignatureNumerator, 1, 16),
    timeSignatureDenominator: denominator,
    countInBars: clampNumber(form.countInBars, 0, 8),
    notes: form.notes.trim()
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectForm, setNewProjectForm] = useState<ProjectForm>(emptyProjectForm);
  const [projectForm, setProjectForm] = useState<ProjectForm>(emptyProjectForm);
  const [songMode, setSongMode] = useState<SongMode>({ type: "create" });
  const [songForm, setSongForm] = useState<SongForm>(emptySongForm);

  const selectedProject = useMemo(() => {
    return projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  }, [projects, selectedProjectId]);

  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId(null);
      return;
    }

    if (!selectedProjectId || !projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!selectedProject) {
      setProjectForm(emptyProjectForm);
      return;
    }

    setProjectForm({
      name: selectedProject.name,
      description: selectedProject.description
    });
    setSongMode({ type: "create" });
    setSongForm(emptySongForm);
  }, [selectedProject?.id]);

  function updateProject(projectId: string, updater: (project: Project) => Project) {
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.id === projectId
          ? {
              ...updater(project),
              updatedAt: new Date().toISOString()
            }
          : project
      )
    );
  }

  function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = newProjectForm.name.trim();
    const description = newProjectForm.description.trim();

    if (!name) {
      return;
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: createId(),
      name,
      description,
      songs: [],
      createdAt: now,
      updatedAt: now
    };

    setProjects((currentProjects) => [project, ...currentProjects]);
    setSelectedProjectId(project.id);
    setNewProjectForm(emptyProjectForm);
  }

  function handleSaveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProject) {
      return;
    }

    const name = projectForm.name.trim();

    if (!name) {
      return;
    }

    updateProject(selectedProject.id, (project) => ({
      ...project,
      name,
      description: projectForm.description.trim()
    }));
  }

  function handleDeleteProject() {
    if (!selectedProject) {
      return;
    }

    const confirmed = window.confirm(`Borrar el proyecto/banda "${selectedProject.name}"?`);

    if (!confirmed) {
      return;
    }

    setProjects((currentProjects) =>
      currentProjects.filter((project) => project.id !== selectedProject.id)
    );
  }

  function handleSongSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProject) {
      return;
    }

    const cleanSong = normalizeSongForm(songForm);

    if (!cleanSong.title) {
      return;
    }

    if (songMode.type === "edit") {
      updateProject(selectedProject.id, (project) => ({
        ...project,
        songs: project.songs.map((song) =>
          song.id === songMode.songId
            ? {
                ...song,
                ...cleanSong
              }
            : song
        )
      }));
    } else {
      updateProject(selectedProject.id, (project) => ({
        ...project,
        songs: [
          ...project.songs,
          {
            id: createId(),
            ...cleanSong
          }
        ]
      }));
    }

    setSongMode({ type: "create" });
    setSongForm(emptySongForm);
  }

  function handleEditSong(song: Song) {
    setSongMode({ type: "edit", songId: song.id });
    setSongForm({
      title: song.title,
      bpm: song.bpm,
      timeSignatureNumerator: song.timeSignatureNumerator,
      timeSignatureDenominator: song.timeSignatureDenominator,
      countInBars: song.countInBars,
      notes: song.notes
    });
  }

  function handleDeleteSong(songId: string) {
    if (!selectedProject) {
      return;
    }

    const song = selectedProject.songs.find((currentSong) => currentSong.id === songId);
    const confirmed = window.confirm(`Borrar la canción "${song?.title ?? ""}"?`);

    if (!confirmed) {
      return;
    }

    updateProject(selectedProject.id, (project) => ({
      ...project,
      songs: project.songs.filter((currentSong) => currentSong.id !== songId)
    }));

    if (songMode.type === "edit" && songMode.songId === songId) {
      setSongMode({ type: "create" });
      setSongForm(emptySongForm);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <span className="app-kicker">metronomo-live</span>
          <h1>Biblioteca musical</h1>
        </div>
        <p>{projects.length} proyectos/bandas</p>
      </header>

      <div className="workspace">
        <aside className="project-sidebar" aria-label="Proyectos y bandas">
          <form className="form-stack" onSubmit={handleCreateProject}>
            <h2>Nuevo proyecto/banda</h2>
            <label>
              Nombre
              <input
                value={newProjectForm.name}
                onChange={(event) =>
                  setNewProjectForm((current) => ({
                    ...current,
                    name: event.target.value
                  }))
                }
                placeholder="Ej: Banda principal"
                required
              />
            </label>
            <label>
              Descripción
              <textarea
                value={newProjectForm.description}
                onChange={(event) =>
                  setNewProjectForm((current) => ({
                    ...current,
                    description: event.target.value
                  }))
                }
                rows={3}
                placeholder="Notas de la banda o proyecto"
              />
            </label>
            <button type="submit">Crear</button>
          </form>

          <div className="project-list">
            {projects.length === 0 ? (
              <p className="empty-state">Todavía no hay proyectos.</p>
            ) : (
              projects.map((project) => (
                <button
                  className={
                    project.id === selectedProject?.id ? "project-item active" : "project-item"
                  }
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <strong>{project.name}</strong>
                  <span>{project.songs.length} canciones</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="content-panel">
          {selectedProject ? (
            <>
              <div className="section-header">
                <div>
                  <span className="section-label">Proyecto</span>
                  <h2>{selectedProject.name}</h2>
                  <p>Actualizado: {formatDate(selectedProject.updatedAt)}</p>
                </div>
                <button className="danger-button" type="button" onClick={handleDeleteProject}>
                  Borrar
                </button>
              </div>

              <form className="project-editor" onSubmit={handleSaveProject}>
                <label>
                  Nombre
                  <input
                    value={projectForm.name}
                    onChange={(event) =>
                      setProjectForm((current) => ({
                        ...current,
                        name: event.target.value
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  Descripción
                  <textarea
                    value={projectForm.description}
                    onChange={(event) =>
                      setProjectForm((current) => ({
                        ...current,
                        description: event.target.value
                      }))
                    }
                    rows={3}
                  />
                </label>
                <button type="submit">Guardar proyecto</button>
              </form>

              <div className="songs-area">
                <form className="song-editor" onSubmit={handleSongSubmit}>
                  <div className="section-header compact">
                    <div>
                      <span className="section-label">
                        {songMode.type === "edit" ? "Editar canción" : "Nueva canción"}
                      </span>
                      <h2>Canciones</h2>
                    </div>
                    {songMode.type === "edit" && (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          setSongMode({ type: "create" });
                          setSongForm(emptySongForm);
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>

                  <div className="song-grid">
                    <label className="wide-field">
                      Título
                      <input
                        value={songForm.title}
                        onChange={(event) =>
                          setSongForm((current) => ({
                            ...current,
                            title: event.target.value
                          }))
                        }
                        placeholder="Ej: Canción 1"
                        required
                      />
                    </label>
                    <label>
                      BPM
                      <input
                        min={20}
                        max={300}
                        type="number"
                        value={songForm.bpm}
                        onChange={(event) =>
                          setSongForm((current) => ({
                            ...current,
                            bpm: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                    <label>
                      Compás arriba
                      <input
                        min={1}
                        max={16}
                        type="number"
                        value={songForm.timeSignatureNumerator}
                        onChange={(event) =>
                          setSongForm((current) => ({
                            ...current,
                            timeSignatureNumerator: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                    <label>
                      Compás abajo
                      <select
                        value={songForm.timeSignatureDenominator}
                        onChange={(event) =>
                          setSongForm((current) => ({
                            ...current,
                            timeSignatureDenominator: Number(event.target.value)
                          }))
                        }
                      >
                        {denominatorOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Count-in
                      <input
                        min={0}
                        max={8}
                        type="number"
                        value={songForm.countInBars}
                        onChange={(event) =>
                          setSongForm((current) => ({
                            ...current,
                            countInBars: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                    <label className="wide-field">
                      Notas
                      <textarea
                        value={songForm.notes}
                        onChange={(event) =>
                          setSongForm((current) => ({
                            ...current,
                            notes: event.target.value
                          }))
                        }
                        rows={3}
                      />
                    </label>
                  </div>

                  <button type="submit">
                    {songMode.type === "edit" ? "Guardar canción" : "Crear canción"}
                  </button>
                </form>

                <div className="song-list">
                  {selectedProject.songs.length === 0 ? (
                    <p className="empty-state">Sin canciones.</p>
                  ) : (
                    selectedProject.songs.map((song) => (
                      <article className="song-card" key={song.id}>
                        <div>
                          <h3>{song.title}</h3>
                          <p>
                            {song.bpm} BPM · Compás {song.timeSignatureNumerator}/
                            {song.timeSignatureDenominator} · Count-in {song.countInBars}
                          </p>
                          {song.notes && <p className="song-notes">{song.notes}</p>}
                        </div>
                        <div className="song-actions">
                          <button type="button" onClick={() => handleEditSong(song)}>
                            Editar
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => handleDeleteSong(song.id)}
                          >
                            Borrar
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="empty-panel">
              <h2>Sin proyectos</h2>
              <p>Creá un proyecto o banda para cargar canciones.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
