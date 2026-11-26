export type AccessibilityFeatureType =
  | "Ramp"
  | "EntranceDoor"
  | "Elevator"
  | "AccessibleRestroom"
  | "TactilePaving";

export type PublishedFeatureStatus =
  | "Available"
  | "Limited"
  | "NotAvailable"
  | "Unknown";

export type DisputeStatus =
  | "Open"
  | "UnderReview"
  | "AwaitingMoreInfo"
  | "CorrectionPending"
  | "ResolvedBaseline"
  | "ResolvedUpdated";

export type DisputeDecisionType =
  | "RequestEvidence"
  | "RetainBaseline"
  | "LinkCorrection"
  | "RecordPublication"
  | "CreateAdvisory";

export type ReportStatus =
  | "Submitted"
  | "UnderReview"
  | "AwaitingMoreInfo"
  | "LinkedToDispute"
  | "Resolved"
  | "Rejected";

export type ReportReason =
  | "IncorrectFeature"
  | "MissingFeature"
  | "OutdatedInformation"
  | "Other"
  | "WrongAddressOrPin";

export type ReportResolution =
  | "BaselineRetained"
  | "AdvisoryCreated"
  | "CorrectionPublished"
  | "MetadataCorrected";

export type ReportDecision =
  | "StartReview"
  | "RequestEvidence"
  | "LinkDispute"
  | "Resolve"
  | "Reject";

export type CommunityCommentStatus =
  | "PendingReview"
  | "Approved"
  | "Hidden"
  | "Rejected";

export interface AdminQueueResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminQueueQuery {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface DisputeQueueItem {
  id: string;
  locationId: string;
  locationName?: string;
  locationAddress?: string;
  featureType: AccessibilityFeatureType;
  featureVersion: number;
  publishedStatus?: PublishedFeatureStatus;
  status: DisputeStatus;
  openReason: string;
  openedAt: string;
  updatedAt?: string;
  contradictingVoterCount?: number;
}

export interface DisputeVoteSummary {
  id: string;
  voteType: "StillAccurate" | "Changed";
  proposedStatus?: PublishedFeatureStatus;
  comment?: string;
  status?: string;
  createdAt: string;
  evidenceSubmissionId?: string;
  voterDisplayName?: string;
  voterReputationTier?: string;
  voterReputationScore?: number;
}

export interface DisputeRelatedReport {
  id: string;
  reporterDisplayName?: string;
  reason: ReportReason;
  description: string;
  status: ReportStatus;
  createdAt: string;
  evidence: ReportEvidence[];
}

export interface DisputeDecisionRecord {
  id: string;
  decisionType: DisputeDecisionType;
  reason: string;
  moderatorDisplayName?: string;
  correctionSubmissionId?: string;
  advisoryId?: string;
  decidedAt: string;
  caseVersion: number;
}

export interface TemporaryAdvisory {
  id: string;
  status: "Scheduled" | "Active" | "Expired" | "Revoked";
  reason: string;
  startsAt: string;
  endsAt: string;
}

export interface DisputeDetail extends DisputeQueueItem {
  votes: DisputeVoteSummary[];
  decisions: DisputeDecisionRecord[];
  advisory?: TemporaryAdvisory;
  correctionSubmissionId?: string;
  version: number;
  baselineReason?: string;
  baselineVerifiedAt?: string;
  weightedAgreement?: number;
  eligibleVoterCount?: number;
  freshnessFactor?: number;
  relatedReports?: DisputeRelatedReport[];
}

export interface DisputeDecisionInput {
  decision: DisputeDecisionType;
  reason: string;
  correctionSubmissionId?: string;
  startsAt?: string;
  endsAt?: string;
  advisoryReason?: string;
  updatedFeatureStatus?: PublishedFeatureStatus;
}

export interface ReportQueueItem {
  id: string;
  locationId: string;
  locationName?: string;
  locationAddress?: string;
  featureType?: AccessibilityFeatureType;
  observedFeatureVersion?: number;
  reason: ReportReason;
  description: string;
  status: ReportStatus;
  isStaleBaseline?: boolean;
  createdAt: string;
  updatedAt?: string;
  evidenceCount?: number;
}

export interface ReportEvidence {
  id: string;
  description?: string;
  mediaUrl?: string;
  mediaContentType?: string;
  createdAt: string;
}

export interface EvidenceAccess {
  evidenceId: string;
  accessUrl: string;
  contentType: string;
  expiresAt: string;
}

export interface ReportHistoryEntry {
  id: string;
  fromStatus?: ReportStatus;
  toStatus: ReportStatus;
  reason: string;
  outcome?: string;
  actorDisplayName?: string;
  occurredAt: string;
}

export interface ReportDetail extends ReportQueueItem {
  reporterDisplayName?: string;
  proposedAddress?: string;
  proposedLatitude?: number;
  proposedLongitude?: number;
  linkedDisputeCaseId?: string;
  linkedSubmissionId?: string;
  resolution?: ReportResolution;
  publicResolutionNote?: string;
  locationMetadataVersion?: number;
  currentAddress?: string;
  currentLatitude?: number;
  currentLongitude?: number;
  evidence: ReportEvidence[];
  history: ReportHistoryEntry[];
  version: number;
}

export interface ReportTransitionInput {
  decision: ReportDecision;
  note: string;
  expectedVersion: number;
  linkedDisputeCaseId?: string;
  linkedSubmissionId?: string;
  resolution?: ReportResolution;
  publicResolutionNote?: string;
  updatedFeatureStatus?: PublishedFeatureStatus;
  advisoryEndsAt?: string;
  advisoryReason?: string;
}

export interface MetadataCorrectionInput {
  expectedMetadataVersion: number;
  sourceReportId: string;
  reason: string;
  proposedAddress?: string;
  proposedPosition?: {
    latitude: number;
    longitude: number;
  };
}

export interface CommunityCommentQueueItem {
  id: string;
  locationId: string;
  locationName?: string;
  scopeId?: string;
  userId?: string;
  authorDisplayName?: string;
  authorTier?: string;
  body: string;
  uncensoredBody?: string;
  matchedBannedTerms?: string[];
  wasCensored?: boolean;
  reportCount?: number;
  status: CommunityCommentStatus;
  createdAt: string;
  moderatedAt?: string;
  moderationReason?: string;
  version?: number;
  etag?: string;
}

export interface CommentModerationInput {
  decision: "Approve" | "Hide";
  reason: string;
  expectedVersion: number;
}

export interface CommentModerationPolicy {
  autoPublishComments: boolean;
  editWindowMinutes: number;
  blockExternalLinks: boolean;
  allowedDomains: string[];
  bannedKeywords: string[];
  maxReportsPer10Minutes: number;
  falseReportAlertThreshold: number;
  repeatedTargetAlertThreshold: number;
  autoHideCommentReportCount: number;
}

export interface AdminUserModerationCase {
  id: string;
  caseType: "CensoredProfanityComment" | "RepeatedlyReportedUser" | "ReporterSpamAbuse" | "CommentReported" | string;
  subjectUserId: string;
  subjectName: string;
  subjectEmail: string;
  subjectAccountStatus: "Active" | "Disabled" | string;
  subjectStandingScore: number;
  subjectReputationPoints: number;
  locationId?: string | null;
  locationName?: string | null;
  commentId?: string | null;
  reportId?: string | null;
  violationReasons: string[];
  uncensoredSnapshot?: string | null;
  censoredSnapshot?: string | null;
  matchedBannedTerms: string[];
  severity: "Low" | "Medium" | "High" | "Critical" | string;
  status: "Open" | "ActionTaken" | "Dismissed" | string;
  reportCount: number;
  adminNote?: string | null;
  standingPenaltyApplied: number;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface AdminUserActivity360 {
  userId: string;
  name: string;
  email: string;
  accountStatus: string;
  accountStandingScore: number;
  reputationPoints: number;
  contributionAccuracyRate?: number | null;
  createdAt: string;
  reportsSentTotal: number;
  reportsSentValid: number;
  reportsSentRejected: number;
  receivedCommentReports: number;
  censoredCommentViolations: number;
  openModerationCases: number;
  submissions: Array<{
    submissionId: string;
    businessCode: string;
    locationName: string;
    status: string;
    aiConfidence?: number | null;
    createdAt: string;
  }>;
  comments: Array<{
    commentId: string;
    locationId: string;
    locationName: string;
    body: string;
    status: string;
    version: number;
    reportCount: number;
    createdAt: string;
  }>;
  reports: Array<{
    reportId: string;
    direction: "Sent" | "Received" | string;
    locationName: string;
    targetType: string;
    reason: string;
    description: string;
    status: string;
    createdAt: string;
  }>;
  scoreHistory: Array<{
    historyId: string;
    scoreType: string;
    appliedDelta: number;
    balanceAfter: number;
    reason: string;
    appliedAt: string;
  }>;
}

export interface AdminCommentReportEntry {
  reportId: string;
  reporterId: string;
  reporterName: string;
  violationCategory: string;
  description: string;
  reportStatus: string;
  createdAt: string;
}

export interface AdminReportedCommentItem {
  commentId: string;
  locationId: string;
  locationName: string;
  locationAddress?: string | null;
  parentCommentId?: string | null;
  parentCommentBody?: string | null;
  parentAuthorName?: string | null;
  authorId: string;
  authorName: string;
  authorEmail: string;
  commentBody: string;
  uncensoredBody?: string | null;
  matchedBannedTerms: string[];
  commentStatus: "Visible" | "Hidden" | "PendingReview" | string;
  commentVersion: number;
  createdAt: string;
  reportCount: number;
  reports: AdminCommentReportEntry[];
}
