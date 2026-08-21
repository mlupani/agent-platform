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
  | 'INSTAGRAM_REEL';

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

export interface ContentStrategy {
  topic: string;
  objective: ContentObjective;
  headline: string;
  caption: string;
  cta: string;
  imagePrompt: string;
  videoPrompt?: string;
  visualStyle: string;
  serviceId?: string | null;
  audience?: string | null;
}
