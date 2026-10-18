package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder

private const val TAG = "SyncEngineCatchUp"

/** Budget for each cover download. */
const val CATCH_UP_REQUEST_TIMEOUT_MS = 5_000

/** The JS-owned covers directory under `filesDir`; mirrors `COVERS_DIRECTORY_NAME`. */
const val COVERS_DIRECTORY_NAME = "covers"

/** The JS-owned cover manifest; mirrors `COVER_MANIFEST_FILE_NAME`. Native only ever reads it. */
const val COVER_MANIFEST_FILE_NAME = "manifest.json"

/**
 * The directory native downloads land in; mirrors `COVER_INBOX_DIRECTORY_NAME` in
 * `cover-files.constants.ts`. The JS cover store adopts each complete pair into `covers/`.
 */
const val COVER_INBOX_DIRECTORY_NAME = "covers-inbox"

/** Sidecar format version the JS adoption accepts; mirrors `CoverInboxEntrySchema`. */
const val COVER_INBOX_ENTRY_VERSION = 1

/** Most covers one background attempt downloads, so the catch-up stays short behind each tick. */
const val COVER_PREFETCH_MAX_PER_ATTEMPT = 3

/**
 * How long a cover that did not come back as an image waits before this process asks again. The
 * JS sweep owns every non-image answer (absent, unknown, backoff); this only keeps a cover the
 * bridge cannot give from being asked on every tick while the app stays in the background.
 */
const val COVER_PREFETCH_RETRY_MS = 60 * 60 * 1000L

/**
 * Background catch-up that runs after an attempt that reached the bridge (`closed`): it downloads
 * the covers of animes that have none yet, so an anime that arrives while the app is in the
 * background opens with its cover. The cover sweep used to run only from the JS foreground cycle,
 * which never runs in the background.
 *
 * Never throws: every failure is logged and leaves the previous state, because a catch-up step is
 * best effort and must never change how the attempt itself ended.
 */
object SyncEngineBackgroundCatchUp {

  /** Runs the cover prefetch against the real bridge, reading the connection from `bridge_config`. */
  fun run(filesDir: File, appDb: SQLiteDatabase) {
    try {
      val config = readBridgeConfig(appDb) ?: return
      if (!hasCompleteBridgeConnection(config)) return
      SyncEngineCoverPrefetch.shared(appDb, filesDir).prefetch(config)
    } catch (error: Throwable) {
      Log.w(TAG, "background catch-up failed", error)
    }
  }
}

/** One cover the prefetch may download: the anime and the normalized `portada` it was asked for. */
data class CoverPrefetchTarget(val animeId: String, val sourceKey: String)

/**
 * Downloads the covers of active animes that have NO entry in the JS cover manifest yet -- the
 * animes that reached the tablet in the background -- into [COVER_INBOX_DIRECTORY_NAME]. It never
 * writes `covers/` or the manifest: the JS sweep rewrites the manifest from memory and deletes
 * every file it does not reference, so a native write there would be lost or deleted. Instead each
 * download becomes a pair, `<name>.jpg` then `<name>.json`, both written to a temp name and renamed,
 * and the JS store adopts only pairs whose sidecar exists (see `adoptCoverInbox`). Revalidation,
 * `304`s, absent covers and backoff all stay with the JS sweep.
 *
 * Candidates are the active rows of `animes` plus the animes staged in `pending_remote_changes`
 * that the foreground has not drained yet, so a cover can arrive with the anime itself.
 */
class SyncEngineCoverPrefetch(
  private val appDb: SQLiteDatabase,
  private val filesDir: File,
  private val download: (url: String, token: String) -> SyncEngineBinaryResponse,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  /** When each anime was last asked without coming back as an image, for [COVER_PREFETCH_RETRY_MS]. */
  private val lastFailedAt = mutableMapOf<String, Long>()

  /** Downloads up to [COVER_PREFETCH_MAX_PER_ATTEMPT] missing covers; returns how many landed. */
  fun prefetch(config: BridgeConfigRow): Int {
    val known = readManifestAnimeIds() ?: return 0
    val inbox = File(filesDir, COVER_INBOX_DIRECTORY_NAME)
    val now = clock()
    val targets = readCandidates()
      .filter { it.animeId !in known }
      .filter { !File(inbox, "${coverInboxBaseName(it.animeId)}.json").exists() }
      .filter { (lastFailedAt[it.animeId] ?: Long.MIN_VALUE) + COVER_PREFETCH_RETRY_MS <= now }
      .take(COVER_PREFETCH_MAX_PER_ATTEMPT)

    var landed = 0
    for (target in targets) {
      val response = try {
        download(coverUrl(config, target.animeId), config.token!!)
      } catch (error: Throwable) {
        Log.w(TAG, "cover download did not reach the bridge; stopping", error)
        break
      }
      if (response.code == 401) break
      val bytes = response.bytes
      if (response.code != 200 || bytes == null || bytes.isEmpty()) {
        lastFailedAt[target.animeId] = now
        continue
      }
      writeInboxPair(inbox, target, bytes, response.etag, now)
      lastFailedAt.remove(target.animeId)
      landed += 1
    }
    return landed
  }

  /**
   * Reads the anime ids the JS manifest already has an entry for. A missing manifest is an empty
   * one, like `readCoverManifest`; an unreadable one returns `null` so nothing is downloaded on a
   * guess about what the app already holds.
   */
  private fun readManifestAnimeIds(): Set<String>? {
    val manifest = File(File(filesDir, COVERS_DIRECTORY_NAME), COVER_MANIFEST_FILE_NAME)
    if (!manifest.exists()) return emptySet()
    return try {
      val entries = JSONObject(manifest.readText()).getJSONObject("entries")
      entries.keys().asSequence().toSet()
    } catch (error: Throwable) {
      Log.w(TAG, "cover manifest unreadable; skipping the prefetch", error)
      null
    }
  }

  /** Active animes with a cover, in list order, then staged ones the list does not hold yet. */
  private fun readCandidates(): List<CoverPrefetchTarget> {
    val byAnimeId = LinkedHashMap<String, String?>()
    appDb.rawQuery("SELECT _id, portada FROM animes WHERE activo = 1", null).use { cursor ->
      while (cursor.moveToNext()) {
        byAnimeId[cursor.getString(0)] = normalizeCoverSourceKey(cursor.getString(1))
      }
    }
    for ((animeId, sourceKey) in readStagedCovers()) {
      if (sourceKey == null) byAnimeId.remove(animeId) else byAnimeId[animeId] = sourceKey
    }
    return byAnimeId.mapNotNull { (animeId, sourceKey) ->
      sourceKey?.let { CoverPrefetchTarget(animeId, it) }
    }
  }

  /**
   * Folds the staged changes in arrival order into each anime's latest cover source: a delete, an
   * inactive snapshot or an absent cover maps to `null` (no download). A store without the staging
   * table simply has nothing staged.
   */
  private fun readStagedCovers(): Map<String, String?> {
    val latest = LinkedHashMap<String, String?>()
    try {
      appDb.rawQuery(
        "SELECT record_id, change_type, snapshot FROM pending_remote_changes ORDER BY id",
        null,
      ).use { cursor ->
        while (cursor.moveToNext()) {
          latest[cursor.getString(0)] = stagedSourceKey(cursor.getString(1), cursor.getString(2))
        }
      }
    } catch (error: SQLiteException) {
      Log.w(TAG, "staged changes unreadable; prefetching listed animes only", error)
    }
    return latest
  }

  private fun stagedSourceKey(changeType: String?, snapshot: String?): String? {
    if (changeType == "delete" || snapshot == null) return null
    return try {
      val anime = JSONObject(snapshot)
      if (anime.optInt("activo", 0) != 1) null else normalizeCoverSourceKey(anime.opt("portada") as? String)
    } catch (error: Throwable) {
      null
    }
  }

  private fun writeInboxPair(
    inbox: File,
    target: CoverPrefetchTarget,
    bytes: ByteArray,
    etag: String?,
    fetchedAt: Long,
  ) {
    inbox.mkdirs()
    val baseName = coverInboxBaseName(target.animeId)
    val imageName = "$baseName.jpg"
    writeAtomically(File(inbox, imageName)) { it.writeBytes(bytes) }
    val sidecar = JSONObject()
      .put("version", COVER_INBOX_ENTRY_VERSION)
      .put("animeId", target.animeId)
      .put("imageFileName", imageName)
      .put("etag", etag ?: JSONObject.NULL)
      .put("sourceKey", target.sourceKey)
      .put("fetchedAt", fetchedAt)
    // The sidecar goes last: the JS adoption only ever reads a pair whose sidecar exists.
    writeAtomically(File(inbox, "$baseName.json")) { it.writeText(sidecar.toString()) }
  }

  private fun writeAtomically(target: File, write: (File) -> Unit) {
    val temp = File(target.parentFile, "${target.name}.tmp")
    write(temp)
    if (!temp.renameTo(target)) {
      temp.delete()
      error("could not move ${temp.name} into place")
    }
  }

  companion object {
    @Volatile
    private var instance: SyncEngineCoverPrefetch? = null

    /**
     * The process-wide prefetch the background attempts share, so [lastFailedAt] outlives one
     * attempt. Rebuilt only when the database or files directory changes (a test reset).
     */
    fun shared(appDb: SQLiteDatabase, filesDir: File): SyncEngineCoverPrefetch = synchronized(this) {
      val current = instance
      if (current != null && current.appDb === appDb && current.filesDir == filesDir) {
        current
      } else {
        SyncEngineCoverPrefetch(appDb, filesDir, { url, token ->
          SyncEngineHttp.getBytes(url, token, CATCH_UP_REQUEST_TIMEOUT_MS)
        }).also { instance = it }
      }
    }
  }
}

/** Builds the cover route for one anime; mirrors `buildAnimeCoverPath` (`encodeURIComponent`). */
internal fun coverUrl(config: BridgeConfigRow, animeId: String): String {
  val encoded = URLEncoder.encode(animeId, "UTF-8").replace("+", "%20")
  return "http://${config.ip}:${config.port}/api/animes/$encoded/cover"
}

/**
 * Normalizes a raw `portada` the way `normalizeCoverSourceKey` does: null, blank, or the literal
 * `"null"` is no cover; anything else is trimmed.
 */
internal fun normalizeCoverSourceKey(portada: String?): String? {
  val trimmed = portada?.trim() ?: return null
  return if (trimmed.isEmpty() || trimmed == "null") null else trimmed
}

/**
 * The inbox base name for one anime, with the escape rule of `sanitizeAnimeIdForFileName`: only
 * `[A-Za-z0-9-]` passes, every other UTF-16 unit becomes `_XXXX`, so two ids never collide.
 */
internal fun coverInboxBaseName(animeId: String): String = buildString {
  for (char in animeId) {
    if (char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char == '-') {
      append(char)
    } else {
      append('_').append(char.code.toString(16).padStart(4, '0'))
    }
  }
}
