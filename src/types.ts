export interface RawLead {
  url:       string;
  source:    'reddit' | 'twitter' | 'g2' | 'capterra' | 'linkedin';
  author:    string;
  text:      string;
  title?:    string;
  upvotes?:  number;
  createdAt: Date;
  query:     string; // which search query surfaced it
}

export type PainCategory =
  | 'integration_failure'
  | 'automation_broken'
  | 'switching_intent'
  | 'pricing'
  | 'complexity'
  | 'support'
  | 'other';

export type Urgency = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ScoredLead extends RawLead {
  id:           string;   // SHA-256 of URL
  score:        number;   // 1-10
  urgency:      Urgency;
  painCategory: PainCategory;
  draftReply?:  string;
  repliedAt?:   Date;
  scannedAt:    Date;
}
