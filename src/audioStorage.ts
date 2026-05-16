const DB_NAME = "metronomo-live-audio";
const DB_VERSION = 1;
const TRACK_STORE = "tracks";
const TRIGGER_SOUND_KEY_PREFIX = "trigger-sound:";
const LEGACY_CONTROLLED_TRACK_KEY_PREFIX = "controlled-track:";

type StoredTrack = {
  songId: string;
  file: Blob;
  fileName: string;
  fileType: string;
  updatedAt: string;
};

function openAudioDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(TRACK_STORE)) {
        database.createObjectStore(TRACK_STORE, { keyPath: "songId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTrackTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openAudioDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(TRACK_STORE, mode);
    const store = transaction.objectStore(TRACK_STORE);
    const request = action(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

function getTriggerSoundKey(soundId: string) {
  return `${TRIGGER_SOUND_KEY_PREFIX}${soundId}`;
}

function getLegacyControlledTrackKey(soundId: string) {
  return `${LEGACY_CONTROLLED_TRACK_KEY_PREFIX}${soundId}`;
}

async function saveAudioFile(storageKey: string, file: File) {
  const storedTrack: StoredTrack = {
    songId: storageKey,
    file,
    fileName: file.name,
    fileType: file.type,
    updatedAt: new Date().toISOString()
  };

  await runTrackTransaction("readwrite", (store) => store.put(storedTrack));
}

async function getAudioFile(storageKey: string): Promise<File | null> {
  const storedTrack = await runTrackTransaction<StoredTrack | undefined>("readonly", (store) =>
    store.get(storageKey)
  );

  if (!storedTrack) {
    return null;
  }

  return new File([storedTrack.file], storedTrack.fileName, {
    type: storedTrack.fileType || storedTrack.file.type
  });
}

async function deleteAudioFile(storageKey: string) {
  await runTrackTransaction("readwrite", (store) => store.delete(storageKey));
}

export async function saveTrackFile(songId: string, file: File) {
  await saveAudioFile(songId, file);
}

export async function getTrackFile(songId: string): Promise<File | null> {
  return getAudioFile(songId);
}

export async function deleteTrackFile(songId: string) {
  await deleteAudioFile(songId);
}

export async function saveTriggerSoundFile(soundId: string, file: File) {
  await saveAudioFile(getTriggerSoundKey(soundId), file);
}

export async function getTriggerSoundFile(soundId: string): Promise<File | null> {
  return (await getAudioFile(getTriggerSoundKey(soundId))) ?? getAudioFile(getLegacyControlledTrackKey(soundId));
}

export async function deleteTriggerSoundFile(soundId: string) {
  await deleteAudioFile(getTriggerSoundKey(soundId));
  await deleteAudioFile(getLegacyControlledTrackKey(soundId));
}
