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
      """{"status":"accepted","applied_operations":[{"anime_id":"anime-42","operation":"update","applied":true}]}""",
    )

    assertEquals(1, parsed.appliedOperations.size)
    assertEquals("anime-42", parsed.appliedOperations.single().animeId)
    assertEquals("update", parsed.appliedOperations.single().operation)
    assertTrue(parsed.appliedOperations.single().applied)
  }

  @Test
  fun missingAndNullArraysUseEmptyFallbacks() {
    // `ReconcileArrayFallback` (`z.array(...).nullish()`): absent and null are empty, nothing else.
    val missing = ReconcileResponseParser.parse("""{"status":"accepted"}""")
    val nulls = ReconcileResponseParser.parse(
      """{"status":"accepted","applied_operations":null,"bridge_changes":[{"record_id":"a","change_type":"update","timestamp":1,"changed_fields":null}]}""",
    )

    assertTrue(missing.appliedOperations.isEmpty())
    assertTrue(missing.bridgeChanges.isEmpty())
    assertTrue(nulls.appliedOperations.isEmpty())
    assertTrue(nulls.bridgeChanges.single().changedFields.isEmpty())
    assertTrue(ReconcileResponseParser.parse("""{"status":"accepted","bridge_changes":null}""").bridgeChanges.isEmpty())
  }

  /** Every body the JS `ReconcileResponseSchema.safeParse` rejects is malformed here too (ADR 009 R-5). */
  @Test
  fun rejectsEveryShapeTheJsSchemaRejects() {
    val change = """"record_id":"a","change_type":"update","timestamp":1"""
    val operation = """"anime_id":"a","operation":"update","applied":true"""
    val malformed = listOf(
      // `status`: a required string.
      """{}""",
      """{"status":1}""",
      """{"status":null}""",
      // A collection that is present but not an array.
      """{"status":"accepted","applied_operations":"not-an-array"}""",
      """{"status":"accepted","applied_operations":{}}""",
      """{"status":"accepted","bridge_changes":{}}""",
      """{"status":"accepted","bridge_changes":"not-an-array"}""",
      """{"status":"accepted","bridge_changes":[{$change,"changed_fields":""}]}""",
      // `last_changelog_id`: optional, never null or a string.
      """{"status":"accepted","last_changelog_id":null}""",
      """{"status":"accepted","last_changelog_id":"42"}""",
      // `applied`: a required boolean.
      """{"status":"accepted","applied_operations":[{"anime_id":"a","operation":"update"}]}""",
      """{"status":"accepted","applied_operations":[{"anime_id":"a","operation":"update","applied":"true"}]}""",
      // `modified_at`: an optional integer.
      """{"status":"accepted","applied_operations":[{$operation,"modified_at":null}]}""",
      """{"status":"accepted","applied_operations":[{$operation,"modified_at":"5"}]}""",
      """{"status":"accepted","applied_operations":[{$operation,"modified_at":5.5}]}""",
      """{"status":"accepted","applied_operations":[{$operation,"modified_at":true}]}""",
      // `reason`: an optional string.
      """{"status":"accepted","applied_operations":[{$operation,"reason":null}]}""",
      """{"status":"accepted","applied_operations":[{$operation,"reason":3}]}""",
      // `timestamp`: a required number.
      """{"status":"accepted","bridge_changes":[{"record_id":"a","change_type":"update","timestamp":"1"}]}""",
      """{"status":"accepted","bridge_changes":[{"record_id":"a","change_type":"update","timestamp":null}]}""",
      // `snapshot`: optional, never null.
      """{"status":"accepted","bridge_changes":[{$change,"snapshot":null}]}""",
      // `changed_fields`: strings only.
      """{"status":"accepted","bridge_changes":[{$change,"changed_fields":["name",7]}]}""",
      """{"status":"accepted","bridge_changes":[{$change,"changed_fields":["name",null]}]}""",
    )

    val accepted = malformed.filter { body ->
      try {
        ReconcileResponseParser.parse(body)
        true
      } catch (expected: ReconcileParseException) {
        false
      }
    }

    assertEquals(emptyList<String>(), accepted)
  }

  @Test
  fun acceptsAnIntegralTokenWrittenAsADecimalAndAFractionalCursorLikeTheJsSchema() {
    val parsed = ReconcileResponseParser.parse(
      """{"status":"accepted","applied_operations":[{"anime_id":"a","operation":"update","applied":true,"modified_at":5.0,"reason":"conflict"}],"last_changelog_id":7.5}""",
    )

    assertEquals(5L, parsed.appliedOperations.single().modifiedAt)
    assertEquals("conflict", parsed.appliedOperations.single().reason)
    assertEquals(7L, parsed.lastChangelogId)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsAppliedOperationWithoutAnimeId() {
    ReconcileResponseParser.parse("""{"status":"accepted","applied_operations":[{"operation":"update"}]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsAppliedOperationWithoutOperation() {
    ReconcileResponseParser.parse("""{"status":"accepted","applied_operations":[{"anime_id":"a-1"}]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsBridgeChangeWithoutRecordId() {
    ReconcileResponseParser.parse("""{"status":"accepted","bridge_changes":[{"change_type":"create","timestamp":1}]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsBridgeChangeWithoutTimestamp() {
    ReconcileResponseParser.parse("""{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"create"}]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsMalformedJsonShape() {
    ReconcileResponseParser.parse("[]")
  }

  @Test
  fun acceptsEachSupportedChangeType() {
    val parsed = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a","change_type":"create","timestamp":1},{"record_id":"b","change_type":"update","timestamp":2},{"record_id":"c","change_type":"delete","timestamp":3}]}""",
    )

    assertEquals(listOf("create", "update", "delete"), parsed.bridgeChanges.map { it.changeType })
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsUnknownChangeType() {
    ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a","change_type":"restore","timestamp":1}]}""",
    )
  }

  @Test
  fun preservesZeroValuedOccTokensAsPresentValues() {
    val parsed = ReconcileResponseParser.parse(
      """{"status":"accepted","applied_operations":[{"anime_id":"a","operation":"update","applied":true,"modified_at":0}],"last_changelog_id":0}""",
    )

    assertEquals(0L, parsed.appliedOperations.single().modifiedAt)
    assertEquals(0L, parsed.lastChangelogId)
  }

  @Test
  fun absentOptionalFieldsAreNull() {
    val parsed = ReconcileResponseParser.parse(
      """{"status":"accepted","applied_operations":[{"anime_id":"a","operation":"update","applied":false}]}""",
    )

    assertEquals(null, parsed.appliedOperations.single().modifiedAt)
    assertEquals(null, parsed.appliedOperations.single().reason)
    assertEquals(null, parsed.lastChangelogId)
  }

  @Test
  fun mapsWireChangedFieldsToLocalVocabularyAndDropsUnknownFields() {
    val parsed = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","changed_fields":["name","episodesWatched","genres","unknownField"],"timestamp":9}]}""",
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
      """{"status":"accepted","bridge_changes":[{"record_id":"anime-7","change_type":"update","timestamp":12,"snapshot":{"id":"anime-7","name":"North Star","status":2,"episodesWatched":4,"totalEpisodes":12,"active":1,"firstCycle":0,"days":[{"day":"Tue","order":2}],"genres":["Mystery"],"kind":1,"lastWatchedAt":1700,"premieredAt":1800,"createdAt":1900,"deletedAt":2000,"cover":"cover.png","sourceUrl":"https://example.invalid/anime/7","folder":"North","studios":"Studio X","origin":"Manga","durationMinutes":24,"modified_at":0}}]}""",
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
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":7,"name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"modified_at":0}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsSnapshotWithNonStringName() {
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":7,"status":1,"episodesWatched":0,"active":1,"firstCycle":0,"modified_at":0}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsSnapshotWithMissingRequiredScalar() {
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsADaysEntryThatIsNotAnObject() {
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"days":["not-an-object"]}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test
  fun mapsTheLegacyEmptyStringSentinelForDaysAndGenresToAnEmptyArray() {
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"days":"","genres":""}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertEquals(0, legacy.getJSONArray("dias").length())
    assertEquals(0, legacy.getJSONArray("generos").length())
  }

  @Test
  fun dateLikeUnwrapsTheDollarDollarDateWrapper() {
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"lastWatchedAt":{"${'$'}${'$'}date":12345}}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertEquals(12345L, legacy.getLong("fechaUltCapVisto"))
  }

  @Test
  fun mapsAnExplicitJsonNullDaysAndGenresToAnEmptyArrayJustLikeAnAbsentKey() {
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"days":null,"genres":null}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertEquals(0, legacy.getJSONArray("dias").length())
    assertEquals(0, legacy.getJSONArray("generos").length())
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsANonArrayNonEmptyStringGenresValue() {
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"genres":"Action"}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsGenresWithANonStringElement() {
    // The local domain contract is `genres: z.array(z.string())`: a mixed array like
    // `["Action", 42]` must be rejected here (retryable), never staged and later committed.
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"genres":["Action",42]}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsAGenresElementThatIsJsonNull() {
    // A JSON `null` MEMBER is not the legacy empty-string sentinel: it is still a non-string
    // element, and `JSONArray.opt` hands it back as `JSONObject.NULL`, not Kotlin `null`.
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"genres":["Action",null]}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test
  fun dateLikeIsNullWhenTheDollarDollarDateWrapperItselfCarriesNoValue() {
    // `has("$$date")` is true, but `opt("$$date")` itself returns null -- the `?:` fallback,
    // distinct from the outer `else` (no "$$date" key at all) covered by the next test.
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"lastWatchedAt":{"${'$'}${'$'}date":null}}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertTrue(legacy.isNull("fechaUltCapVisto"))
  }

  @Test
  fun dateLikeIsNullForAJsonObjectWithoutTheDollarDollarDateKey() {
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"lastWatchedAt":{"other":1}}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertTrue(legacy.isNull("fechaUltCapVisto"))
  }

  @Test
  fun dateLikeIsNullForAnUnsupportedValueType() {
    // Neither a Number, a String, nor a `{ "$$date": n }` object: `dateLike`'s `when` must fall
    // to its `else -> JSONObject.NULL`.
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"lastWatchedAt":[1,2,3]}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertTrue(legacy.isNull("fechaUltCapVisto"))
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsSnapshotWithMalformedDaysShape() {
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"days":"Tuesday"}}]}""",
    ).bridgeChanges.single()

    WireAnimeMapper.normalize(change)
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsNonObjectSnapshot() {
    ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":[]}]}""",
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
    ReconcileResponseParser.parse("""{"status":"accepted","applied_operations":["not-an-object"]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsABridgeChangesElementThatIsNotAnObject() {
    ReconcileResponseParser.parse("""{"status":"accepted","bridge_changes":[42]}""")
  }

  @Test(expected = ReconcileParseException::class)
  fun rejectsBridgeChangeWithoutChangeType() {
    ReconcileResponseParser.parse("""{"status":"accepted","bridge_changes":[{"record_id":"a-1","timestamp":1}]}""")
  }

  @Test
  fun anOmittedSnapshotIsAbsent() {
    val parsed = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1}]}""",
    )

    assertEquals(null, parsed.bridgeChanges.single().snapshot)
  }

  @Test
  fun anExplicitJsonNullAnimeIdIsRejectedJustLikeAnAbsentOne() {
    try {
      ReconcileResponseParser.parse(
        """{"status":"accepted","applied_operations":[{"anime_id":null,"operation":"update"}]}""",
      )
      org.junit.Assert.fail("expected ReconcileParseException")
    } catch (expected: ReconcileParseException) {
      // expected: optStringOrNull's `isNull(key)` branch, not only its `!has(key)` branch.
    }
  }

  /** Maps one snapshot whose `episodes` value is the given raw JSON, returning the legacy `episodes`. */
  private fun legacyEpisodesFor(episodesJson: String): Any {
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","changed_fields":["episodes"],"timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"episodes":$episodesJson}}]}""",
    ).bridgeChanges.single()

    return org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!).get("episodes")
  }

  @Test
  fun rebuildsEpisodeEntriesWithCanonicalKeysAndDropsExtraKeys() {
    val episodes = legacyEpisodesFor("""[{"long":true,"extra":1,"minutes":45.0,"episode":7}]""")

    assertEquals("""[{"episode":7,"minutes":45,"long":true}]""", episodes.toString())
  }

  @Test
  fun mapsEveryMalformedEpisodesShapeToNullInsteadOfFailingTheSnapshot() {
    val malformed = listOf(
      "null",
      "\"not-an-array\"",
      "[1]",
      """[{"episode":"1","minutes":24,"long":false}]""",
      """[{"episode":1.5,"minutes":24,"long":false}]""",
      """[{"episode":0,"minutes":24,"long":false}]""",
      """[{"episode":1,"minutes":"24","long":false}]""",
      """[{"episode":1,"minutes":-1,"long":false}]""",
      """[{"episode":1,"minutes":24,"long":"yes"}]""",
    )

    for (raw in malformed) {
      assertEquals("episodes=$raw", org.json.JSONObject.NULL, legacyEpisodesFor(raw))
    }
  }

  @Test
  fun mapsAnAbsentEpisodesKeyToNull() {
    val change = ReconcileResponseParser.parse(
      """{"status":"accepted","bridge_changes":[{"record_id":"a-1","change_type":"update","timestamp":1,"snapshot":{"id":"a-1","name":"A","status":1,"episodesWatched":0,"active":1,"firstCycle":0}}]}""",
    ).bridgeChanges.single()

    val legacy = org.json.JSONObject(WireAnimeMapper.normalize(change).snapshotJson!!)

    assertEquals(org.json.JSONObject.NULL, legacy.get("episodes"))
  }
}
