export type ContentObjective =
  | 'AUTOMATIC'
  | 'SERVICE_PROMOTION'
  | 'OFFER'
  | 'TIP'
  | 'INFO'
  | 'SPECIAL_DATE'
  | 'CUSTOM';

export type ContentChannel =
  | 'WHATSAPP_STATUS'
  | 'INSTAGRAM_STORY'
  | 'INSTAGRAM_FEED'
  | 'INSTAGRAM_REEL'
  | 'TIKTOK';

export type ContentMediaType = 'IMAGE' | 'VIDEO';

export type ContentStatus =
  | 'DRAFT'
  | 'READY'
  | 'GENERATING'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PARTIALLY_PUBLISHED'
  | 'FAILED';

export type ContentAssetFormat =
  | 'STORY_VERTICAL'
  | 'SHORT_VERTICAL'
  | 'FEED_SQUARE'
  | 'FEED_PORTRAIT'
  | 'FEED_LANDSCAPE';

export type ContentAssetRole = 'ORIGINAL' | 'EDITED';

export type AutoEditStatus =
  | 'NONE'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'FAILED';

export interface VideoEditingPlan {
  add_hook?: boolean;
  hook_start?: number;
  hook_end?: number;
  hook_position?: 'top' | 'center' | 'bottom';
  hook_font_size?: number;
  add_cta?: boolean;
  cta_start?: number;
  cta_end?: number;
  cta_position?: 'top' | 'center' | 'bottom';
  cta_font_size?: number;
  add_logo?: boolean;
  logo_position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  logo_width?: number;
  logo_opacity?: number;
}

export interface ContentStrategy {
  topic: string;
  objective: ContentObjective;
  headline: string;
  caption: string;
  cta: string;
  hook?: string;
  hashtags?: string[];
  imagePrompt: string;
  videoPrompt?: string;
  visualStyle: string;
  serviceId?: string | null;
  audience?: string | null;
  editing?: VideoEditingPlan;
}
