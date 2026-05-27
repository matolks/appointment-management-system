/*
 * Copyright (c) 2026 Vince Matolka.
 * All rights reserved.
 *
 * This file is part of Appointment Manager.
 * Unauthorized copying, modification, distribution, or use is prohibited
 * without written permission from the copyright owner.
 */

export type WaitlistStatus = "WAITLISTED" | "SCHEDULED" | "REMOVED";
export type DayCode = "M" | "Tu" | "W" | "Th" | "F";
export type ViewMode = "CALENDAR" | "WAITLIST";
export type ActionMode = "OPENING" | "WAITLIST_ENTRY" | "EDIT_PROVIDERS";
export type SortField = "dateAdded" | "name" | "provider" | "tier" | "status";
export type WaitlistHistoryPanel = "ACTIVE" | "SCHEDULED" | "REMOVED";

export type Provider = {
  name: string;
  color: string;
};

export type WaitlistEntry = {
  id: number;
  dateAdded: string;
  firstName: string;
  lastName: string;
  provider: string;
  tier: 1 | 2 | 3;
  reason: string;
  availableDays: DayCode[];
  availableTimes: string[];
  status: WaitlistStatus;
};

export type TimeRangeDraft = {
  id: number;
  startTime: string;
  endTime: string;
};

export type ScheduledRecord = {
  id: number;
  entryId: number;
  dateScheduled: string;
  firstName: string;
  lastName: string;
  provider: string;
  tier: 1 | 2 | 3;
  reason: string;
  status: "SCHEDULED";
  appointmentDate: string;
  appointmentDay: DayCode;
  startTime: string;
  endTime: string;
};

export type RemovedRecord = {
  id: number;
  entryId: number;
  dateRemoved: string;
  dateAdded: string;
  firstName: string;
  lastName: string;
  provider: string;
  tier: 1 | 2 | 3;
  reason: string;
  status: "REMOVED";
};

export type Opening = {
  id: number;
  provider: string;
  date: string;
  day: DayCode;
  startTime: string;
  endTime: string;
  isSurgery: boolean;
};

export type PersistedAppState = {
  version: number;
  providers: Provider[];
  entries: WaitlistEntry[];
  openings: Opening[];
  scheduledRecords: ScheduledRecord[];
  removedRecords: RemovedRecord[];
};

export type ImportPreviewStatus = "READY" | "WARNING" | "ERROR";

export type ImportPreviewRow = {
  id: number;
  rowNumber: number;
  dateAdded: string;
  firstName: string;
  lastName: string;
  provider: string;
  tier: 1 | 2 | 3;
  reason: string;
  availableDays: DayCode[];
  availableTimes: string[];
  status: ImportPreviewStatus;
  messages: string[];
  raw: {
    dateAdded: string;
    name: string;
    provider: string;
    tier: string;
    reason: string;
    dates: string;
    times: string;
  };
};

export type ScheduleSelection = {
  startTime: string;
  endTime: string;
};

export type TimeWindow = {
  start: number;
  end: number;
};

export type PendingRemoval =
  | {
      type: "ENTRY";
      id: number;
      entryId?: never;
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      type: "OPENING";
      id: number;
      entryId?: never;
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      type: "SCHEDULED_RECORD";
      id: number;
      entryId: number;
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      type: "REMOVED_RECORD";
      id: number;
      entryId: number;
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      type: "PROVIDER";
      name: string;
      id?: never;
      entryId?: never;
      title: string;
      message: string;
      confirmLabel: string;
    };

export type BackupDialogResult = {
  canceled: boolean;
  filePath?: string;
};

export type OpenBackupFolderResult = {
  opened: boolean;
  error?: string;
};

export type ClearOldBackupsResult = {
  deletedCount: number;
  keptCount: number;
  backupDir: string;
};

export type AppStorageApi = {
  load: () => Promise<PersistedAppState | null>;
  save: (state: PersistedAppState) => Promise<void>;
  reset: () => Promise<void>;
  exportBackup: () => Promise<BackupDialogResult>;
  importBackup: () => Promise<PersistedAppState | null>;
  restoreLatestBackup: () => Promise<PersistedAppState | null>;
  openBackupFolder: () => Promise<OpenBackupFolderResult>;
  clearOldBackups: () => Promise<ClearOldBackupsResult>;
};

declare global {
  interface Window {
    appStorage?: AppStorageApi;
  }
}