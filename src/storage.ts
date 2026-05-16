import type { Project, Show, Song, TriggerSound } from "./types";

const STORAGE_KEY = "metronomo-live.projects.v1";
const SESSION_KEY = "metronomo-live.admin-session.v1";
const BACKUP_VERSION = 1;
const DEFAULT_TRACK_VOLUME = 1;
const DEFAULT_CLICK_VOLUME = 0.4;

export type ProjectsBackup = {
  app: "metronomo-live";
  version: number;
  exportedAt: string;
  audioFilesIncluded: false;
  projects: Project[];
};

function normalizeVolume(value: unknown, fallback: number) {
  const volume = Number(value);

  if (!Number.isFinite(volume)) {
    return fallback;
  }

  return Math.min(Math.max(volume, 0), 1);
}

function normalizeTriggerSounds(value: unknown): TriggerSound[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const sound = item as Partial<TriggerSound>;

    return {
      id: String(sound.id ?? ""),
      fileName: String(sound.fileName ?? ""),
      duration: Number(sound.duration ?? 0),
      volume: normalizeVolume(sound.volume, DEFAULT_TRACK_VOLUME)
    };
  }).filter((sound) => Boolean(sound.id && sound.fileName));
}

function normalizeSongs(value: unknown): Song[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const song = item as Partial<Song> & {
      controlledTrackFileId?: string;
      controlledTrackFileName?: string;
      controlledTrackDuration?: number;
      controlledTrackVolume?: number;
    };
    const triggerSounds = normalizeTriggerSounds(song.triggerSounds);
    const legacyControlledSound =
      triggerSounds.length === 0 && song.controlledTrackFileId && song.controlledTrackFileName
        ? [
            {
              id: String(song.controlledTrackFileId),
              fileName: String(song.controlledTrackFileName),
              duration: Number(song.controlledTrackDuration ?? 0),
              volume: normalizeVolume(song.controlledTrackVolume, DEFAULT_TRACK_VOLUME)
            }
          ]
        : triggerSounds;

    return {
      id: String(song.id ?? ""),
      title: String(song.title ?? ""),
      bpm: Number(song.bpm ?? 120),
      timeSignatureNumerator: Number(song.timeSignatureNumerator ?? 4),
      timeSignatureDenominator: Number(song.timeSignatureDenominator ?? 4),
      countInBars: Number(song.countInBars ?? 1),
      notes: String(song.notes ?? ""),
      trackFileId: String(song.trackFileId ?? ""),
      trackFileName: String(song.trackFileName ?? ""),
      trackDuration: Number(song.trackDuration ?? 0),
      trackEnabled: Boolean(song.trackEnabled ?? false),
      triggerSounds: legacyControlledSound,
      clickEnabled: song.clickEnabled ?? true,
      trackVolume: normalizeVolume(song.trackVolume, DEFAULT_TRACK_VOLUME),
      clickVolume: normalizeVolume(song.clickVolume, DEFAULT_CLICK_VOLUME)
    };
  });
}

function normalizeShows(value: unknown): Show[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const show = item as Partial<Show>;

    return {
      id: String(show.id ?? ""),
      title: String(show.title ?? ""),
      date: String(show.date ?? ""),
      songIds: Array.isArray(show.songIds) ? show.songIds.map(String) : [],
      notes: String(show.notes ?? ""),
      createdAt: String(show.createdAt ?? new Date().toISOString()),
      updatedAt: String(show.updatedAt ?? new Date().toISOString())
    };
  });
}

function normalizeProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const project = item as Partial<Project>;

    return {
      id: String(project.id ?? ""),
      name: String(project.name ?? ""),
      description: String(project.description ?? ""),
      songs: normalizeSongs(project.songs),
      shows: normalizeShows(project.shows),
      createdAt: String(project.createdAt ?? new Date().toISOString()),
      updatedAt: String(project.updatedAt ?? new Date().toISOString())
    };
  });
}

export function loadProjects(): Project[] {
  const storedProjects = window.localStorage.getItem(STORAGE_KEY);

  if (!storedProjects) {
    return [];
  }

  try {
    const parsed = JSON.parse(storedProjects);
    return normalizeProjects(parsed);
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function createProjectsBackup(projects: Project[]): ProjectsBackup {
  return {
    app: "metronomo-live",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    audioFilesIncluded: false,
    projects: projects.map((project) => ({
      ...project,
      songs: project.songs.map((song) => ({
        ...song,
        trackFileId: "",
        trackFileName: "",
        trackDuration: 0,
        trackEnabled: false,
        triggerSounds: []
      }))
    }))
  };
}

export function parseProjectsBackup(contents: string): Project[] {
  const parsed = JSON.parse(contents) as Partial<ProjectsBackup> | Project[];
  const projects = Array.isArray(parsed) ? parsed : parsed.projects;

  return normalizeProjects(projects);
}

export function loadAdminSession() {
  return window.localStorage.getItem(SESSION_KEY) === "active";
}

export function saveAdminSession(isActive: boolean) {
  if (isActive) {
    window.localStorage.setItem(SESSION_KEY, "active");
    return;
  }

  window.localStorage.removeItem(SESSION_KEY);
}
