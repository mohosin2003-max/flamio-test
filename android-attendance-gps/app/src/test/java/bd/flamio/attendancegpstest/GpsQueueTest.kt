package bd.flamio.attendancegpstest

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MemStore : QueueStore {
    val map = HashMap<String, String>()
    override fun read(key: String) = map[key]
    override fun write(key: String, value: String) { map[key] = value }
}

class GpsQueueTest {
    private fun fix(t: Long) = QueuedFix(t, 23.81, 90.41, 10f)

    @Test fun offlineReadingsPersistAndSendInOrderOnReconnect() {
        val store = MemStore(); var now = 1_000L
        val q = GpsQueue(store) { now }
        q.enqueue(fix(30)); q.enqueue(fix(10)); q.enqueue(fix(20))
        val r1 = q.flush { SendOutcome.Transient("network") }
        assertEquals("transient:network", r1.stoppedBy)
        assertEquals(3, q.pending().size)
        q.resetBackoff()
        val sent = mutableListOf<Long>()
        q.flush { sent += it.capturedAt; SendOutcome.Confirmed }
        assertEquals(listOf(10L, 20L, 30L), sent)
        assertEquals(0, q.pending().size)
    }

    @Test fun serviceRestartKeepsQueue() {
        val store = MemStore()
        GpsQueue(store).enqueue(fix(5))
        val restarted = GpsQueue(store)
        assertEquals(listOf(5L), restarted.pending().map { it.capturedAt })
    }

    @Test fun duplicateReadingNotQueuedTwice() {
        val q = GpsQueue(MemStore())
        assertTrue(q.enqueue(fix(7)))
        assertFalse(q.enqueue(fix(7)))
        assertEquals(1, q.pending().size)
    }

    @Test fun removedOnlyAfterConfirmation() {
        val q = GpsQueue(MemStore()) { 0L }
        q.enqueue(fix(1))
        q.flush { SendOutcome.AuthRequired("session_expired") }
        assertEquals(1, q.pending().size)
        q.flush { SendOutcome.Confirmed }
        assertEquals(0, q.pending().size)
    }

    @Test fun backoffBlocksUntilDueAndRetriesAreBounded() {
        var now = 0L
        val q = GpsQueue(MemStore()) { now }
        q.enqueue(fix(1))
        var calls = 0
        q.flush { calls++; SendOutcome.Transient("500") }
        assertEquals("backoff", q.flush { calls++; SendOutcome.Confirmed }.stoppedBy)
        assertEquals(1, calls)
        repeat(GpsQueue.MAX_ATTEMPTS) { now += GpsQueue.MAX_BACKOFF_MS; q.flush { SendOutcome.Transient("500") } }
        assertEquals(0, q.pending().size)
        assertEquals(1, q.held().size)
        assertTrue(q.held()[0].heldReason!!.startsWith("retries_exhausted"))
    }

    @Test fun rejectedReadingIsHeldNotLostAndDoesNotBlockLaterOnes() {
        val q = GpsQueue(MemStore()) { 0L }
        q.enqueue(fix(1)); q.enqueue(fix(2))
        q.flush { if (it.capturedAt == 1L) SendOutcome.Rejected("stale_gps_reading") else SendOutcome.Confirmed }
        assertEquals(0, q.pending().size)
        assertEquals("stale_gps_reading", q.held().single().heldReason)
        assertEquals(0.0, q.held().single().latitude, 0.0) // coordinates dropped once held
    }

    @Test fun authFailureKeepsLaterReadingsBehindEarlierOnes() {
        val q = GpsQueue(MemStore()) { 0L }
        q.enqueue(fix(1)); q.enqueue(fix(2))
        val seen = mutableListOf<Long>()
        q.flush { seen += it.capturedAt; SendOutcome.AuthRequired("x") }
        assertEquals(listOf(1L), seen)
        assertEquals(2, q.pending().size)
    }

    @Test fun queueLimitRefusesNewReadingWithoutDroppingOld() {
        val q = GpsQueue(MemStore())
        for (i in 1..GpsQueue.MAX_PENDING) q.enqueue(fix(i.toLong()))
        assertFalse(q.enqueue(fix(99_999)))
        assertEquals(GpsQueue.MAX_PENDING, q.pending().size)
        assertEquals(1L, q.pending().first().capturedAt)
    }

    @Test fun heldOverflowIsCountedWhenBoundedHistoryTrimsOldItems() {
        val q = GpsQueue(MemStore()) { 0L }
        for (i in 1..(GpsQueue.MAX_HELD + 1)) {
            q.enqueue(fix(i.toLong()))
            q.flush { SendOutcome.Rejected("permanent_$i") }
        }
        assertEquals(GpsQueue.MAX_HELD, q.held().size)
        assertEquals(1L, q.heldOverflowCount())
    }

    @Test fun replyClassification() {
        assertTrue(classifyGpsReply(200, "") is SendOutcome.Confirmed)
        assertTrue(classifyGpsReply(401, "invalid_session") is SendOutcome.AuthRequired)
        assertTrue(classifyGpsReply(403, "staff_only") is SendOutcome.Forbidden)
        assertTrue(classifyGpsReply(400, "stale_gps_reading") is SendOutcome.Rejected)
        assertTrue(classifyGpsReply(400, "no_matching_attendance_session") is SendOutcome.Rejected)
        assertTrue(classifyGpsReply(500, "event_save_failed") is SendOutcome.Transient)
        assertTrue(classifyGpsReply(429, "") is SendOutcome.Transient)
        assertTrue(classifyGpsTransitionResponse(true, "geofence_exit") is SendOutcome.Confirmed)
        assertTrue(classifyGpsTransitionResponse(false, "no_transition") is SendOutcome.Confirmed)
        assertTrue(classifyGpsTransitionResponse(false, "out_of_order_reading") is SendOutcome.Confirmed)
        assertTrue(classifyGpsTransitionResponse(false, "geofence_disabled") is SendOutcome.Rejected)
        assertTrue(classifyGpsTransitionResponse(false, "no_active_shift") is SendOutcome.Rejected)
    }
}
