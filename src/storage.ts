import type { Project } from "./types";

const STORAGE_KEY = "metronomo-live.projects.v1";
const SESSION_KEY = "metronomo-live.admin-session.v1";

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
      songs: Array.isArray(project.songs) ? project.songs : [],
      shows: Array.isArray(project.shows) ? project.shows : [],
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
