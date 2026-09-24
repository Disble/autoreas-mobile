package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.runner.RunWith
import org.junit.Test
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ReconcileResponseParserTest {
  @Test
  fun parsesAppliedOperationFromBridgeResponse() {
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"anime-42","operation":"update","applied":true}]}""",
    )

    assertEquals(1, parsed.appliedOperations.size)
    assertEquals("anime-42", parsed.appliedOperations.single().animeId)
    assertEquals("update", parsed.appliedOperations.single().operation)
    assertTrue(parsed.appliedOperations.single().applied)
  }

  @Test
  fun missingAndNullArraysUseEmptyFallbacks() {
    val missing = ReconcileResponseParser.parse("{}")
    val nulls = ReconcileResponseParser.parse(
      """{"applied_operations":null,"bridge_changes":null}""",
    )
    val wrongShapes = ReconcileResponseParser.parse(
      """{"applied_operations":"not-an-array","bridge_changes":{}}""",
    )

    assertTrue(missing.appliedOperations.isEmpty())
    assertTrue(missing.bridgeChanges.isEmpty())
    assertTrue(nulls.appliedOperations.isEmpty())
    assertTrue(nulls.bridgeChanges.isEmpty())
    assertTrue(wrongShapes.appliedOperations.isEmpty())
    assertTrue(wrongShapes.bridgeChanges.isEmpty())
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsAppliedOperationWithoutAnimeId() {
    ReconcileResponseParser.parse("""{"applied_operations":[{"operation":"update"}]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsAppliedOperationWithoutOperation() {
    ReconcileResponseParser.parse("""{"applied_operations":[{"anime_id":"a-1"}]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsBridgeChangeWithoutRecordId() {
    ReconcileResponseParser.parse("""{"bridge_changes":[{"change_type":"create","timestamp":1}]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsBridgeChangeWithoutTimestamp() {
    ReconcileResponseParser.parse("""{"bridge_changes":[{"record_id":"a-1","change_type":"create"}]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsMalformedJsonShape() {
    ReconcileResponseParser.parse("[]")
  }

  @Test
  fun acceptsEachSupportedChangeType() {
    val parsed = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a","change_type":"create","timestamp":1},{"record_id":"b","change_type":"update","timestamp":2},{"record_id":"c","change_type":"delete","timestamp":3}]}""",
    )

    assertEquals(listOf("create", "update", "delete"), parsed.bridgeChanges.map { it.changeType })
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsUnknownChangeType() {
    ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a","change_type":"restore","timestamp":1}]}""",
    )
  }

  @Test
  fun preservesZeroValuedOccTokensAsPresentValues() {
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"a","operation":"update","modified_at":0}],"last_changelog_id":0}""",
    )

    assertEquals(0L, parsed.appliedOperations.single().modifiedAt)
    assertEquals(0L, parsed.lastChangelogId)
  }

  @Test
  fun absentAndNonNumericOptionalTokensAreNull() {
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"a","operation":"update"}],"last_changelog_id":"later"}""",
    )

    assertEquals(null, parsed.appliedOperations.single().modifiedAt)
    assertEquals(null, parsed.lastChangelogId)
  }

  @Test
  fun mapsWireChangedFieldsToLocalVocabularyAndDropsUnknownFields() {
    val parsed = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","changed_fields":["name","episodesWatched","genres","unknownField"],"timestamp":9}]}""",
    )
    val normalized = WireAnimeMapper.normalize(parsed.bridgeChanges.single())

    assertEquals("[\"nombre\",\"nrocapvisto\",\"generos\"]", normalized.changedFieldsJson)
    assertEquals("a-1", normalized.recordId)
    assertEquals("update", normalized.changeType)
    assertEquals(9L, normalized.timestamp)
  }

  @Test
  fun mapsWireSnapshotIntoLegacyLocalShape() {
    val parsed = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"anime-7","change_type":"update","timestamp":12,"snapshot":{"id":"anime-7","name":"North Star","status":2,"episodesWatched":4,"totalEpisodes":12,"active":1,"firstCycle":0,"days":[{"day":"Tue","order":2}],"genres":["Mystery"],"kind":1,"lastWatchedAt":1700,"premieredAt":1800,"createdAt":1900,"deletedAt":2000,"cover":"cover.png","sourceUrl":"https://example.invalid/anime/7","folder":"North","studios":"Studio X","origin":"Manga","durationMinutes":24,"modified_at":0}}]}""",
    )
    val normalized = WireAnimeMapper.normalize(parsed.bridgeChanges.single())
    val legacy = org.json.JSONObject(normalized.snapshotJson!!)

    assertEquals("anime-7", legacy.getString("_id"))
    assertEquals("North Star", legacy.getString("nombre"))
    assertEquals(2, legacy.getInt("estado"))
    assertEquals(4, legacy.getInt("nrocapvisto"))
    assertEquals(12, legacy.getInt("totalcap"))
    assertEquals(1, legacy.getInt("activo"))
    assertEquals(0, legacy.getInt("primeravez"))
    assertEquals("Tue", legacy.getJSONArray("dias").getJSONObject(0).getString("dia"))
    assertEquals(2, legacy.getJSONArray("dias").getJSONObject(0).getInt("orden"))
    assertEquals("Mystery", legacy.getJSONArray("generos").getString(0))
    assertEquals(1, legacy.getInt("tipo"))
    assertEquals(1700, legacy.getLong("fechaUltCapVisto"))
    assertEquals(1800, legacy.getLong("fechaEstreno"))
    assertEquals(1900, legacy.getLong("fechaCreacion"))
    assertEquals(2000, legacy.getLong("fechaEliminacion"))
    assertEquals("cover.png", legacy.getString("portada"))
    assertEquals("https://example.invalid/anime/7", legacy.getString("pagina"))
    assertEquals("North", legacy.getString("carpeta"))
    assertEquals("Studio X", legacy.getString("estudios"))
    assertEquals("Manga", legacy.getString("origen"))
    assertEquals(24, legacy.getInt("duracion"))
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsSnapshotWithNonStringId() {
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":7,"name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"modified_at":0}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsSnapshotWithNonStringName() {
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":7,"status":1,"episodesWatched":0,"active":1,"firstCycle":0,"modified_at":0}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsSnapshotWithMissingRequiredScalar() {
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsSnapshotWithMalformedDaysShape() {
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"days":"Tuesday"}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsNonObjectSnapshot() {
    ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":[]}]}""",
    )
  }
}
