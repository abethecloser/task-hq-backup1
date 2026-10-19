// Culture Spotlight content model. Task-HQ has no culture content source yet: no table,
// no admin editor and no media storage. Home renders whatever a source provides and an
// intentional placeholder otherwise. Nothing here is invented as real company content.

export type CultureSlot = 'culture' | 'video' | 'moments';

export const CULTURE_SLOTS: { id: CultureSlot; label: string; empty: string; hint: string }[] = [
  { id: 'culture', label: 'Quest Culture', empty: 'No culture message published yet', hint: 'Approved mottos, brand language and leadership messages appear here once they are configured.' },
  { id: 'video', label: 'Video', empty: 'No video of the week yet', hint: 'A leadership-approved Video of the Week appears here once one is published.' },
  { id: 'moments', label: 'Team Moments', empty: 'No team moments shared yet', hint: 'Team achievements, photos and milestones appear here once they are shared.' },
];

export interface CultureItem {
  id: string;
  slot: CultureSlot;
  /** e.g. "Video of the Week", "Leadership message", "Milestone". */
  eyebrow: string;
  title: string;
  body?: string;
  byline?: string;
  media?: {
    type: 'video' | 'image';
    src: string;
    /** Required for images; describes the content for screen readers. */
    alt: string;
    poster?: string;
    /** WebVTT captions for video. */
    captions?: string;
    durationSec?: number;
  };
}

/** Configured culture content. No source exists yet, so this is always empty. */
export const CULTURE_CONTENT: CultureItem[] = [];
