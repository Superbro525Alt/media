export type LoadedFile = {
  id: string;

  file?: File;        
  src?: string;       

  path: string;       
  name: string;       
  type: string;       
  sizeKB: number;
  renamed?: string;
  createdAt: number;
  collection: string;

  analysis?: MediaAnalysis;
};

export type Metadata = {
  file_type: string;
  mime: string | null;
  size_bytes: number | null;
  created_at: string | null;   // RFC 3339 string
  modified_at: string | null;  // RFC 3339 string
};

export type Video = {
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  fps: number | null;
  codec: string | null;
};

export type PDF = {
  page_count: number | null;
  page0_width_pt: number | null;
  page0_height_pt: number | null;
};

export type Image = {
  width: number | null;
  height: number | null;
  exif_datetime: string | null;
  phash: string | null;              // base64
  dominant_colors: string[];         // e.g. ["#aabbcc", ...]
};

export type Tagging = {
  tags: string[];        // e.g. ["image","landscape","16:9"]
  topics: string[];      // e.g. ["photography","hi_res_media"]
  raw_keywords: string[]; 
};

export type Suggested = { 
  rename: string 
  reason: string 
  confidence: number 
};

export type MediaAnalysis = {
  meta: Metadata;
  video: Video;
  pdf: PDF;
  image: Image;
  tagging: Tagging;
  suggested: Suggested;
};

export type SortKey = "name" | "hue" | "date" | "tags" | "dimension";

export type SubscriptionTier = "free" | "starter" | "pro" | "teams" | "enterprise";

export type UserProfile = {
  name: string;
  email: string;
  avatarUrl?: string;
};

export type UserSubscription = {
  tier: SubscriptionTier;
  monthlyImageQuota?: number;
  usedThisMonth?: number;
  renewsAt?: string; // ISO
  status?: "active" | "past_due" | "canceled" | "trialing";
};

export type UserState = {
  profile: UserProfile;
  subscription: UserSubscription;
  collections: Array<{
    name: string;
    logo: React.ComponentType<{ className?: string }>;
    slug: string; // e.g., "acme-inc"
  }>;
  currentCollection: string;
};

export type MergeNoOverlap<A, B> =
  [Extract<keyof A, keyof B>] extends [never] ? A & B : never;

export type AnalysedFile = MergeNoOverlap<MediaAnalysis, LoadedFile>;

export function merge<A extends object, B extends object>(
  a: A,
  b: B & { [K in Extract<keyof A, keyof B>]?: never }
): MergeNoOverlap<A, B> {
  return { ...a, ...b } as MergeNoOverlap<A, B>;
}
