package expo.modules.syncengine

import java.util.Collections
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The per-attempt request id sequence: `<cycleId>:<n>`, n 1-based and consecutive, every value
 * inside the bridge's accepted shape.
 */
class RequestIdSequenceTest {

  @Test
  fun `yields the cycle id with a 1-based consecutive sequence number`() {
    val sequence = RequestIdSequence("0f8b4c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f")

    assertEquals(
      listOf(
        "0f8b4c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f:1",
        "0f8b4c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f:2",
        "0f8b4c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f:3",
      ),
      List(3) { sequence.next() },
    )
  }

  @Test
  fun `every value for a UUID cycle id matches the bridge's accepted shape`() {
    val sequence = RequestIdSequence(UUID.randomUUID().toString())

    repeat(50) {
      val value = sequence.next()
      assertTrue("'$value' must match the bridge contract", BRIDGE_PATTERN.matches(value))
    }
  }

  @Test
  fun `concurrent callers never receive the same sequence number`() {
    val sequence = RequestIdSequence("cycle-concurrent")
    val pool = Executors.newFixedThreadPool(4)
    val start = CountDownLatch(1)
    val values = Collections.synchronizedList(mutableListOf<String>())
    try {
      repeat(200) {
        pool.execute {
          start.await()
          values += sequence.next()
        }
      }
      start.countDown()
    } finally {
      pool.shutdown()
      assertTrue(pool.awaitTermination(5, TimeUnit.SECONDS))
    }

    assertEquals((1..200).map { "cycle-concurrent:$it" }.toSet(), values.toSet())
    assertEquals(200, values.size)
  }

  private companion object {
    val BRIDGE_PATTERN = Regex("^[A-Za-z0-9._-]{1,48}:[0-9]{1,9}$")
  }
}
