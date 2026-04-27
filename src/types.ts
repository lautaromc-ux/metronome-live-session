export type Song = {
  id: string;
  title: string;
  bpm: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  countInBars: number;
  notes: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  songs: Song[];
  createdAt: string;
  updatedAt: string;
};

