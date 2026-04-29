export type Song = {
  id: string;
  title: string;
  bpm: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  countInBars: number;
  notes: string;
  trackFileId: string;
  trackFileName: string;
  trackDuration: number;
  trackEnabled: boolean;
  clickEnabled: boolean;
  trackVolume: number;
  clickVolume: number;
};

export type Show = {
  id: string;
  title: string;
  date: string;
  songIds: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  songs: Song[];
  shows: Show[];
  createdAt: string;
  updatedAt: string;
};
