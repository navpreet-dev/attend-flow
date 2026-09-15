export interface ProfileInfo {
  name: string;
  course: string;
  section: string;
  department: string;
  incharge: string;
  rollNo: string;
}

export interface SubjectInfo {
  subjectCode: string;
  subjectName: string;
  subjectType: string;
  attended: number;
  total: number;
  percentage: number;
}

export interface LogInfo {
  subjectCode: string;
  subjectName?: string;
  date: string;
  status: "PRESENT" | "ABSENT";
}

export interface SyncEventInfo {
  id: string;
  status: string;
  message: string | null;
  createdAt: string;
}

export interface DashboardPayload {
  authenticated: boolean;
  profile: ProfileInfo | null;
  subjects: SubjectInfo[];
  logs: LogInfo[];
  settings: {
    threshold: number;
    autoSync: boolean;
    notifyLow: boolean;
    rememberMe: boolean;
  };
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  stale: boolean;
  recentSyncs: SyncEventInfo[];
}

export const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours
