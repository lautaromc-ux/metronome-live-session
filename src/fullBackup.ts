import {
  getAudioBackupRecords,
  getTriggerSoundBackupStorageKeys,
  type AudioBackupRecord
} from "./audioStorage";
import { parseProjectsBackup } from "./storage";
import type { Project } from "./types";

const MAGIC = "METRONOME-LIVE-FULL\n";
const FULL_BACKUP_VERSION = 1;

type AudioManifestEntry = {
  storageKey: string;
  projectId: string;
  fileName: string;
  fileType: string;
  updatedAt: string;
  size: number;
};

type FullBackupHeader = {
  app: "metronomo-live";
  version: number;
  exportedAt: string;
  audioFilesIncluded: true;
  projects: Project[];
  audioFiles: AudioManifestEntry[];
};

export type ParsedFullBackup = {
  exportedAt: string;
  projects: Project[];
  audioFiles: Array<AudioBackupRecord & { projectId: string }>;
};

function collectAudioStorageOwners(projects: Project[]) {
  const owners = new Map<string, string>();

  projects.forEach((project) => {
    project.songs.forEach((song) => {
      if (song.trackFileId) {
        owners.set(song.id, project.id);
      }

      song.triggerSounds.forEach((sound) => {
        getTriggerSoundBackupStorageKeys(sound.id).forEach((storageKey) => {
          owners.set(storageKey, project.id);
        });
      });
    });
  });

  return owners;
}

export async function createFullBackup(projects: Project[]) {
  const owners = collectAudioStorageOwners(projects);
  const audioRecords = await getAudioBackupRecords([...owners.keys()]);
  const audioFiles: AudioManifestEntry[] = audioRecords.map((record) => ({
    storageKey: record.storageKey,
    projectId: owners.get(record.storageKey) ?? "",
    fileName: record.fileName,
    fileType: record.fileType || record.file.type,
    updatedAt: record.updatedAt,
    size: record.file.size
  }));
  const header: FullBackupHeader = {
    app: "metronomo-live",
    version: FULL_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    audioFilesIncluded: true,
    projects,
    audioFiles
  };
  const encoder = new TextEncoder();
  const magicBytes = encoder.encode(MAGIC);
  const headerBytes = encoder.encode(JSON.stringify(header));
  const headerLength = new Uint8Array(4);

  new DataView(headerLength.buffer).setUint32(0, headerBytes.byteLength, true);

  return {
    blob: new Blob(
      [magicBytes, headerLength, headerBytes, ...audioRecords.map((record) => record.file)],
      { type: "application/x-metronome-live-backup" }
    ),
    audioCount: audioRecords.length,
    audioBytes: audioRecords.reduce((total, record) => total + record.file.size, 0)
  };
}

export async function parseFullBackup(file: File): Promise<ParsedFullBackup> {
  const decoder = new TextDecoder();
  const magicLength = new TextEncoder().encode(MAGIC).byteLength;
  const prefix = new Uint8Array(await file.slice(0, magicLength + 4).arrayBuffer());

  if (decoder.decode(prefix.slice(0, magicLength)) !== MAGIC) {
    throw new Error("Invalid backup signature");
  }

  const headerLength = new DataView(prefix.buffer, prefix.byteOffset + magicLength, 4).getUint32(0, true);
  const headerStart = magicLength + 4;
  const headerEnd = headerStart + headerLength;

  if (headerLength <= 0 || headerEnd > file.size) {
    throw new Error("Invalid backup header");
  }

  const header = JSON.parse(await file.slice(headerStart, headerEnd).text()) as FullBackupHeader;

  if (
    header.app !== "metronomo-live" ||
    header.version !== FULL_BACKUP_VERSION ||
    header.audioFilesIncluded !== true ||
    !Array.isArray(header.projects) ||
    !Array.isArray(header.audioFiles)
  ) {
    throw new Error("Unsupported backup format");
  }

  const projects = parseProjectsBackup(JSON.stringify(header.projects));
  let audioOffset = headerEnd;
  const audioFiles = header.audioFiles.map((entry) => {
    const end = audioOffset + entry.size;

    if (entry.size < 0 || end > file.size) {
      throw new Error("Invalid audio payload");
    }

    const record: AudioBackupRecord & { projectId: string } = {
      storageKey: entry.storageKey,
      projectId: entry.projectId,
      file: file.slice(audioOffset, end, entry.fileType),
      fileName: entry.fileName,
      fileType: entry.fileType,
      updatedAt: entry.updatedAt
    };

    audioOffset = end;
    return record;
  });

  return {
    exportedAt: header.exportedAt,
    projects,
    audioFiles
  };
}
