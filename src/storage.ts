import type { Project } from "./types";

const STORAGE_KEY = "metronomo-live.projects.v1";

export function loadProjects(): Project[] {
  const storedProjects = window.localStorage.getItem(STORAGE_KEY);

  if (!storedProjects) {
    return [];
  }

  try {
    const parsed = JSON.parse(storedProjects);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

