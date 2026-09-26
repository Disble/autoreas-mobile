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
  fun rejectsADaysEntryThatIsNotAnObject() {
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"days":["not-an-object"]}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test
  fun mapsTheLegacyEmptyStringSentinelForDaysAndGenresToAnEmptyArray() {
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"days":"","genres":""}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertEquals(0, legacy.getJSONArray("dias").length())
    assertEquals(0, legacy.getJSONArray("generos").length())
  }

  @Test
  fun dateLikeUnwrapsTheDollarDollarDateWrapper() {
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"lastWatchedAt":{"${'$'}${'$'}date":12345}}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertEquals(12345L, legacy.getLong("fechaUltCapVisto"))
  }

  @Test
  fun mapsAnExplicitJsonNullDaysAndGenresToAnEmptyArrayJustLikeAnAbsentKey() {
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"days":null,"genres":null}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertEquals(0, legacy.getJSONArray("dias").length())
    assertEquals(0, legacy.getJSONArray("generos").length())
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsANonArrayNonEmptyStringGenresValue() {
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"genres":"Action"}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsGenresWithANonStringElement() {
    // The local domain contract is `genres: z.array(z.string())`: a mixed array like
    // `["Action", 42]` must be rejected here (retryable), never staged and later committed.
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"genres":["Action",42]}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsAGenresElementThatIsJsonNull() {
    // A JSON `null` MEMBER is not the legacy empty-string sentinel: it is still a non-string
    // element, and `JSONArray.opt` hands it back as `JSONObject.NULL`, not Kotlin `null`.
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"genres":["Action",null]}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test
  fun dateLikeIsNullWhenTheDollarDollarDateWrapperItselfCarriesNoValue() {
    // `has("$$date")` is true, but `opt("$$date")` itself returns null -- the `?:` fallback,
    // distinct from the outer `else` (no "$$date" key at all) covered by the next test.
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"lastWatchedAt":{"${'$'}${'$'}date":null}}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertTrue(legacy.isNull("fechaUltCapVisto"))
  }

  @Test
  fun dateLikeIsNullForAJsonObjectWithoutTheDollarDollarDateKey() {
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"lastWatchedAt":{"other":1}}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertTrue(legacy.isNull("fechaUltCapVisto"))
  }

  @Test
  fun dateLikeIsNullForAnUnsupportedValueType() {
    // Neither a Number, a String, nor a `{ "$$date": n }` object: `dateLike`'s `when` must fall
    // to its `else -> JSONObject.NULL`.
    val change = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"lastWatchedAt":[1,2,3]}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertTrue(legacy.isNull("fechaUltCapVisto"))
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

  @Test(expected = ReconcileParseException::class)
  fun rejectsANullBody() {
    ReconcileResponseParser.parse(null)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsABlankBody() {
    ReconcileResponseParser.parse("   ")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsAnAppliedOperationsElementThatIsNotAnObject() {
    ReconcileResponseParser.parse("""{"applied_operations":["not-an-object"]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsABridgeChangesElementThatIsNotAnObject() {
    ReconcileResponseParser.parse("""{"bridge_changes":[42]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsBridgeChangeWithoutChangeType() {
    ReconcileResponseParser.parse("""{"bridge_changes":[{"record_id":"a-1","timestamp":1}]}""")
  }

  @Test
  fun anExplicitJsonNullSnapshotIsTreatedAsAbsent() {
    // Distinct from an OMITTED "snapshot" key: `entry.has("snapshot")` is true here, but
    // `entry.isNull("snapshot")` must short-circuit the "not an object" rejection.
    val parsed = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":null}]}""",
    )

    assertEquals(null, parsed.bridgeChanges.single().snapshot)
  }

  @Test
  fun anExplicitJsonNullLastChangelogIdIsNullDistinctFromAnAbsentKey() {
    val parsed = ReconcileResponseParser.parse("""{"last_changelog_id":null}""")

    assertEquals(null, parsed.lastChangelogId)
  }

  @Test
  fun aNumericStringOptionalTokenParsesSuccessfully() {
    val parsed = ReconcileResponseParser.parse("""{"last_changelog_id":"42"}""")

    assertEquals(42L, parsed.lastChangelogId)
  }

  @Test
  fun anOptionalTokenOfAnUnsupportedTypeIsNull() {
    // Neither Number nor String: the `parseOptionalLong` `when` must fall to its `else -> null`.
    val parsed = ReconcileResponseParser.parse(
      """{"applied_operations":[{"anime_id":"a","operation":"update","modified_at":true}]}""",
    )

    assertEquals(null, parsed.appliedOperations.single().modifiedAt)
  }

  @Test
  fun anExplicitJsonNullAnimeIdIsRejectedJustLikeAnAbsentOne() {
    try {
      ReconcileResponseParser.parse(
        """{"applied_operations":[{"anime_id":null,"operation":"update"}]}""",
      )
      org.junit.Assert.fail("expected ReconcileParseException")
    } catch (expected: ReconcileParseException) {
      // expected: optStringOrNull's `isNull(key)` branch, not only its `!has(key)` branch.
    }
  }

  @Test
  fun nonStringChangedFieldsElementsAreDroppedNotThrown() {
    val parsed = ReconcileResponseParser.parse(
      """{"bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"changed_fields":["name",7,null,"genres"]}]}""",
    )

    assertEquals(
      listOf("nombre", "generos"),
      WireAnimeMapper.normalize(parsed.bridgeChanges.single()).changedFieldsJson
        .let { org.json.JSONArray(it) }
        .let { array -> (0 until array.length()).map { array.getString(it) } },
    )
  }
}
