/** Deletion previews are checked again under the tree locks before mutation. */
export interface DeletionPreview {
  kind: "note" | "set";
  set: string;
  path?: string;
  title: string;
  token: string;
  files: number;
  cardFiles: number;
  exportedCards: number;
  mediaFiles: number;
  highlights: number;
  chapter: boolean;
  chapterBecomesPlanned: boolean;
  retainedIgnoredFiles: number;
  practiceHistoryKept: boolean;
}

export interface DeletionResult {
  sha: string;
  subject: string;
  preview: DeletionPreview;
}

export interface DeletedItem {
  sha: string;
  date: string;
  kind: "note" | "set";
  set: string;
  path?: string;
  title: string;
  exportedCards: number;
  retainedIgnoredFiles: number;
}
