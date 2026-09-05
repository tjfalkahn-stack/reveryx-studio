export type SoundVaultMeta = {
  pack: string;
  creator: string;
  version: string;
  category: string;
  tags: string[];
  bpm: number | null;
  key: string | null;
  license: string;
  source: string;
};

export const REVERYX_STARTER_LICENSE =
  "Original REVERYX procedural synthesis. Not licensed from a third-party sample library.";

export const REVERYX_STARTER_SOURCE =
  "Generated at runtime by REVERYX Beat Lab from oscillators and filtered noise. No commercial pack or trademarked factory bank was copied.";

export function starterVaultMeta(category: string, tags: string[], key: string | null = null): SoundVaultMeta {
  return {
    pack: "REVERYX Starter Kit",
    creator: "REVERYX",
    version: "1.0",
    category,
    tags,
    bpm: null,
    key,
    license: REVERYX_STARTER_LICENSE,
    source: REVERYX_STARTER_SOURCE,
  };
}

export function userUploadVaultMeta(fileName: string): SoundVaultMeta {
  return {
    pack: "User Library",
    creator: "Session artist",
    version: "1.0",
    category: "User sample",
    tags: ["uploaded", "user"],
    bpm: null,
    key: null,
    license: "User-supplied audio. REVERYX does not grant a license for this file.",
    source: `Imported by the artist from ${fileName}. Provenance is the local file selected in Beat Lab.`,
  };
}

export function recordedVaultMeta(): SoundVaultMeta {
  return {
    pack: "User Library",
    creator: "Session artist",
    version: "1.0",
    category: "Recorded sample",
    tags: ["recorded", "microphone", "user"],
    bpm: null,
    key: null,
    license: "User-recorded audio. REVERYX does not grant a license for this recording.",
    source: "Captured from the session microphone inside REVERYX Beat Lab.",
  };
}

export function resampledVaultMeta(originName: string): SoundVaultMeta {
  return {
    pack: "User Library",
    creator: "Session artist",
    version: "1.0",
    category: "Resampled pad",
    tags: ["resampled", "derived"],
    bpm: null,
    key: null,
    license: "Derived from a user or starter source already in this project. No additional license is claimed.",
    source: `Rendered from processed pad output of ${originName} while preserving the original asset.`,
  };
}
