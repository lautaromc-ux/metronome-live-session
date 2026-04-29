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
type AppScreen = "dashboard" | "project" | "show" | "live" | "rehearsal";

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
  clickEnabled: true,
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

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(Math.round(value), min), max);
}

function clampBpm(value: number) {
  if (!Number.isFinite(value)) {
    return 120;
  }

  const safeValue = Math.min(Math.max(value, 20), 300);
  return Math.round(safeValue * 100) / 100;
}

function normalizeSongForm(form: SongForm): SongForm {
  const denominator = denominatorOptions.includes(form.timeSignatureDenominator)
    ? form.timeSignatureDenominator
    : 4;

  return {
    title: form.title.trim(),
    bpm: clampBpm(form.bpm),
    timeSignatureNumerator: clampInteger(form.timeSignatureNumerator, 1, 16),
    timeSignatureDenominator: denominator,
    countInBars: clampInteger(form.countInBars, 0, 8),
    notes: form.notes.trim(),
    trackFileId: form.trackFileId,
    trackFileName: form.trackFileName,
    trackDuration: form.trackDuration,
    trackEnabled: Boolean(form.trackEnabled && form.trackFileId),
    clickEnabled: form.clickEnabled,
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

function getSongTimelineDuration(song: Song) {
  return song.trackFileId ? song.trackDuration : 0;
}

function getCountInDuration(song: Song) {
  if (!hasClickActive(song)) {
    return 0;
  }

  return song.countInBars * song.timeSignatureNumerator * (60 / song.bpm);
}

function formatBpm(bpm: number) {
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function hasTrackActive(song: Song) {
  return Boolean(song.trackEnabled && song.trackFileId);
}

function hasClickActive(song: Song) {
  return song.clickEnabled !== false;
}

function describePlayback(song: Song) {
  const trackActive = hasTrackActive(song);
  const clickActive = hasClickActive(song);

  if (trackActive && clickActive) {
    return "Pista + click";
  }

  if (trackActive) {
    return "Solo pista";
  }

  if (clickActive) {
    return "Solo click";
  }

  return "Audio apagado";
}

function isCoverSong(song: Song) {
  const optionalCoverFields = song as Song & {
    cover?: boolean;
    isCover?: boolean;
    songType?: string;
    type?: string;
  };

  return Boolean(
    optionalCoverFields.cover ||
      optionalCoverFields.isCover ||
      optionalCoverFields.songType === "cover" ||
      optionalCoverFields.type === "cover"
  );
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
  const [appScreen, setAppScreen] = useState<AppScreen>("dashboard");
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [newProjectForm, setNewProjectForm] = useState<ProjectForm>(emptyProjectForm);
  const [projectForm, setProjectForm] = useState<ProjectForm>(emptyProjectForm);
  const [isProjectEditorOpen, setIsProjectEditorOpen] = useState(false);
  const [songMode, setSongMode] = useState<SongMode>({ type: "create" });
  const [songForm, setSongForm] = useState<SongForm>(emptySongForm);
  const [isSongEditorOpen, setIsSongEditorOpen] = useState(false);
  const [showMode, setShowMode] = useState<ShowMode>({ type: "create" });
  const [showForm, setShowForm] = useState<ShowForm>(emptyShowForm);
  const [isShowCreatorOpen, setIsShowCreatorOpen] = useState(false);
  const [songToAddId, setSongToAddId] = useState("");
  const [trackError, setTrackError] = useState("");
  const [liveSongId, setLiveSongId] = useState("");
  const [liveViewShowId, setLiveViewShowId] = useState<string | null>(null);
  const [channelMode, setChannelMode] = useState<AudioChannelMode>("normal");
  const [isLivePlaying, setIsLivePlaying] = useState(false);
  const [isLivePaused, setIsLivePaused] = useState(false);
  const [liveElapsed, setLiveElapsed] = useState(0);
  const [liveDuration, setLiveDuration] = useState(0);
  const [isLiveTrackEnded, setIsLiveTrackEnded] = useState(false);
  const [isLiveFullscreen, setIsLiveFullscreen] = useState(false);
  const [liveStatus, setLiveStatus] = useState("Listo para probar salida.");
  const [liveError, setLiveError] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [backupError, setBackupError] = useState("");
  const liveAudioRef = useRef<LiveAudioEngine | null>(null);
  const liveStageRef = useRef<HTMLElement | null>(null);

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

  const rehearsalSongs = useMemo(() => {
    return selectedProject?.songs.filter((song) => !isCoverSong(song)) ?? [];
  }, [selectedProject]);

  const activePlaybackSongs = appScreen === "rehearsal" ? rehearsalSongs : selectedShowSongs;
  const isPlaybackScreen = appScreen === "live" || appScreen === "rehearsal";

  const availableSongsForShow = useMemo(() => {
    if (!selectedProject || !selectedShow) {
      return [];
    }

    return selectedProject.songs.filter((song) => !selectedShow.songIds.includes(song.id));
  }, [selectedProject, selectedShow]);

  const liveSong = useMemo(() => {
    return activePlaybackSongs.find((song) => song.id === liveSongId) ?? activePlaybackSongs[0] ?? null;
  }, [activePlaybackSongs, liveSongId]);

  const liveSongIndex = useMemo(() => {
    return liveSong ? activePlaybackSongs.findIndex((song) => song.id === liveSong.id) : -1;
  }, [activePlaybackSongs, liveSong]);

  const nextLiveSong = useMemo(() => {
    return liveSongIndex >= 0 ? activePlaybackSongs[liveSongIndex + 1] ?? null : null;
  }, [activePlaybackSongs, liveSongIndex]);

  const liveStageState = isLivePlaying
    ? "PLAYING"
    : isLivePaused || liveStatus === "Detenido."
      ? "STOPPED"
      : "READY";

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
    setLiveViewShowId((currentShowId) =>
      currentShowId && selectedProject.shows.some((show) => show.id === currentShowId)
        ? currentShowId
        : null
    );

    if (!selectedShowId || !selectedProject.shows.some((show) => show.id === selectedShowId)) {
      setSelectedShowId(selectedProject.shows[0]?.id ?? null);
    }
  }, [selectedProject, selectedShowId]);

  useEffect(() => {
    setSongToAddId(availableSongsForShow[0]?.id ?? "");
  }, [availableSongsForShow]);

  useEffect(() => {
    if (!liveSongId || !activePlaybackSongs.some((song) => song.id === liveSongId)) {
      setLiveSongId(activePlaybackSongs[0]?.id ?? "");
    }
  }, [activePlaybackSongs, liveSongId]);

  useEffect(() => {
    if (!liveAudioRef.current) {
      liveAudioRef.current = new LiveAudioEngine();
    }

    return () => {
      void liveAudioRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsLiveFullscreen(Boolean(document.fullscreenElement));
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    void liveAudioRef.current?.stop();
    setIsLivePlaying(false);
    setIsLivePaused(false);
    setLiveElapsed(0);
    setLiveDuration(liveSong ? getSongTimelineDuration(liveSong) : 0);
    setIsLiveTrackEnded(false);
    setLiveStatus("Listo para probar salida.");
    setLiveError("");
  }, [liveSong?.id]);

  useEffect(() => {
    if (!isPlaybackScreen || !liveSong) {
      return;
    }

    const timer = window.setInterval(() => {
      const engine = liveAudioRef.current;
      const engineTrackDuration = engine?.getTrackDuration() ?? 0;
      const trackDuration = engineTrackDuration || getSongTimelineDuration(liveSong);
      const trackEnded = Boolean(engine?.isTrackEnded());

      setLiveElapsed(trackDuration ? engine?.getTrackPosition() ?? 0 : engine?.getPosition() ?? 0);
      setLiveDuration(trackDuration);
      setIsLiveTrackEnded(trackEnded);

      if (trackEnded && isLivePlaying) {
        setLiveStatus((currentStatus) =>
          currentStatus.startsWith("Track finalizado")
            ? currentStatus
            : hasClickActive(liveSong)
              ? "Track finalizado. Click libre activo."
              : "Track finalizado."
        );
      }
    }, 200);

    return () => window.clearInterval(timer);
  }, [isLivePlaying, isPlaybackScreen, liveSong]);

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
    setAppScreen("dashboard");
    saveAdminSession(false);
  }

  function handleOpenProject(projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedShowId(null);
    setIsProjectEditorOpen(false);
    setIsShowCreatorOpen(false);
    setIsSongEditorOpen(false);
    setSongMode({ type: "create" });
    setSongForm(emptySongForm);
    setAppScreen("project");
  }

  async function handleBackToDashboard() {
    await liveAudioRef.current?.stop();
    setIsLivePlaying(false);
    setIsLivePaused(false);
    setAppScreen("dashboard");
  }

  async function handleBackToProject() {
    await liveAudioRef.current?.stop();
    setIsLivePlaying(false);
    setIsLivePaused(false);
    setAppScreen("project");
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
    setAppScreen("project");
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
    setIsProjectEditorOpen(false);
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
    setIsSongEditorOpen(false);
  }

  function handleEditSong(song: Song) {
    setSongMode({ type: "edit", songId: song.id });
    setIsSongEditorOpen(true);
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
      clickEnabled: song.clickEnabled,
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
      setIsSongEditorOpen(false);
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
      liveAudioRef.current?.setVolumes(hasTrackActive(liveSong) ? 1 : 0, hasClickActive(liveSong) ? 1 : 0);
    }
  }

  function handleSongSwitchChange(
    songId: string,
    field: "trackEnabled" | "clickEnabled",
    value: boolean
  ) {
    updateSong(songId, (song) => ({
      ...song,
      [field]: field === "trackEnabled" ? Boolean(value && song.trackFileId) : value
    }));

    if (liveSong?.id === songId) {
      const nextSong = {
        ...liveSong,
        [field]: field === "trackEnabled" ? Boolean(value && liveSong.trackFileId) : value
      };

      liveAudioRef.current?.setVolumes(hasTrackActive(nextSong) ? 1 : 0, hasClickActive(nextSong) ? 1 : 0);
    }
  }

  function handleOpenLiveView(show: Show) {
    if (show.songIds.length === 0) {
      setLiveError("No se puede entrar al Modo Live con un show sin canciones.");
      return;
    }

    setSelectedShowId(show.id);
    setLiveViewShowId(show.id);
    const firstSongId = show.songIds[0] ?? "";

    if (firstSongId) {
      setLiveSongId(firstSongId);
    }

    setAppScreen("live");
  }

  function handleOpenRehearsalView() {
    if (!selectedProject) {
      return;
    }

    if (rehearsalSongs.length === 0) {
      setLiveError("Este proyecto no tiene temas disponibles para ensayo.");
      return;
    }

    setLiveSongId(rehearsalSongs[0].id);
    setLiveElapsed(0);
    setIsLivePlaying(false);
    setIsLivePaused(false);
    setIsLiveTrackEnded(false);
    setLiveStatus("Listo para ensayar.");
    setLiveError("");
    setAppScreen("rehearsal");
  }

  async function handleCloseLiveView() {
    await liveAudioRef.current?.stop();
    setIsLivePlaying(false);
    setIsLivePaused(false);
    setIsLiveTrackEnded(false);
    setLiveViewShowId(null);
    setAppScreen(appScreen === "rehearsal" ? "project" : "show");
  }

  async function handleSelectLiveSong(songId: string) {
    await liveAudioRef.current?.stop();
    setIsLivePlaying(false);
    setIsLivePaused(false);
    setLiveSongId(songId);
    setLiveElapsed(0);
    setIsLiveTrackEnded(false);
    setLiveStatus("Listo para probar salida.");
    setLiveError("");
  }

  async function handleMoveLiveSong(direction: -1 | 1) {
    if (liveSongIndex < 0) {
      return;
    }

    const nextSong = activePlaybackSongs[liveSongIndex + direction];

    if (nextSong) {
      await handleSelectLiveSong(nextSong.id);
    }
  }

  async function handleStartLiveSong() {
    if (!liveSong || !liveAudioRef.current) {
      return;
    }

    if (!hasClickActive(liveSong) && !hasTrackActive(liveSong)) {
      setLiveError("Activá pista o click para iniciar.");
      setLiveStatus("Audio apagado.");
      return;
    }

    setLiveError("");
    setLiveStatus("Preparando audio...");

    let trackFile: File | null = null;

    if (liveSong.trackFileId) {
      try {
        trackFile = await getTrackFile(liveSong.id);

        if (!trackFile && hasTrackActive(liveSong)) {
          setLiveError("No se encontró la pista guardada. Sale solo click.");
        }
      } catch {
        setLiveError("No se pudo leer la pista. Sale solo click.");
      }
    }

    try {
      const startOffset =
        liveSong.trackFileId && liveElapsed > 0 ? getCountInDuration(liveSong) + liveElapsed : liveElapsed;

      await liveAudioRef.current.start({
        song: liveSong,
        trackFile,
        channelMode,
        offsetSeconds: startOffset
      });
      setIsLivePlaying(true);
      setIsLivePaused(false);
      setIsLiveTrackEnded(false);
      setLiveStatus(`${describePlayback(liveSong)} en reproducción.`);
    } catch {
      if (!hasClickActive(liveSong)) {
        setIsLivePlaying(false);
        setLiveError("La pista falló y el click está apagado.");
        setLiveStatus("No hay audio para reproducir.");
        return;
      }

      try {
        await liveAudioRef.current.start({
          song: {
            ...liveSong,
            trackEnabled: false
          },
          trackFile: null,
          channelMode,
          offsetSeconds: liveElapsed
        });
        setIsLivePlaying(true);
        setIsLivePaused(false);
        setIsLiveTrackEnded(false);
        setLiveError("La pista falló. Se inició sin pista.");
        setLiveStatus(hasClickActive(liveSong) ? "Solo click en reproducción." : "Audio apagado.");
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
    setIsLivePaused(false);
    setLiveElapsed(0);
    setIsLiveTrackEnded(false);
    setLiveStatus("Detenido.");
  }

  function handlePauseLiveSong() {
    const engine = liveAudioRef.current;

    engine?.pause();
    setLiveElapsed(liveDuration ? engine?.getTrackPosition() ?? liveElapsed : engine?.getPosition() ?? liveElapsed);
    setIsLivePlaying(false);
    setIsLivePaused(true);
    setLiveStatus("Pausado.");
  }

  function handleResumeLiveSong() {
    liveAudioRef.current?.resume();
    setIsLivePlaying(true);
    setIsLivePaused(false);
    setLiveStatus(`${liveSong ? describePlayback(liveSong) : "Audio"} en reproducción.`);
  }

  function handlePlayPauseLiveSong() {
    if (isLivePlaying) {
      handlePauseLiveSong();
      return;
    }

    if (isLivePaused) {
      handleResumeLiveSong();
      return;
    }

    void handleStartLiveSong();
  }

  function handleSeekLiveSong(position: number) {
    if (!liveDuration) {
      return;
    }

    const nextPosition = Math.max(0, Math.min(position, liveDuration));
    liveAudioRef.current?.seekTrackTo(nextPosition);
    setLiveElapsed(nextPosition);
    setIsLiveTrackEnded(nextPosition >= liveDuration);
  }

  function handleLiveToggle(field: "trackEnabled" | "clickEnabled") {
    if (!liveSong) {
      return;
    }

    const nextSong: Song = {
      ...liveSong,
      [field]:
        field === "trackEnabled" ? Boolean(!liveSong.trackEnabled && liveSong.trackFileId) : !liveSong.clickEnabled
    };

    if (field === "trackEnabled" && !liveSong.trackFileId) {
      setLiveError("Esta canción no tiene pista cargada.");
      return;
    }

    if (!hasTrackActive(nextSong) && !hasClickActive(nextSong)) {
      setLiveError("En vivo no puede quedar click y pista apagados al mismo tiempo.");
      return;
    }

    setLiveError("");
    updateSong(liveSong.id, () => nextSong);
    liveAudioRef.current?.setVolumes(hasTrackActive(nextSong) ? 1 : 0, hasClickActive(nextSong) ? 1 : 0);

    if (field === "trackEnabled" && hasTrackActive(nextSong) && liveAudioRef.current?.isTrackEnded()) {
      setLiveStatus("Track finalizado. Volvé al inicio o mové la línea de tiempo para escucharlo.");
      setIsLiveTrackEnded(true);
      return;
    }

    setLiveStatus(
      isLivePlaying
        ? `${describePlayback(nextSong)} en reproducción.`
        : isLivePaused
          ? "Pausado."
          : "Listo para probar salida."
    );
  }

  function handleToggleChannelMode() {
    const nextMode: AudioChannelMode = channelMode === "normal" ? "inverted" : "normal";
    setChannelMode(nextMode);
    liveAudioRef.current?.setChannelMode(nextMode);
  }

  async function handleToggleFullscreen() {
    const target = liveStageRef.current;

    if (!target) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsLiveFullscreen(false);
        return;
      }

      if (!target.requestFullscreen) {
        setIsLiveFullscreen(true);
        setLiveStatus("Modo escenario activo. En iPhone, para pantalla completa real usá Agregar a inicio.");
        return;
      }

      await target.requestFullscreen();
      setIsLiveFullscreen(true);
    } catch {
      setIsLiveFullscreen(true);
      setLiveStatus("Modo escenario activo. Si Safari no permite fullscreen, agregá la app a inicio.");
    }
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
      setAppScreen("show");
    }

    setShowMode({ type: "create" });
    setShowForm(emptyShowForm);
    setIsShowCreatorOpen(false);
  }

  function handleEditShow(show: Show) {
    setShowMode({ type: "edit", showId: show.id });
    setShowForm({
      title: show.title,
      date: show.date,
      notes: show.notes
    });
  }

  function handleOpenShow(showId: string) {
    setSelectedShowId(showId);
    setShowMode({ type: "create" });
    setShowForm(emptyShowForm);
    setLiveError("");
    setAppScreen("show");
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

  if (appScreen === "dashboard") {
    return (
      <main className="app-shell screen-shell">
        <header className="app-header">
          <div>
            <span className="app-kicker">metronomo-live</span>
            <h1>Proyectos</h1>
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
            celular, usá exportar/importar backup.
          </span>
        </section>

        <section className="dashboard-grid">
          <form className="panel-section form-stack" onSubmit={handleCreateProject}>
            <h2>Crear nuevo proyecto</h2>
            <label>
              Nombre
              <input
                value={newProjectForm.name}
                onChange={(event) =>
                  setNewProjectForm((current) => ({ ...current, name: event.target.value }))
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
                  setNewProjectForm((current) => ({ ...current, description: event.target.value }))
                }
                rows={3}
              />
            </label>
            <button type="submit">Crear nuevo proyecto</button>
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
        </section>

        <section className="project-card-grid">
          {projects.length === 0 ? (
            <div className="empty-panel">
              <h2>Sin proyectos</h2>
              <p>Creá tu primera banda/proyecto para cargar temas y shows.</p>
            </div>
          ) : (
            projects.map((project) => (
              <button
                className="project-card"
                key={project.id}
                type="button"
                onClick={() => handleOpenProject(project.id)}
              >
                <strong>{project.name}</strong>
                <span>{project.description || "Sin descripción"}</span>
                <small>
                  {project.songs.length} temas · {project.shows.length} shows
                </small>
              </button>
            ))
          )}
        </section>
      </main>
    );
  }

  if (appScreen === "project" && selectedProject) {
    return (
      <main className="app-shell screen-shell">
        <header className="app-header">
          <div>
            <span className="app-kicker">Proyecto</span>
            <h1>{selectedProject.name}</h1>
            <p>{selectedProject.songs.length} temas · {selectedProject.shows.length} shows</p>
          </div>
          <div className="project-header-actions">
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={() => setIsProjectEditorOpen((current) => !current)}
            >
              {isProjectEditorOpen ? "Cerrar edición" : "Editar proyecto"}
            </button>
            <button className="secondary-button compact-button" type="button" onClick={() => void handleBackToDashboard()}>
              Volver
            </button>
          </div>
        </header>

        <div className="project-detail-stack">
          {isProjectEditorOpen && (
          <section className="panel-section project-edit-panel">
            <form className="form-stack" onSubmit={handleSaveProject}>
              <div className="section-header compact">
                <div>
                  <span className="section-label">Datos</span>
                  <h2>Proyecto</h2>
                </div>
              </div>
              <label>
                Nombre
                <input
                  value={projectForm.name}
                  onChange={(event) =>
                    setProjectForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Descripción
                <textarea
                  value={projectForm.description}
                  onChange={(event) =>
                    setProjectForm((current) => ({ ...current, description: event.target.value }))
                  }
                  rows={3}
                />
              </label>
              <button type="submit">Guardar proyecto</button>
            </form>
          </section>
          )}

          <section className="panel-section">
            <div className="section-header compact">
              <div>
                <span className="section-label">Shows</span>
                <h2>Shows</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowMode({ type: "create" });
                  setShowForm(emptyShowForm);
                  setIsShowCreatorOpen((current) => !current);
                }}
              >
                Crear show
              </button>
            </div>

            {isShowCreatorOpen && (
            <form className="form-stack" onSubmit={handleShowSubmit}>
              <label>
                Nombre
                <input
                  value={showForm.title}
                  onChange={(event) =>
                    setShowForm((current) => ({ ...current, title: event.target.value }))
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
                    setShowForm((current) => ({ ...current, date: event.target.value }))
                  }
                  type="date"
                />
              </label>
              <button type="submit">Crear show</button>
            </form>
            )}

            <div className="show-list">
              {selectedProject.shows.length === 0 ? (
                <p className="empty-state">Todavía no hay shows.</p>
              ) : (
                selectedProject.shows.map((show) => (
                  <article className="show-card" key={show.id}>
                    <div>
                      <strong>{show.title}</strong>
                      <span>
                        {formatShowDate(show.date)} · {show.songIds.length} canciones
                      </span>
                    </div>
                    <div className="song-actions">
                      <button type="button" onClick={() => handleOpenShow(show.id)}>
                        Abrir / editar
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => handleOpenLiveView(show)}
                        disabled={show.songIds.length === 0}
                      >
                        Modo Live
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
            {liveError && <p className="form-error">{liveError}</p>}
          </section>

          <section className="panel-section rehearsal-entry-panel">
            <div className="section-header compact">
              <div>
                <span className="section-label">Ensayo</span>
                <h2>Modo Ensayo</h2>
                <p>Reproducí temas sueltos del proyecto sin crear un show.</p>
              </div>
              <button
                type="button"
                onClick={handleOpenRehearsalView}
                disabled={rehearsalSongs.length === 0}
              >
                Modo Ensayo
              </button>
            </div>
            {selectedProject.songs.length > rehearsalSongs.length && (
              <p className="empty-state">
                Hay temas marcados como cover ocultos del ensayo.
              </p>
            )}
          </section>

          <section className="panel-section">
            <div className="section-header compact">
              <div>
                <span className="section-label">Temas</span>
                <h2>Temas</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSongMode({ type: "create" });
                  setSongForm(emptySongForm);
                  setTrackError("");
                  setIsSongEditorOpen((current) => !current);
                }}
              >
                Crear tema
              </button>
            </div>

            {isSongEditorOpen && (
            <form className="form-stack" onSubmit={handleSongSubmit}>
              <div className="section-header compact">
                <div>
                  <span className="section-label">
                    {songMode.type === "edit" ? "Editar tema" : "Nuevo tema"}
                  </span>
                  <h2>Temas</h2>
                </div>
                {songMode.type === "edit" && (
                  <button
                    className="secondary-button"
                          type="button"
                          onClick={() => {
                            setSongMode({ type: "create" });
                            setSongForm(emptySongForm);
                            setIsSongEditorOpen(false);
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
                      setSongForm((current) => ({ ...current, title: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  BPM
                  <input
                    min={20}
                    max={300}
                    step={0.01}
                    type="number"
                    value={songForm.bpm}
                    onChange={(event) =>
                      setSongForm((current) => ({ ...current, bpm: Number(event.target.value) }))
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
                      setSongForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    rows={3}
                  />
                </label>
              </div>

              <div className="track-panel">
                <div>
                  <span className="section-label">Audio</span>
                  <p>
                    {songForm.trackFileName
                      ? `${songForm.trackFileName} · ${formatDuration(songForm.trackDuration)}`
                      : "Sin pista cargada."}
                  </p>
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
                  <p className="empty-state">Guardá el tema para cargar una pista.</p>
                )}
                {trackError && <p className="form-error">{trackError}</p>}
                <div className="live-toggle-grid">
                  <label className="switch-row">
                    <input
                      checked={songForm.clickEnabled}
                      type="checkbox"
                      onChange={(event) =>
                        setSongForm((current) => ({ ...current, clickEnabled: event.target.checked }))
                      }
                    />
                    Click activo
                  </label>
                  <label className="switch-row">
                    <input
                      checked={songForm.trackEnabled}
                      disabled={!songForm.trackFileId}
                      type="checkbox"
                      onChange={(event) =>
                        setSongForm((current) => ({ ...current, trackEnabled: event.target.checked }))
                      }
                    />
                    Track activo
                  </label>
                </div>
              </div>

              <button type="submit">{songMode.type === "edit" ? "Guardar tema" : "Crear tema"}</button>
            </form>
            )}

            <div className="song-list">
              {selectedProject.songs.length === 0 ? (
                <p className="empty-state">Sin temas cargados.</p>
              ) : (
                selectedProject.songs.map((song) => (
                  <article className="song-card" key={song.id}>
                    <div>
                      <h3>{song.title}</h3>
                      <p>
                        {formatBpm(song.bpm)} BPM · {song.timeSignatureNumerator}/
                        {song.timeSignatureDenominator} · {describePlayback(song)}
                      </p>
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

          <section className="danger-zone">
            <div>
              <span className="section-label">Zona peligrosa</span>
              <h2>Borrar proyecto</h2>
              <p>Esta acción elimina el proyecto, sus temas y sus shows de este dispositivo.</p>
            </div>
            <button className="danger-button" type="button" onClick={handleDeleteProject}>
              Borrar proyecto
            </button>
          </section>
        </div>
      </main>
    );
  }

  if (appScreen === "show" && selectedProject && selectedShow) {
    return (
      <main className="app-shell screen-shell">
        <header className="app-header">
          <div>
            <span className="app-kicker">{selectedProject.name}</span>
            <h1>{selectedShow.title}</h1>
            <p>{formatShowDate(selectedShow.date)} · {selectedShowSongs.length} canciones</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void handleBackToProject()}>
            Volver al proyecto
          </button>
        </header>

        <section className="show-editor-screen">
          <div className="setlist-panel">
            <div className="section-header compact">
              <div>
                <span className="section-label">Setlist</span>
                <h2>Orden del show</h2>
              </div>
              <div className="song-actions">
                <button
                  type="button"
                  onClick={() => handleOpenLiveView(selectedShow)}
                  disabled={selectedShowSongs.length === 0}
                >
                  Entrar en Modo Live
                </button>
                <button type="button" onClick={() => handleEditShow(selectedShow)}>
                  Editar datos
                </button>
              </div>
            </div>

            {showMode.type === "edit" && (
              <form className="form-stack" onSubmit={handleShowSubmit}>
                <label>
                  Nombre
                  <input
                    value={showForm.title}
                    onChange={(event) =>
                      setShowForm((current) => ({ ...current, title: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Fecha
                  <input
                    value={showForm.date}
                    onChange={(event) =>
                      setShowForm((current) => ({ ...current, date: event.target.value }))
                    }
                    type="date"
                  />
                </label>
                <button type="submit">Guardar show</button>
              </form>
            )}

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
                  <article className="setlist-item" key={song.id}>
                    <strong>
                      {index + 1}. {song.title}
                    </strong>
                    <span>
                      {formatBpm(song.bpm)} BPM · {song.timeSignatureNumerator}/
                      {song.timeSignatureDenominator} · {describePlayback(song)}
                    </span>
                    <div className="setlist-actions">
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
          </div>
        </section>
      </main>
    );
  }

  if (appScreen === "rehearsal" && selectedProject) {
    return (
      <main className="live-stage-shell rehearsal-shell" ref={liveStageRef}>
        <header className="live-stage-header">
          <div>
            <span className="app-kicker">{selectedProject.name}</span>
            <h1>Modo Ensayo</h1>
            <p>{rehearsalSongs.length} temas disponibles</p>
          </div>
          <div className="live-header-actions">
            <button className="secondary-button" type="button" onClick={() => void handleToggleFullscreen()}>
              {isLiveFullscreen ? "Salir pantalla completa" : "Pantalla completa"}
            </button>
            <button className="secondary-button" type="button" onClick={() => void handleCloseLiveView()}>
              Volver al proyecto
            </button>
          </div>
        </header>

        <section className="rehearsal-stage">
          <aside className="rehearsal-song-list">
            <span className="section-label">Temas del proyecto</span>
            {rehearsalSongs.length === 0 ? (
              <p className="empty-state">No hay temas disponibles para ensayo.</p>
            ) : (
              rehearsalSongs.map((song, index) => (
                <button
                  className={song.id === liveSong?.id ? "rehearsal-song-button active" : "rehearsal-song-button"}
                  key={song.id}
                  type="button"
                  onClick={() => void handleSelectLiveSong(song.id)}
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{song.title}</strong>
                    <small>{formatBpm(song.bpm)} BPM · {describePlayback(song)}</small>
                  </div>
                </button>
              ))
            )}
          </aside>

          {liveSong ? (
            <div className="stage-main rehearsal-player">
              <div className="stage-topline">
                <span className={`stage-state ${liveStageState.toLowerCase()}`}>{liveStageState}</span>
                <span>
                  Tema {liveSongIndex + 1} de {activePlaybackSongs.length}
                </span>
              </div>

              <div className="live-meter">
                <h2>{liveSong.title}</h2>
                <strong>{formatBpm(liveSong.bpm)} BPM</strong>
                <p>
                  {liveSong.timeSignatureNumerator}/{liveSong.timeSignatureDenominator} · Count-in{" "}
                  {liveSong.countInBars}
                </p>
              </div>

              <div className="stage-indicators">
                <button
                  className={hasClickActive(liveSong) ? "indicator on" : "indicator off"}
                  type="button"
                  onClick={() => handleLiveToggle("clickEnabled")}
                >
                  CLICK {hasClickActive(liveSong) ? "ON" : "OFF"}
                </button>
                <button
                  className={hasTrackActive(liveSong) ? "indicator on" : "indicator off"}
                  type="button"
                  onClick={() => handleLiveToggle("trackEnabled")}
                  disabled={!liveSong.trackFileId}
                >
                  TRACK {hasTrackActive(liveSong) ? "ON" : "OFF"}
                </button>
                <span className="indicator route">
                  {channelMode === "normal" ? "TRACK L / CLICK R" : "TRACK R / CLICK L"}
                </span>
              </div>

              <div className="stage-progress">
                <div>
                  <strong>{formatDuration(liveDuration ? Math.min(liveElapsed, liveDuration) : liveElapsed)}</strong>
                  <span>
                    {liveDuration
                      ? isLiveTrackEnded
                        ? "Track finalizado"
                        : `Pista ${formatDuration(liveDuration)}`
                      : "Click libre"}
                  </span>
                </div>
                {liveDuration ? (
                  <input
                    min={0}
                    max={liveDuration}
                    step={0.1}
                    type="range"
                    value={Math.min(liveElapsed, liveDuration)}
                    onChange={(event) => handleSeekLiveSong(Number(event.target.value))}
                  />
                ) : (
                  <div className="free-click-progress">Metrónomo sin duración final</div>
                )}
              </div>

              <div className="stage-actions">
                <button
                  className="stage-button play"
                  type="button"
                  onClick={handlePlayPauseLiveSong}
                  disabled={!isLivePlaying && !hasClickActive(liveSong) && !hasTrackActive(liveSong)}
                >
                  {isLivePlaying ? "PAUSE" : isLivePaused ? "RESUME" : "PLAY"}
                </button>
                <button
                  className="stage-button stop"
                  type="button"
                  onClick={handleStopLiveSong}
                  disabled={!isLivePlaying && !isLivePaused && liveElapsed === 0}
                >
                  STOP
                </button>
                <button
                  className="stage-button previous"
                  type="button"
                  onClick={() => void handleMoveLiveSong(-1)}
                  disabled={liveSongIndex <= 0}
                >
                  PREVIOUS
                </button>
                <button
                  className="stage-button next"
                  type="button"
                  onClick={() => void handleMoveLiveSong(1)}
                  disabled={liveSongIndex >= activePlaybackSongs.length - 1}
                >
                  NEXT
                </button>
              </div>

              <div className="stage-message">
                <strong>{describePlayback(liveSong)}</strong>
                <span>{liveStatus}</span>
                {liveError && <span className="form-error">{liveError}</span>}
              </div>
            </div>
          ) : (
            <section className="empty-panel">
              <h2>Sin temas para ensayo</h2>
              <p>Volvé al proyecto y cargá temas para poder ensayar.</p>
            </section>
          )}
        </section>
      </main>
    );
  }

  if (appScreen === "live" && selectedProject && selectedShow) {
    return (
      <main
        className={isLiveFullscreen ? "live-stage-shell stage-fullscreen" : "live-stage-shell"}
        ref={liveStageRef}
      >
        <header className="live-stage-header">
          <div>
            <span className="app-kicker">{selectedProject.name}</span>
            <h1>{selectedShow.title}</h1>
            <p>{formatShowDate(selectedShow.date)}</p>
          </div>
          <div className="live-header-actions">
            <button className="secondary-button" type="button" onClick={() => void handleToggleFullscreen()}>
              {isLiveFullscreen ? "Salir pantalla completa" : "Pantalla completa"}
            </button>
            <button className="secondary-button" type="button" onClick={() => void handleCloseLiveView()}>
              Volver
            </button>
          </div>
        </header>

        {liveSong ? (
          <section className="live-stage">
            <div className="stage-performance">
              <div className="stage-main">
                <div className="stage-topline">
                  <span className={`stage-state ${liveStageState.toLowerCase()}`}>
                    {liveStageState}
                  </span>
                  <span>
                    Tema {liveSongIndex + 1} de {selectedShowSongs.length}
                  </span>
                </div>

                <div className="live-meter">
                  <h2>{liveSong.title}</h2>
                  <strong>{formatBpm(liveSong.bpm)} BPM</strong>
                  <p>
                    {liveSong.timeSignatureNumerator}/{liveSong.timeSignatureDenominator} · Count-in{" "}
                    {liveSong.countInBars}
                  </p>
                </div>

                <div className="stage-indicators">
                  <button
                    className={hasClickActive(liveSong) ? "indicator on" : "indicator off"}
                    type="button"
                    onClick={() => handleLiveToggle("clickEnabled")}
                  >
                    CLICK {hasClickActive(liveSong) ? "ON" : "OFF"}
                  </button>
                  <button
                    className={hasTrackActive(liveSong) ? "indicator on" : "indicator off"}
                    type="button"
                    onClick={() => handleLiveToggle("trackEnabled")}
                    disabled={!liveSong.trackFileId}
                  >
                    TRACK {hasTrackActive(liveSong) ? "ON" : "OFF"}
                  </button>
                  <span className="indicator route">
                    {channelMode === "normal" ? "TRACK L / CLICK R" : "TRACK R / CLICK L"}
                  </span>
                </div>

                <div className="stage-progress">
                  <div>
                    <strong>{formatDuration(liveDuration ? Math.min(liveElapsed, liveDuration) : liveElapsed)}</strong>
                    <span>
                      {liveDuration
                        ? isLiveTrackEnded
                          ? "Track finalizado"
                          : `Pista ${formatDuration(liveDuration)}`
                        : "Click libre"}
                    </span>
                  </div>
                  {liveDuration ? (
                    <input
                      min={0}
                      max={liveDuration}
                      step={0.1}
                      type="range"
                      value={Math.min(liveElapsed, liveDuration)}
                      onChange={(event) => handleSeekLiveSong(Number(event.target.value))}
                    />
                  ) : (
                    <div className="free-click-progress">Metrónomo sin duración final</div>
                  )}
                </div>

                <div className="stage-actions">
                  <button
                    className="stage-button play"
                    type="button"
                    onClick={handlePlayPauseLiveSong}
                    disabled={!isLivePlaying && !hasClickActive(liveSong) && !hasTrackActive(liveSong)}
                  >
                    {isLivePlaying ? "PAUSE" : isLivePaused ? "RESUME" : "PLAY"}
                  </button>
                  <button
                    className="stage-button stop"
                    type="button"
                    onClick={handleStopLiveSong}
                    disabled={!isLivePlaying && !isLivePaused && liveElapsed === 0}
                  >
                    STOP
                  </button>
                  <button
                    className="stage-button previous"
                    type="button"
                    onClick={() => void handleMoveLiveSong(-1)}
                    disabled={liveSongIndex <= 0}
                  >
                    PREVIOUS
                  </button>
                  <button
                    className="stage-button next"
                    type="button"
                    onClick={() => void handleMoveLiveSong(1)}
                    disabled={liveSongIndex >= selectedShowSongs.length - 1}
                  >
                    NEXT
                  </button>
                </div>

                <aside className="next-song-panel">
                  <span className="section-label">Próxima canción</span>
                  {nextLiveSong ? (
                    <>
                      <strong>{nextLiveSong.title}</strong>
                      <p>
                        {formatBpm(nextLiveSong.bpm)} BPM · {describePlayback(nextLiveSong)}
                      </p>
                    </>
                  ) : (
                    <>
                      <strong>Fin del show</strong>
                      <p>No hay más temas en la lista.</p>
                    </>
                  )}
                </aside>

                <div className="stage-message">
                  <strong>{describePlayback(liveSong)}</strong>
                  {liveSong.trackDuration > 0 && (
                    <span>Duración pista: {formatDuration(liveSong.trackDuration)}</span>
                  )}
                  <span>{liveStatus}</span>
                  {liveError && <span className="form-error">{liveError}</span>}
                </div>
              </div>

              <aside className="stage-setlist">
                <span className="section-label">Setlist</span>
                <div className="live-setlist-strip">
                  {selectedShowSongs.map((song, index) => (
                    <article
                      className={song.id === liveSong.id ? "live-song-chip active" : "live-song-chip"}
                      key={song.id}
                    >
                      <span>{index + 1}</span>
                      <div>
                        <strong>{song.title}</strong>
                        <small>{formatBpm(song.bpm)} BPM · {describePlayback(song)}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </aside>
            </div>
          </section>
        ) : (
          <section className="empty-panel">
            <h2>Show sin canciones</h2>
            <p>Volvé y agregá canciones al orden del show.</p>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="app-shell screen-shell">
      <section className="empty-panel">
        <h1>Vista no disponible</h1>
        <p>Volvé al inicio para seguir trabajando con tus proyectos.</p>
        <button type="button" onClick={() => setAppScreen("dashboard")}>
          Ir a proyectos
        </button>
      </section>
    </main>
  );

}
