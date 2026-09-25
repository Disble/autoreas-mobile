package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineResponseApplierTest {
  private lateinit var database: SQLiteDatabase
  private val statusUpdates = mutableListOf<Pair<List<Long>, String>>()

  @Before
  fun setUp() {
    database = SQLiteDatabase.create(null)
    database.execSQL("CREATE TABLE animes (_id TEXT PRIMARY KEY, bridge_modified_at INTEGER)")
    database.execSQL(
      "CREATE TABLE bridge_config (id INTEGER PRIMARY KEY, last_changelog_id INTEGER)",
    )
    database.execSQL(
      "CREATE TABLE operation_log (id INTEGER PRIMARY KEY, status TEXT NOT NULL)",
    )
    database.execSQL(PENDING_REMOTE_CHANGES_TABLE_SQL)
    database.execSQL("INSERT INTO bridge_config (id, last_changelog_id) VALUES (1, 10)")
    listOf(11L, 12L, 13L).forEachIndexed { index, id ->
      database.execSQL(
        "INSERT INTO operation_log (id, status) VALUES (?, 'processing')",
        arrayOf(id),
      )
      if (index == 0) {
        database.execSQL("INSERT INTO animes (_id, bridge_modified_at) VALUES ('anime-a', 4)")
      }
    }
  }

  @After
  fun tearDown() {
    database.close()
  }

  @Test
  fun appliesConfirmationTokenAndNormalizedBridgeChange() {
    val applier = SyncEngineResponseApplier(database, ::updateOperationStatus)
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"anime-a","operation":"update","applied":true,"modified_at":47},{"anime_id":"anime-b","operation":"update","applied":false,"reason":"unsupported_operation"}],"bridge_changes":[{"record_id":"remote-b","change_type":"update","changed_fields":["name","episodesWatched","unmapped"],"timestamp":81,"snapshot":{"id":"remote-b","name":"Remote title","status":2,"episodesWatched":3,"active":1,"firstCycle":0,"modified_at":999}}],"last_changelog_id":16}""",
    )

    val confirmed = inImmediateTransaction(database) {
      applier.apply(1, parsed, backlog(), lastChangelogId = 10)
    }

    assertEquals(1, confirmed)
    assertEquals("synced", operationStatus(11))
    assertEquals("dead_letter", operationStatus(12))
    assertEquals("pending", operationStatus(13))
    assertEquals(listOf(11L), statusUpdates.single { it.second == "synced" }.first)
    assertEquals(47L, animeToken("anime-a"))
    assertEquals(16L, changelogCursor())

    val staged = stagedChanges().single()
    assertEquals("remote-b", staged.recordId)
    assertEquals("update", staged.changeType)
    assertEquals("[\"nombre\",\"nrocapvisto\"]", staged.changedFields)
    assertEquals(81L, staged.timestamp)
    val snapshot = org.json.JSONObject(staged.snapshot!!)
    assertEquals("remote-b", snapshot.getString("_id"))
    assertEquals("Remote title", snapshot.getString("nombre"))
    assertEquals(2, snapshot.getInt("estado"))
    assertEquals(false, snapshot.has("modified_at"))
  }

  @Test
  fun writesZeroAppliedOperationTokenAsARealToken() {
    val applier = SyncEngineResponseApplier(database, ::updateOperationStatus)
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"anime-a","operation":"update","applied":true,"modified_at":0}]}""",
    )

    val confirmed = inImmediateTransaction(database) {
      applier.apply(1, parsed, backlog(), lastChangelogId = 10)
    }

    assertEquals(1, confirmed)
    assertEquals("synced", operationStatus(11))
    assertEquals(0L, animeToken("anime-a"))
  }

  @Test
  fun lastAppliedOperationTokenWinsForRepeatedAnime() {
    val applier = SyncEngineResponseApplier(database, ::updateOperationStatus)
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"anime-a","operation":"update","applied":true,"modified_at":47},{"anime_id":"anime-a","operation":"update","applied":true,"modified_at":52}]}""",
    )

    val confirmed = inImmediateTransaction(database) {
      applier.apply(1, parsed, backlog(), lastChangelogId = 10)
    }

    assertEquals(1, confirmed)
    assertEquals("synced", operationStatus(11))
    assertEquals(52L, animeToken("anime-a"))
  }

  @Test
  fun cursorDoesNotRegressAndAdvancesWhenResponseIsAhead() {
    val applier = SyncEngineResponseApplier(database, ::updateOperationStatus)

    inImmediateTransaction(database) {
      applier.apply(
        1,
        ParsedReconcileResponse(emptyList(), emptyList(), lastChangelogId = 7),
        emptyList(),
        lastChangelogId = 10,
      )
    }
    assertEquals(10L, changelogCursor())

    inImmediateTransaction(database) {
      applier.apply(
        1,
        ParsedReconcileResponse(emptyList(), emptyList(), lastChangelogId = 14),
        emptyList(),
        lastChangelogId = 10,
      )
    }
    assertEquals(14L, changelogCursor())
  }

  @Test
  fun failureInSuppliedStatusBoundaryRollsBackAllResponseWrites() {
    val applier = SyncEngineResponseApplier(database) { ids, status ->
      updateOperationStatus(ids, status)
      if (status == "synced") error("status persistence failed")
    }
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"anime-a","operation":"update","applied":true,"modified_at":47}],"bridge_changes":[{"record_id":"remote-b","change_type":"create","changed_fields":["name"],"timestamp":81,"snapshot":{"id":"remote-b","name":"Remote title","status":2,"episodesWatched":3,"active":1,"firstCycle":0,"modified_at":0}}],"last_changelog_id":16}""",
    )

    assertThrows(IllegalStateException::class.java) {
      inImmediateTransaction(database) {
        applier.apply(1, parsed, backlog(), lastChangelogId = 10)
      }
    }

    assertEquals(0, stagedChanges().size)
    assertEquals(4L, animeToken("anime-a"))
    assertEquals(10L, changelogCursor())
    assertEquals("processing", operationStatus(11))
  }

  @Test
  fun anAppliedOperationWithoutAModifiedAtWritesNoToken() {
    val applier = SyncEngineResponseApplier(database, ::updateOperationStatus)
    // applied=true but modified_at is ABSENT: the `entry.applied && entry.modifiedAt != null`
    // guard's second operand must short-circuit to false, never crash on the null token.
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"anime-a","operation":"update","applied":true}]}""",
    )

    inImmediateTransaction(database) {
      applier.apply(1, parsed, backlog(), lastChangelogId = 10)
    }

    // The stored token (from setUp's own INSERT) is untouched -- no UPDATE was ever issued.
    assertEquals(4L, animeToken("anime-a"))
  }

  @Test
  fun aRejectedOperationWithAnUnrecognizedReasonResetsToPendingNotDeadLetter() {
    val applier = SyncEngineResponseApplier(database, ::updateOperationStatus)
    // Only "unsupported_operation" dead-letters; every other rejection reason (even a known,
    // non-null one) resets to pending -- the deferred conflict-exhaustion policy.
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"anime-b","operation":"update","applied":false,"reason":"conflict"}]}""",
    )

    inImmediateTransaction(database) {
      applier.apply(1, parsed, backlog(), lastChangelogId = 10)
    }

    assertEquals("pending", operationStatus(12))
  }

  @Test
  fun aRejectedOperationWithNoReasonAtAllResetsToPendingNotDeadLetter() {
    val applier = SyncEngineResponseApplier(database, ::updateOperationStatus)
    // rejected is non-null but its `reason` field itself is null (never set), not merely a
    // different string -- a distinct path through the `rejected?.reason == ...` comparison.
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"anime-b","operation":"update","applied":false}]}""",
    )

    inImmediateTransaction(database) {
      applier.apply(1, parsed, backlog(), lastChangelogId = 10)
    }

    assertEquals("pending", operationStatus(12))
  }

  @Test
  fun aRejectedEntryForTheSameAnimeButADifferentOperationNeverMatchesResetsToPending() {
    val applier = SyncEngineResponseApplier(database, ::updateOperationStatus)
    // anime_id matches row 13 ("anime-c"), but the operation does not ("delete" vs the row's
    // "update"): the rejected-entry lookup's `it.operation == row.operation` conjunct must be
    // what excludes it, not the anime_id check alone.
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"anime-c","operation":"delete","applied":false,"reason":"unsupported_operation"}]}""",
    )

    inImmediateTransaction(database) {
      applier.apply(1, parsed, backlog(), lastChangelogId = 10)
    }

    assertEquals("pending", operationStatus(13))
  }

  @Test
  fun aBridgeChangeWithNoSnapshotStagesANullSnapshotColumn() {
    val applier = SyncEngineResponseApplier(database, ::updateOperationStatus)
    val parsed = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"remote-c","change_type":"delete","changed_fields":[],"timestamp":5}]}""",
    )

    inImmediateTransaction(database) {
      applier.apply(1, parsed, emptyList(), lastChangelogId = 10)
    }

    val staged = stagedChanges().single()
    assertEquals("remote-c", staged.recordId)
    assertEquals(null, staged.snapshot)
  }

  private fun updateOperationStatus(ids: List<Long>, status: String) {
    statusUpdates.add(ids.toList() to status)
    val placeholders = ids.joinToString(",") { "?" }
    database.compileStatement("UPDATE operation_log SET status = ? WHERE id IN ($placeholders)").apply {
      bindString(1, status)
      ids.forEachIndexed { index, id -> bindLong(index + 2, id) }
      executeUpdateDelete()
    }
  }

  private fun backlog(): List<BacklogRow> = listOf(
    BacklogRow(11, "anime-a", "update", "{}", "processing", 1, 0),
    BacklogRow(12, "anime-b", "update", "{}", "processing", 2, 0),
    BacklogRow(13, "anime-c", "update", "{}", "processing", 3, 0),
  )

  private fun operationStatus(id: Long): String = database.rawQuery(
    "SELECT status FROM operation_log WHERE id = ?",
    arrayOf(id.toString()),
  ).use { cursor ->
    check(cursor.moveToFirst())
    cursor.getString(0)
  }

  private fun animeToken(animeId: String): Long = database.rawQuery(
    "SELECT bridge_modified_at FROM animes WHERE _id = ?",
    arrayOf(animeId),
  ).use { cursor ->
    check(cursor.moveToFirst())
    cursor.getLong(0)
  }

  private fun changelogCursor(): Long = database.rawQuery(
    "SELECT last_changelog_id FROM bridge_config WHERE id = 1",
    null,
  ).use { cursor ->
    check(cursor.moveToFirst())
    cursor.getLong(0)
  }

  private fun stagedChanges(): List<StagedChange> = database.rawQuery(
    "SELECT record_id, change_type, changed_fields, snapshot, timestamp " +
      "FROM pending_remote_changes ORDER BY id",
    null,
  ).use { cursor ->
    buildList {
      while (cursor.moveToNext()) {
        add(
          StagedChange(
            recordId = cursor.getString(0),
            changeType = cursor.getString(1),
            changedFields = cursor.getString(2),
            snapshot = if (cursor.isNull(3)) null else cursor.getString(3),
            timestamp = cursor.getLong(4),
          ),
        )
      }
    }
  }

  private data class StagedChange(
    val recordId: String,
    val changeType: String,
    val changedFields: String,
    val snapshot: String?,
    val timestamp: Long,
  )
}
