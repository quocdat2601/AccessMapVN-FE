import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@/shared/api/client';
import type { CapturedContributionMedia, ContributionSubmissionRecord } from './types';

const STORAGE_KEY = '@accessmap_pending_submissions';

let pendingMedia: CapturedContributionMedia | null = null;
let submissionHistory: ContributionSubmissionRecord[] = [];
let hasLoadedFromStorage = false;

export function setPendingContributionMedia(media: CapturedContributionMedia | null) {
  pendingMedia = media;
}

export function getPendingContributionMedia(): CapturedContributionMedia | null {
  return pendingMedia;
}

export function clearPendingContributionMedia() {
  pendingMedia = null;
}

export async function loadContributionRecords(forceSync = false): Promise<ContributionSubmissionRecord[]> {
  if (hasLoadedFromStorage && !forceSync) return [...submissionHistory];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: ContributionSubmissionRecord[] = JSON.parse(raw);
      // Prune records older than 24 hours to prevent stale local cache from haunting venues
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      submissionHistory = Array.isArray(parsed)
        ? parsed.filter((r) => typeof r.createdAt === 'number' && r.createdAt > cutoff)
        : [];
      if (submissionHistory.length !== parsed.length) {
        void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(submissionHistory)).catch(() => {});
      }
    }
  } catch {
    // Fallback gracefully to in-memory store
  }
  hasLoadedFromStorage = true;
  return [...submissionHistory];
}

export interface LiveSubmissionStatus {
  submissionId: string;
  submissionCode?: string;
  status: ContributionSubmissionRecord['status'];
  revision?: number;
  resubmissionCount?: number;
  canResubmit?: boolean;
  remainingResubmissions?: number;
  informationRequestReason?: string | null;
  updatedAt?: string;
}

export function normalizeBackendSubmissionStatus(raw?: string): ContributionSubmissionRecord['status'] {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'published':
      return 'Published';
    case 'autoverified':
    case 'auto-verified':
      return 'Auto-Verified';
    case 'pendingmoderation':
    case 'pending moderation':
      return 'PendingModeration';
    case 'aiprocessing':
      return 'AIProcessing';
    case 'awaitingmoreinfo':
    case 'needssupplement':
      return 'AwaitingMoreInfo';
    case 'rejected':
      return 'Rejected';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Submitted';
  }
}

export function isTerminalSubmissionStatus(status?: string): boolean {
  const normalized = normalizeBackendSubmissionStatus(status);
  return (
    normalized === 'Published' ||
    normalized === 'Auto-Verified' ||
    normalized === 'Rejected' ||
    normalized === 'Cancelled'
  );
}

export async function fetchSubmissionStatus(submissionId: string): Promise<LiveSubmissionStatus | null> {
  if (!submissionId) return null;
  try {
    const res = await apiClient.get<{
      submission?: {
        submissionId?: string;
        submissionCode?: string;
        status?: string;
        revision?: number;
        resubmissionCount?: number;
        canResubmit?: boolean;
        remainingResubmissions?: number;
        updatedAt?: string;
      };
      informationRequestReason?: string | null;
    }>(`/api/v1/submissions/${encodeURIComponent(submissionId)}/status`, { auth: 'required' });

    if (!res?.submission?.status) return null;
    return {
      submissionId: String(res.submission.submissionId || submissionId),
      submissionCode: res.submission.submissionCode,
      status: normalizeBackendSubmissionStatus(res.submission.status),
      revision: res.submission.revision,
      resubmissionCount: res.submission.resubmissionCount,
      canResubmit: res.submission.canResubmit,
      remainingResubmissions: res.submission.remainingResubmissions,
      informationRequestReason: res.informationRequestReason ?? null,
      updatedAt: res.submission.updatedAt,
    };
  } catch {
    return null;
  }
}

export function updateContributionRecordStatus(
  submissionId: string,
  patch: Partial<ContributionSubmissionRecord>
): void {
  const idx = submissionHistory.findIndex((r) => r.id === submissionId);
  if (idx < 0) return;

  const current = submissionHistory[idx];
  const next: ContributionSubmissionRecord = {
    ...current,
    ...patch,
  };
  const changed = (Object.keys(patch) as (keyof ContributionSubmissionRecord)[]).some(
    (key) => patch[key] !== current[key]
  );
  if (!changed) return;

  submissionHistory[idx] = next;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(submissionHistory)).catch(() => {});
}

export async function syncPendingSubmissionsWithBackend(): Promise<ContributionSubmissionRecord[]> {
  await loadContributionRecords();
  const pending = submissionHistory.filter((r) => !isTerminalSubmissionStatus(r.status));
  if (pending.length === 0) return [...submissionHistory];

  const ids = pending.map((r) => r.id).filter(Boolean);
  if (ids.length === 0) return [...submissionHistory];

  try {
    const resolved = await Promise.all(ids.map((id) => fetchSubmissionStatus(id)));
    let changed = false;
    for (const item of resolved) {
      if (!item) continue;
      const record = submissionHistory.find((r) => r.id === item.submissionId);
      if (!record) continue;

      if (record.status !== item.status) {
        record.status = item.status;
        changed = true;
      }
      if (item.submissionCode && record.submissionCode !== item.submissionCode) {
        record.submissionCode = item.submissionCode;
        changed = true;
      }
      if (typeof item.revision === 'number' && record.revision !== item.revision) {
        record.revision = item.revision;
        changed = true;
      }
      if (
        typeof item.resubmissionCount === 'number' &&
        record.resubmissionCount !== item.resubmissionCount
      ) {
        record.resubmissionCount = item.resubmissionCount;
        changed = true;
      }
      if (item.informationRequestReason && record.moderatorNote !== item.informationRequestReason) {
        record.moderatorNote = item.informationRequestReason;
        changed = true;
      }
    }

    if (changed) {
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(submissionHistory)).catch(() => {});
    }
  } catch {
    // Fail safe to in-memory/cache on network drop
  }

  return [...submissionHistory];
}

export async function clearContributionRecords(): Promise<void> {
  submissionHistory = [];
  hasLoadedFromStorage = true;
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export function addContributionRecord(record: ContributionSubmissionRecord) {
  submissionHistory.unshift(record);
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(submissionHistory)).catch(() => {});
}

export function getContributionRecords(): ContributionSubmissionRecord[] {
  return [...submissionHistory];
}

export function getTotalPoints(): number {
  return submissionHistory.reduce((acc, curr) => acc + curr.pointsAwarded, 0);
}
