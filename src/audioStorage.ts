const DB_NAME = "metronomo-live-audio";
const DB_VERSION = 1;
const TRACK_STORE = "tracks";

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

export async function saveTrackFile(songId: string, file: File) {
  const storedTrack: StoredTrack = {
    songId,
    file,
    fileName: file.name,
    fileType: file.type,
    updatedAt: new Date().toISOString()
  };

  await runTrackTransaction("readwrite", (store) => store.put(storedTrack));
}

export async function getTrackFile(songId: string): Promise<File | null> {
  const storedTrack = await runTrackTransaction<StoredTrack | undefined>("readonly", (store) =>
    store.get(songId)
  );

  if (!storedTrack) {
    return null;
  }

  return new File([storedTrack.file], storedTrack.fileName, {
    type: storedTrack.fileType || storedTrack.file.type
  });
}

export async function deleteTrackFile(songId: string) {
  await runTrackTransaction("readwrite", (store) => store.delete(songId));
}

