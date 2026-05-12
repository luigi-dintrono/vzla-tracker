export interface CrawlOptions {
  sourceIds?: string[]     // Subset of sources from channels.ts (default: all)
  fromDate?: string        // YYYYMMDD format (yt-dlp date format)
  toDate?: string          // YYYYMMDD format
  lastN?: number           // Alternative: just get last N videos (yt-dlp --playlist-end, applied before date filter)
  limit?: number           // Cap on videos to process after date + dedup filtering
  onePerDay?: boolean      // Pick one video per uploadDate (prefers Edición Estelar)
  listFile?: string        // Read pre-built video list from JSON (bypasses listVideos)
  skipDownload?: boolean   // Only transcribe existing audio
  skipTranscribe?: boolean // Only download audio
}

export interface VideoMeta {
  videoId: string
  sourceId: string
  title: string
  uploadDate: string       // YYYYMMDD
  duration: number         // seconds
  audioPath?: string
  transcriptPath?: string
}

/**
 * Generate a filesystem-safe slug from a video title.
 * e.g. "Noticias de Venezuela — Edición Especial" → "noticias-de-venezuela-edicion-especial"
 */
export function slugify(text: string): string {
  return text
    .normalize("NFD")                    // decompose accents
    .replace(/[\u0300-\u036f]/g, "")     // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")         // non-alphanumeric → hyphens
    .replace(/^-+|-+$/g, "")             // trim leading/trailing hyphens
    .slice(0, 80)                        // cap length
}

/**
 * Build the base filename for a video: {YYYYMMDD}_{slug}
 * e.g. "20260301_noticias-de-venezuela-edicion-especial"
 */
export function videoFilename(video: VideoMeta): string {
  const date = video.uploadDate || "00000000"
  const slug = slugify(video.title)
  return `${date}_${slug}`
}
