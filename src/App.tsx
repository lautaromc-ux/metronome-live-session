import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { deleteTrackFile, getTrackFile, saveTrackFile } from "./audioStorage";
import { LiveAudioEngine, type AudioChannelMode } from "./liveAudio";
import {
  createProjectsBackup,
  loadAdminSession,
  loadProjects,
  parseProjectsBackup,
  saveAdminSession,
  saveProjects
} from "./storage";
import type { Project, Show, Song } from "./types";

type ProjectForm = Pick<Project, "name" | "description">;
type SongForm = Omit<Song, "id">;
type ShowForm = Pick<Show, "title" | "date" | "notes">;
type SongMode = { type: "create" } | { type: "edit"; songId: string };
type ShowMode = { type: "create" } | { type: "edit"; showId: string };

const adminName = "Lautaro MC";
const adminPassword = "metro2026";

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
  notes: "",
  trackFileId: "",
  trackFileName: "",
  trackDuration: 0,
  trackEnabled: false,
  trackVolume: 1,
  clickVolume: 1
};

const emptyShowForm: ShowForm = {
  title: "",
  date: "",
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
    notes: form.notes.trim(),
    trackFileId: form.trackFileId,
    trackFileName: form.trackFileName,
    trackDuration: form.trackDuration,
    trackEnabled: Boolean(form.trackEnabled && form.trackFileId),
    trackVolume: Math.min(Math.max(form.trackVolume, 0), 1),
    clickVolume: Math.min(Math.max(form.clickVolume, 0), 1)
  };
}

function isAllowedAudioFile(file: File) {
  const allowedExtensions = [".mp3", ".wav", ".m4a", ".aac"];
  const lowerName = file.name.toLowerCase();
  const hasAllowedExtension = allowedExtensions.some((extension) => lowerName.endsWith(extension));

  return hasAllowedExtension && (file.type === "" || file.type.startsWith("audio/"));
}

async function getAudioDuration(file: File) {
  const context = new AudioContext();

  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    return buffer.duration;
  } finally {
    await context.close();
  }
}

function formatDuration(seconds: number) {
  if (!seconds) {
    return "";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatShowDate(value: string) {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "full"
  }).format(new Date(`${value}T12:00:00`));
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => loadAdminSession());
  const [loginName, setLoginName] = useState(adminName);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [newProjectForm, setNewProjectForm] = useState<ProjectForm>(emptyProjectForm);
  const [projectForm, setProjectForm] = useState<ProjectForm>(emptyProjectForm);
  const [songMode, setSongMode] = useState<SongMode>({ type: "create" });
  const [songForm, setSongForm] = useState<SongForm>(emptySongForm);
  const [showMode, setShowMode] = useState<ShowMode>({ type: "create" });
  const [showForm, setShowForm] = useState<ShowForm>(emptyShowForm);
  const [songToAddId, setSongToAddId] = useState("");
  const [trackError, setTrackError] = useState("");
  const [liveSongId, setLiveSongId] = useState("");
  const [channelMode, setChannelMode] = useState<AudioChannelMode>("normal");
  const [isLivePlaying, setIsLivePlaying] = useState(false);
  const [liveStatus, setLiveStatus] = useState("Listo para probar salida.");
  const [liveError, setLiveError] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [backupError, setBackupError] = useState("");
  const liveAudioRef = useRef<LiveAudioEngine | null>(null);

  const selectedProject = useMemo(() => {
    return projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  }, [projects, selectedProjectId]);

  const selectedShow = useMemo(() => {
    if (!selectedProject) {
      return null;
    }

    return selectedProject.shows.find((show) => show.id === selectedShowId) ?? selectedProject.shows[0] ?? null;
  }, [selectedProject, selectedShowId]);

  const selectedShowSongs = useMemo(() => {
    if (!selectedProject || !selectedShow) {
      return [];
    }

    return selectedShow.songIds
      .map((songId) => selectedProject.songs.find((song) => song.id === songId))
      .filter((song): song is Song => Boolean(song));
  }, [selectedProject, selectedShow]);

  const availableSongsForShow = useMemo(() => {
    if (!selectedProject || !selectedShow) {
      return [];
    }

    return selectedProject.songs.filter((song) => !selectedShow.songIds.includes(song.id));
  }, [selectedProject, selectedShow]);

  const liveSong = useMemo(() => {
    return selectedShowSongs.find((song) => song.id === liveSongId) ?? selectedShowSongs[0] ?? null;
  }, [liveSongId, selectedShowSongs]);

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
      setSelectedShowId(null);
      return;
    }

    setProjectForm({
      name: selectedProject.name,
      description: selectedProject.description
    });
    setSongMode({ type: "create" });
    setSongForm(emptySongForm);
    setTrackError("");

    if (!selectedShowId || !selectedProject.shows.some((show) => show.id === selectedShowId)) {
      setSelectedShowId(selectedProject.shows[0]?.id ?? null);
    }
  }, [selectedProject, selectedShowId]);

  useEffect(() => {
    setSongToAddId(availableSongsForShow[0]?.id ?? "");
  }, [availableSongsForShow]);

  useEffect(() => {
    if (!liveSongId || !selectedShowSongs.some((song) => song.id === liveSongId)) {
      setLiveSongId(selectedShowSongs[0]?.id ?? "");
    }
  }, [liveSongId, selectedShowSongs]);

  useEffect(() => {
    if (!liveAudioRef.current) {
      liveAudioRef.current = new LiveAudioEngine();
    }

    return () => {
      void liveAudioRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    void liveAudioRef.current?.stop();
    setIsLivePlaying(false);
  }, [liveSong?.id]);

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

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loginName.trim() === adminName && loginPassword === adminPassword) {
      setIsLoggedIn(true);
      saveAdminSession(true);
      setLoginError("");
      setLoginPassword("");
      return;
    }

    setLoginError("Usuario o contraseña incorrectos.");
  }

  function handleLogout() {
    setIsLoggedIn(false);
    saveAdminSession(false);
  }

  function handleExportBackup() {
    const backup = createProjectsBackup(projects);
    const backupJson = JSON.stringify(backup, null, 2);
    const blob = new Blob([backupJson], { type: "application/json" });
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);

    link.href = URL.createObjectURL(blob);
    link.download = `metronomo-live-backup-${date}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setBackupError("");
    setBackupStatus("Backup exportado. No incluye archivos de audio.");
  }

  async function handleImportBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".json")) {
      setBackupError("Elegí un archivo JSON exportado desde esta app.");
      setBackupStatus("");
      return;
    }

    const confirmed = window.confirm(
      "Importar este backup reemplaza los proyectos de este dispositivo. Las pistas de audio no se importan. Continuar?"
    );

    if (!confirmed) {
      return;
    }

    try {
      const importedProjects = parseProjectsBackup(await file.text());

      if (importedProjects.length === 0) {
        setBackupError("El backup no tiene proyectos para importar.");
        setBackupStatus("");
        return;
      }

      setProjects(importedProjects);
      saveProjects(importedProjects);
      setSelectedProjectId(importedProjects[0]?.id ?? null);
      setSelectedShowId(importedProjects[0]?.shows[0]?.id ?? null);
      setBackupError("");
      setBackupStatus("Backup importado. Las pistas de audio quedan vacias en este dispositivo.");
    } catch {
      setBackupError("No se pudo importar el backup. Revisá que sea un JSON válido.");
      setBackupStatus("");
    }
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
      shows: [],
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

    const confirmed = window.confirm(`Borrar el proyecto "${selectedProject.name}"?`);

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
          song.id === songMode.songId ? { ...song, ...cleanSong } : song
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
      notes: song.notes,
      trackFileId: song.trackFileId,
      trackFileName: song.trackFileName,
      trackDuration: song.trackDuration,
      trackEnabled: song.trackEnabled,
      trackVolume: song.trackVolume,
      clickVolume: song.clickVolume
    });
    setTrackError("");
  }

  async function handleDeleteSong(songId: string) {
    if (!selectedProject) {
      return;
    }

    const song = selectedProject.songs.find((currentSong) => currentSong.id === songId);
    const confirmed = window.confirm(`Borrar la canción "${song?.title ?? ""}"?`);

    if (!confirmed) {
      return;
    }

    try {
      await deleteTrackFile(songId);
    } catch {
      // Metadata removal must still work if IndexedDB cleanup fails.
    }

    updateProject(selectedProject.id, (project) => ({
      ...project,
      songs: project.songs.filter((currentSong) => currentSong.id !== songId),
      shows: project.shows.map((show) => ({
        ...show,
        songIds: show.songIds.filter((currentSongId) => currentSongId !== songId),
        updatedAt: new Date().toISOString()
      }))
    }));

    if (songMode.type === "edit" && songMode.songId === songId) {
      setSongMode({ type: "create" });
      setSongForm(emptySongForm);
    }
  }

  function updateSong(songId: string, updater: (song: Song) => Song) {
    if (!selectedProject) {
      return;
    }

    updateProject(selectedProject.id, (project) => ({
      ...project,
      songs: project.songs.map((song) => (song.id === songId ? updater(song) : song))
    }));
  }

  async function handleTrackFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || songMode.type !== "edit") {
      return;
    }

    if (!isAllowedAudioFile(file)) {
      setTrackError("Formato no permitido. Usá mp3, wav, m4a o aac.");
      return;
    }

    try {
      setTrackError("");
      const duration = await getAudioDuration(file);
      await saveTrackFile(songMode.songId, file);
      const nextTrackData = {
        trackFileId: songMode.songId,
        trackFileName: file.name,
        trackDuration: duration,
        trackEnabled: true
      };

      setSongForm((current) => ({
        ...current,
        ...nextTrackData
      }));
      updateSong(songMode.songId, (song) => ({
        ...song,
        ...nextTrackData
      }));
    } catch {
      setTrackError("No se pudo cargar esa pista. La canción puede seguir solo con click.");
    }
  }

  async function handleDeleteTrack() {
    if (songMode.type !== "edit" || !songForm.trackFileId) {
      return;
    }

    const confirmed = window.confirm(`Eliminar la pista "${songForm.trackFileName}"?`);

    if (!confirmed) {
      return;
    }

    try {
      await deleteTrackFile(songMode.songId);
      const emptyTrackData = {
        trackFileId: "",
        trackFileName: "",
        trackDuration: 0,
        trackEnabled: false
      };

      setSongForm((current) => ({
        ...current,
        ...emptyTrackData
      }));
      updateSong(songMode.songId, (song) => ({
        ...song,
        ...emptyTrackData
      }));
      setTrackError("");
    } catch {
      setTrackError("No se pudo eliminar la pista.");
    }
  }

  function handleSongVolumeChange(
    songId: string,
    field: "trackVolume" | "clickVolume",
    value: number
  ) {
    const nextValue = Math.min(Math.max(value, 0), 1);

    updateSong(songId, (song) => ({
      ...song,
      [field]: nextValue
    }));

    if (liveSong?.id === songId) {
      const nextTrackVolume = field === "trackVolume" ? nextValue : liveSong.trackVolume;
      const nextClickVolume = field === "clickVolume" ? nextValue : liveSong.clickVolume;
      liveAudioRef.current?.setVolumes(nextTrackVolume, nextClickVolume);
    }
  }

  async function handleStartLiveSong() {
    if (!liveSong || !liveAudioRef.current) {
      return;
    }

    setLiveError("");
    setLiveStatus("Preparando audio...");

    let trackFile: File | null = null;

    if (liveSong.trackEnabled && liveSong.trackFileId) {
      try {
        trackFile = await getTrackFile(liveSong.id);

        if (!trackFile) {
          setLiveError("No se encontró la pista guardada. Sale solo click.");
        }
      } catch {
        setLiveError("No se pudo leer la pista. Sale solo click.");
      }
    }

    try {
      await liveAudioRef.current.start({
        song: liveSong,
        trackFile,
        channelMode
      });
      setIsLivePlaying(true);
      setLiveStatus(trackFile ? "Pista + click en reproducción." : "Click solo en reproducción.");
    } catch {
      try {
        await liveAudioRef.current.start({
          song: liveSong,
          trackFile: null,
          channelMode
        });
        setIsLivePlaying(true);
        setLiveError("La pista falló. Se inició solo el click.");
        setLiveStatus("Click solo en reproducción.");
      } catch {
        setIsLivePlaying(false);
        setLiveError("No se pudo iniciar el audio.");
        setLiveStatus("Revisá permisos de audio del navegador.");
      }
    }
  }

  async function handleStopLiveSong() {
    await liveAudioRef.current?.stop();
    setIsLivePlaying(false);
    setLiveStatus("Detenido.");
  }

  function handleToggleChannelMode() {
    const nextMode: AudioChannelMode = channelMode === "normal" ? "inverted" : "normal";
    setChannelMode(nextMode);
    liveAudioRef.current?.setChannelMode(nextMode);
  }

  function handleShowSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProject) {
      return;
    }

    const title = showForm.title.trim();

    if (!title) {
      return;
    }

    if (showMode.type === "edit") {
      updateProject(selectedProject.id, (project) => ({
        ...project,
        shows: project.shows.map((show) =>
          show.id === showMode.showId
            ? {
                ...show,
                title,
                date: showForm.date,
                notes: showForm.notes.trim(),
                updatedAt: new Date().toISOString()
              }
            : show
        )
      }));
    } else {
      const now = new Date().toISOString();
      const show: Show = {
        id: createId(),
        title,
        date: showForm.date,
        songIds: [],
        notes: showForm.notes.trim(),
        createdAt: now,
        updatedAt: now
      };

      updateProject(selectedProject.id, (project) => ({
        ...project,
        shows: [show, ...project.shows]
      }));
      setSelectedShowId(show.id);
    }

    setShowMode({ type: "create" });
    setShowForm(emptyShowForm);
  }

  function handleEditShow(show: Show) {
    setShowMode({ type: "edit", showId: show.id });
    setShowForm({
      title: show.title,
      date: show.date,
      notes: show.notes
    });
  }

  function handleDeleteShow(showId: string) {
    if (!selectedProject) {
      return;
    }

    const show = selectedProject.shows.find((currentShow) => currentShow.id === showId);
    const confirmed = window.confirm(`Borrar el show "${show?.title ?? ""}"?`);

    if (!confirmed) {
      return;
    }

    updateProject(selectedProject.id, (project) => ({
      ...project,
      shows: project.shows.filter((currentShow) => currentShow.id !== showId)
    }));

    if (showMode.type === "edit" && showMode.showId === showId) {
      setShowMode({ type: "create" });
      setShowForm(emptyShowForm);
    }
  }

  function handleAddSongToShow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProject || !selectedShow || !songToAddId) {
      return;
    }

    updateProject(selectedProject.id, (project) => ({
      ...project,
      shows: project.shows.map((show) =>
        show.id === selectedShow.id
          ? {
              ...show,
              songIds: show.songIds.includes(songToAddId)
                ? show.songIds
                : [...show.songIds, songToAddId],
              updatedAt: new Date().toISOString()
            }
          : show
      )
    }));
  }

  function moveShowSong(index: number, direction: -1 | 1) {
    if (!selectedProject || !selectedShow) {
      return;
    }

    const nextIndex = index + direction;

    if (nextIndex < 0 || nextIndex >= selectedShow.songIds.length) {
      return;
    }

    const nextSongIds = [...selectedShow.songIds];
    const [songId] = nextSongIds.splice(index, 1);
    nextSongIds.splice(nextIndex, 0, songId);

    updateProject(selectedProject.id, (project) => ({
      ...project,
      shows: project.shows.map((show) =>
        show.id === selectedShow.id
          ? {
              ...show,
              songIds: nextSongIds,
              updatedAt: new Date().toISOString()
            }
          : show
      )
    }));
  }

  function removeSongFromShow(songId: string) {
    if (!selectedProject || !selectedShow) {
      return;
    }

    updateProject(selectedProject.id, (project) => ({
      ...project,
      shows: project.shows.map((show) =>
        show.id === selectedShow.id
          ? {
              ...show,
              songIds: show.songIds.filter((currentSongId) => currentSongId !== songId),
              updatedAt: new Date().toISOString()
            }
          : show
      )
    }));
  }

  if (!isLoggedIn) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <span className="app-kicker">metronomo-live</span>
          <h1>Ingreso admin</h1>
          <label>
            Usuario
            <input
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Contraseña
            <input
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {loginError && <p className="form-error">{loginError}</p>}
          <button type="submit">Entrar</button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <span className="app-kicker">metronomo-live</span>
          <h1>Hola, {adminName}</h1>
          <p>{projects.length} proyectos/bandas cargados</p>
        </div>
        <button className="secondary-button" type="button" onClick={handleLogout}>
          Salir
        </button>
      </header>

      <section className="local-data-notice">
        <strong>Datos locales</strong>
        <span>
          Los proyectos, canciones y shows se guardan en este dispositivo. Para pasar datos a otro
          celular, usá exportar/importar backup. Las pistas de audio no se incluyen.
        </span>
      </section>

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
                placeholder="Ej: Los sueños del equilibrio"
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
            <button type="submit">Crear proyecto</button>
          </form>

          <section className="backup-panel">
            <div>
              <span className="section-label">Backup</span>
              <h2>Exportar / importar</h2>
              <p>Incluye proyectos, canciones y shows. No incluye archivos de audio.</p>
            </div>
            <button type="button" onClick={handleExportBackup}>
              Exportar JSON
            </button>
            <label className="file-button secondary-file-button">
              Importar JSON
              <input accept=".json,application/json" type="file" onChange={handleImportBackup} />
            </label>
            {backupStatus && <p className="backup-status">{backupStatus}</p>}
            {backupError && <p className="form-error">{backupError}</p>}
          </section>

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
                  <span>
                    {project.songs.length} canciones · {project.shows.length} shows
                  </span>
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
                  <p>Actualizado: {formatDateTime(selectedProject.updatedAt)}</p>
                </div>
                <button className="danger-button" type="button" onClick={handleDeleteProject}>
                  Borrar proyecto
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

              <div className="management-grid">
                <section className="panel-section">
                  <form className="form-stack" onSubmit={handleSongSubmit}>
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

                    <div className="track-panel">
                      <div>
                        <span className="section-label">Pista de audio</span>
                        {songForm.trackFileName ? (
                          <p>
                            {songForm.trackFileName}
                            {songForm.trackDuration ? ` · ${formatDuration(songForm.trackDuration)}` : ""}
                          </p>
                        ) : (
                          <p>Sin pista cargada.</p>
                        )}
                      </div>

                      {songMode.type === "edit" ? (
                        <div className="track-actions">
                          <label className="file-button">
                            {songForm.trackFileName ? "Reemplazar pista" : "Agregar pista"}
                            <input
                              accept=".mp3,.wav,.m4a,.aac,audio/*"
                              type="file"
                              onChange={handleTrackFileChange}
                            />
                          </label>
                          {songForm.trackFileName && (
                            <button className="danger-button" type="button" onClick={handleDeleteTrack}>
                              Eliminar pista
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="empty-state">Guardá la canción para cargar una pista.</p>
                      )}

                      {trackError && <p className="form-error">{trackError}</p>}

                      <label className="switch-row">
                        <input
                          checked={songForm.trackEnabled}
                          disabled={!songForm.trackFileId}
                          type="checkbox"
                          onChange={(event) =>
                            setSongForm((current) => ({
                              ...current,
                              trackEnabled: event.target.checked
                            }))
                          }
                        />
                        Activar pista
                      </label>

                      <label>
                        Volumen pista: {Math.round(songForm.trackVolume * 100)}%
                        <input
                          min={0}
                          max={1}
                          step={0.01}
                          type="range"
                          value={songForm.trackVolume}
                          onChange={(event) =>
                            setSongForm((current) => ({
                              ...current,
                              trackVolume: Number(event.target.value)
                            }))
                          }
                        />
                      </label>

                      <label>
                        Volumen click: {Math.round(songForm.clickVolume * 100)}%
                        <input
                          min={0}
                          max={1}
                          step={0.01}
                          type="range"
                          value={songForm.clickVolume}
                          onChange={(event) =>
                            setSongForm((current) => ({
                              ...current,
                              clickVolume: Number(event.target.value)
                            }))
                          }
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
                            <p>
                              {song.trackFileName
                                ? `Pista ${song.trackEnabled ? "activa" : "apagada"} · ${
                                    song.trackFileName
                                  }`
                                : "Solo click"}
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
                </section>

                <section className="panel-section">
                  <form className="form-stack" onSubmit={handleShowSubmit}>
                    <div className="section-header compact">
                      <div>
                        <span className="section-label">
                          {showMode.type === "edit" ? "Editar show" : "Nuevo show"}
                        </span>
                        <h2>Shows</h2>
                      </div>
                      {showMode.type === "edit" && (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => {
                            setShowMode({ type: "create" });
                            setShowForm(emptyShowForm);
                          }}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>

                    <label>
                      Nombre
                      <input
                        value={showForm.title}
                        onChange={(event) =>
                          setShowForm((current) => ({
                            ...current,
                            title: event.target.value
                          }))
                        }
                        placeholder="Ej: Show 13 de mayo"
                        required
                      />
                    </label>
                    <label>
                      Fecha
                      <input
                        value={showForm.date}
                        onChange={(event) =>
                          setShowForm((current) => ({
                            ...current,
                            date: event.target.value
                          }))
                        }
                        type="date"
                      />
                    </label>
                    <label>
                      Notas
                      <textarea
                        value={showForm.notes}
                        onChange={(event) =>
                          setShowForm((current) => ({
                            ...current,
                            notes: event.target.value
                          }))
                        }
                        rows={3}
                      />
                    </label>
                    <button type="submit">
                      {showMode.type === "edit" ? "Guardar show" : "Crear show"}
                    </button>
                  </form>

                  <div className="show-list">
                    {selectedProject.shows.length === 0 ? (
                      <p className="empty-state">Sin shows.</p>
                    ) : (
                      selectedProject.shows.map((show) => (
                        <button
                          className={show.id === selectedShow?.id ? "show-item active" : "show-item"}
                          key={show.id}
                          type="button"
                          onClick={() => setSelectedShowId(show.id)}
                        >
                          <strong>{show.title}</strong>
                          <span>
                            {formatShowDate(show.date)} · {show.songIds.length} canciones
                          </span>
                        </button>
                      ))
                    )}
                  </div>

                  {selectedShow && (
                    <div className="setlist-panel">
                      <div className="section-header compact">
                        <div>
                          <span className="section-label">Orden del show</span>
                          <h2>{selectedShow.title}</h2>
                          <p>{formatShowDate(selectedShow.date)}</p>
                        </div>
                        <div className="song-actions">
                          <button type="button" onClick={() => handleEditShow(selectedShow)}>
                            Editar
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => handleDeleteShow(selectedShow.id)}
                          >
                            Borrar
                          </button>
                        </div>
                      </div>

                      <form className="add-song-form" onSubmit={handleAddSongToShow}>
                        <label>
                          Agregar canción
                          <select
                            value={songToAddId}
                            onChange={(event) => setSongToAddId(event.target.value)}
                            disabled={availableSongsForShow.length === 0}
                          >
                            {availableSongsForShow.length === 0 ? (
                              <option value="">No hay canciones disponibles</option>
                            ) : (
                              availableSongsForShow.map((song) => (
                                <option key={song.id} value={song.id}>
                                  {song.title}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                        <button type="submit" disabled={availableSongsForShow.length === 0}>
                          Agregar
                        </button>
                      </form>

                      <div className="setlist">
                        {selectedShowSongs.length === 0 ? (
                          <p className="empty-state">Este show todavía no tiene canciones.</p>
                        ) : (
                          selectedShowSongs.map((song, index) => (
                            <article
                              className={
                                song.id === liveSong?.id ? "setlist-item active" : "setlist-item"
                              }
                              key={song.id}
                            >
                              <strong>
                                {index + 1}. {song.title}
                              </strong>
                              <span>
                                {song.bpm} BPM · {song.timeSignatureNumerator}/
                                {song.timeSignatureDenominator}
                              </span>
                              <div className="setlist-actions">
                                <button
                                  type="button"
                                  onClick={() => setLiveSongId(song.id)}
                                >
                                  Vivo
                                </button>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => moveShowSong(index, -1)}
                                  disabled={index === 0}
                                >
                                  Subir
                                </button>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => moveShowSong(index, 1)}
                                  disabled={index === selectedShowSongs.length - 1}
                                >
                                  Bajar
                                </button>
                                <button
                                  className="danger-button"
                                  type="button"
                                  onClick={() => removeSongFromShow(song.id)}
                                >
                                  Quitar
                                </button>
                              </div>
                            </article>
                          ))
                        )}
                      </div>

                      <div className="live-panel">
                        <div>
                          <span className="section-label">Modo Vivo</span>
                          <h2>{liveSong?.title ?? "Sin canción seleccionada"}</h2>
                          <p>
                            {channelMode === "normal" ? "Pista L / Click R" : "Pista R / Click L"}
                          </p>
                        </div>

                        {liveSong ? (
                          <>
                            <label>
                              Canción
                              <select
                                value={liveSong.id}
                                onChange={(event) => setLiveSongId(event.target.value)}
                              >
                                {selectedShowSongs.map((song) => (
                                  <option key={song.id} value={song.id}>
                                    {song.title}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <div className="live-status">
                              <strong>
                                {liveSong.trackFileName && liveSong.trackEnabled
                                  ? `Pista activa: ${liveSong.trackFileName}`
                                  : "Solo click"}
                              </strong>
                              <span>{liveStatus}</span>
                              {liveError && <span className="form-error">{liveError}</span>}
                            </div>

                            <label>
                              Volumen pista: {Math.round(liveSong.trackVolume * 100)}%
                              <input
                                min={0}
                                max={1}
                                step={0.01}
                                type="range"
                                value={liveSong.trackVolume}
                                onChange={(event) =>
                                  handleSongVolumeChange(
                                    liveSong.id,
                                    "trackVolume",
                                    Number(event.target.value)
                                  )
                                }
                              />
                            </label>

                            <label>
                              Volumen click: {Math.round(liveSong.clickVolume * 100)}%
                              <input
                                min={0}
                                max={1}
                                step={0.01}
                                type="range"
                                value={liveSong.clickVolume}
                                onChange={(event) =>
                                  handleSongVolumeChange(
                                    liveSong.id,
                                    "clickVolume",
                                    Number(event.target.value)
                                  )
                                }
                              />
                            </label>

                            <div className="live-actions">
                              <button type="button" onClick={handleStartLiveSong}>
                                {isLivePlaying ? "Reiniciar" : "Iniciar"}
                              </button>
                              <button
                                className="danger-button"
                                type="button"
                                onClick={handleStopLiveSong}
                              >
                                Stop
                              </button>
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={handleToggleChannelMode}
                              >
                                Invertir canales
                              </button>
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() => liveAudioRef.current?.testChannel("left")}
                              >
                                Test L
                              </button>
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() => liveAudioRef.current?.testChannel("right")}
                              >
                                Test R
                              </button>
                            </div>
                          </>
                        ) : (
                          <p className="empty-state">Agregá canciones al show para usar Modo Vivo.</p>
                        )}
                      </div>
                    </div>
                  )}
                </section>
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
