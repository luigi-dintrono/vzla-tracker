import "dotenv/config"
import { readFileSync } from "fs"
import { YOUTUBE_SOURCES, type YouTubeSource } from "./channels"
import type { CrawlOptions, VideoMeta } from "./types"
import { checkYtDlp, listVideos, downloadAudio } from "./lib/youtube-downloader"
import { checkMlxWhisper, transcribeAudio } from "./lib/transcriber"
import { getProcessedVideoIds, upsertVideo, isDbAvailable } from "./lib/db"

function parseArgs(): CrawlOptions {
  const args = process.argv.slice(2)
  const options: CrawlOptions = {}

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--from":
        options.fromDate = args[++i]
        break
      case "--to":
        options.toDate = args[++i]
        break
      case "--last":
        options.lastN = parseInt(args[++i], 10)
        break
      case "--limit":
        options.limit = parseInt(args[++i], 10)
        break
      case "--one-per-day":
        options.onePerDay = true
        break
      case "--list-file":
        options.listFile = args[++i]
        break
      case "--source":
      case "--channel":
        if (!options.sourceIds) options.sourceIds = []
        options.sourceIds.push(args[++i])
        break
      case "--skip-download":
        options.skipDownload = true
        break
      case "--skip-transcribe":
        options.skipTranscribe = true
        break
      case "--help":
        printHelp()
        process.exit(0)
      default:
        console.error(`Unknown argument: ${args[i]}`)
        printHelp()
        process.exit(1)
    }
  }

  return options
}

function printHelp() {
  console.log(`
Usage: npx tsx press-freedom/crawl.ts [options]

Options:
  --last N              yt-dlp playlist-end cap (applied before date filtering)
  --limit N             Cap videos to process per source AFTER date + dedup filter
  --one-per-day         Pick one video per uploadDate (prefers titles containing "estelar")
  --list-file PATH      Read pre-built video list (JSON from build-list.ts), bypass listVideos
  --from YYYYMMDD       Process videos uploaded on or after this date
  --to YYYYMMDD         Process videos uploaded on or before this date
  --source ID           Only process this source (can be repeated)
  --channel ID          Alias for --source
  --skip-download       Only transcribe existing audio files
  --skip-transcribe     Only download audio (no transcription)
  --help                Show this help message

Examples:
  npx tsx press-freedom/crawl.ts --last 5
  npx tsx press-freedom/crawl.ts --from 20260101 --to 20260301
  npx tsx press-freedom/crawl.ts --source PLyhdNAFV1DMJATESD8ItT1bgy8QlIXDQA --last 3
`)
}

async function main() {
  const options = parseArgs()
  console.log("[press-freedom] Starting crawl pipeline")
  console.log("[press-freedom] Options:", JSON.stringify(options, null, 2))

  // Check system dependencies
  await checkYtDlp()
  if (!options.skipTranscribe) {
    await checkMlxWhisper()
  }

  if (isDbAvailable()) {
    console.log("[press-freedom] Supabase tracking: enabled")
  } else {
    console.log("[press-freedom] Supabase tracking: disabled (no env vars, using local files only)")
  }

  // Build source → preloaded-videos map when --list-file is provided.
  // The JSON's playlistId becomes the sourceId; we synthesize a YouTubeSource
  // entry if the playlist isn't already declared in channels.ts.
  const preloadedVideos = new Map<string, VideoMeta[]>()
  let sources: YouTubeSource[]

  if (options.listFile) {
    const raw = readFileSync(options.listFile, "utf8")
    const parsed = JSON.parse(raw) as {
      playlistId: string
      fromDate?: string
      toDate?: string
      videos: Array<{ videoId: string; title: string; contentDate: string }>
    }
    const sourceId = parsed.playlistId
    const declared = YOUTUBE_SOURCES.find(s => s.id === sourceId)
    sources = [declared ?? {
      id: sourceId,
      name: `Playlist ${sourceId}`,
      description: `Loaded from ${options.listFile}`,
      category: "state-media",
      type: "playlist",
    }]
    const videos: VideoMeta[] = parsed.videos.map(v => ({
      videoId: v.videoId,
      sourceId,
      title: v.title,
      uploadDate: v.contentDate.replace(/-/g, ""),
      duration: 0,
    }))
    preloadedVideos.set(sourceId, videos)
    console.log(`[press-freedom] Loaded ${videos.length} videos from list-file: ${options.listFile}`)
  } else {
    sources = options.sourceIds
      ? YOUTUBE_SOURCES.filter(s => options.sourceIds!.includes(s.id))
      : YOUTUBE_SOURCES
  }

  if (sources.length === 0) {
    console.error("[press-freedom] No matching sources found")
    process.exit(1)
  }

  let totalDownloaded = 0
  let totalTranscribed = 0
  let totalErrors = 0

  for (const source of sources) {
    console.log(`\n[press-freedom] === Processing: ${source.name} (${source.id}) ===`)

    // Step 1: Get video list (from preloaded list-file or via yt-dlp)
    let videos: VideoMeta[]
    const preloaded = preloadedVideos.get(source.id)
    if (preloaded) {
      videos = preloaded
      console.log(`[press-freedom] Using preloaded list: ${videos.length} videos`)
    } else {
      try {
        videos = await listVideos(source.id, source.type, options)
      } catch (err) {
        console.error(`[press-freedom] Failed to list videos for ${source.name}:`, err)
        totalErrors++
        continue
      }
    }

    if (videos.length === 0) {
      console.log("[press-freedom] No videos found for this source")
      continue
    }

    // Step 2: Filter out already-processed videos
    const processed = await getProcessedVideoIds(source.id)
    let toProcess = videos.filter(v => {
      const status = processed.get(v.videoId)
      if (options.skipDownload) return status === "downloaded"
      return !status || status === "pending" || status === "error"
    })

    if (options.onePerDay) {
      const byDate = new Map<string, VideoMeta[]>()
      for (const v of toProcess) {
        const key = v.uploadDate || "unknown"
        const group = byDate.get(key)
        if (group) group.push(v)
        else byDate.set(key, [v])
      }
      const picked: VideoMeta[] = []
      for (const group of byDate.values()) {
        const estelar = group.find(v => /estelar/i.test(v.title))
        picked.push(estelar ?? group[0])
      }
      picked.sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
      console.log(`[press-freedom] --one-per-day: ${picked.length} days selected from ${toProcess.length} videos`)
      toProcess = picked
    }

    if (options.limit && toProcess.length > options.limit) {
      console.log(`[press-freedom] Applying --limit ${options.limit} (filtered down from ${toProcess.length})`)
      toProcess = toProcess.slice(0, options.limit)
    }

    console.log(`[press-freedom] ${toProcess.length} videos to process (${videos.length - toProcess.length} already done or skipped)`)

    // Step 3: Process each video
    for (const video of toProcess) {
      console.log(`\n[press-freedom] --- ${video.title} (${video.videoId}) ---`)

      // Download audio
      if (!options.skipDownload) {
        try {
          video.audioPath = await downloadAudio(video)
          await upsertVideo(video, "downloaded")
          totalDownloaded++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[press-freedom] Download failed: ${msg}`)
          await upsertVideo(video, "error", msg)
          totalErrors++
          continue
        }
      }

      // Transcribe audio
      if (!options.skipTranscribe) {
        const audioPath = video.audioPath
        if (!audioPath) {
          console.error(`[press-freedom] No audio path for ${video.videoId}, skipping transcription`)
          continue
        }
        try {
          video.transcriptPath = await transcribeAudio(audioPath, video)
          await upsertVideo(video, "transcribed")
          totalTranscribed++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[press-freedom] Transcription failed: ${msg}`)
          await upsertVideo(video, "error", msg)
          totalErrors++
        }
      }
    }
  }

  console.log(`\n[press-freedom] === Summary ===`)
  console.log(`[press-freedom] Downloaded: ${totalDownloaded}`)
  console.log(`[press-freedom] Transcribed: ${totalTranscribed}`)
  console.log(`[press-freedom] Errors: ${totalErrors}`)
}

main().catch(err => {
  console.error("[press-freedom] Fatal error:", err)
  process.exit(1)
})
