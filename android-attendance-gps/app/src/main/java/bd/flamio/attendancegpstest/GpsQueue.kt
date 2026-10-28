package bd.flamio.attendancegpstest

/**
 * Persistent FIFO queue of GPS readings waiting for server confirmation.
 *
 * Pure Kotlin (no Android types) so it can be unit-tested on the JVM.
 * - Ordered by capture time; a reading is identified by its capture time, so the
 *   same fix can never be queued twice.
 * - A reading is removed only after the server confirms it (any 2xx reply).
 *   A crash after the server accepted but before removal just resends it; the
 *   server answers "out_of_order_reading"/"no_transition" and nothing is duplicated.
 * - Nothing is silently discarded: readings the server refuses for good, or that
 *   exhaust their retries, move to a bounded "held" list that stays visible.
 * Coordinates are kept only until the server confirms the reading.
 */
data class QueuedFix(
    val capturedAt: Long,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0L,
    val heldReason: String? = null,
)

interface QueueStore {
    fun read(key: String): String?
    fun write(key: String, value: String)
}

/** Outcome of one send attempt, decided by the caller from the HTTP reply. */
sealed class SendOutcome {
    object Confirmed : SendOutcome()
    /** Network down or server 5xx: keep, back off, retry. */
    data class Transient(val reason: String) : SendOutcome()
    /** Session expired / refresh refused: keep everything, pause until sign-in. */
    data class AuthRequired(val reason: String) : SendOutcome()
    /** Server will never accept this reading (e.g. stale, invalid): hold it visibly. */
    data class Rejected(val reason: String) : SendOutcome()
    /** Account is not allowed to record (e.g. staff_only): pause, keep everything. */
    data class Forbidden(val reason: String) : SendOutcome()
}

data class FlushResult(val sent: Int, val held: Int, val stoppedBy: String?)

class GpsQueue(private val store: QueueStore, private val clock: () -> Long = System::currentTimeMillis) {
    companion object {
        const val MAX_PENDING = 500
        const val MAX_HELD = 200
        const val MAX_ATTEMPTS = 8
        const val BASE_BACKOFF_MS = 5_000L
        const val MAX_BACKOFF_MS = 5 * 60_000L
        private const val PENDING_KEY = "gps_queue_pending"
        private const val HELD_KEY = "gps_queue_held"
    }

    fun pending(): List<QueuedFix> = decode(store.read(PENDING_KEY))
    fun held(): List<QueuedFix> = decode(store.read(HELD_KEY))

    /** Returns false when the reading is a duplicate or the queue is full (caller must log it). */
    fun enqueue(fix: QueuedFix): Boolean {
        val list = pending().toMutableList()
        if (list.any { it.capturedAt == fix.capturedAt }) return false
        if (list.size >= MAX_PENDING) return false
        list.add(fix.copy(attempts = 0, nextAttemptAt = 0L, heldReason = null))
        list.sortBy { it.capturedAt }
        save(PENDING_KEY, list)
        return true
    }

    /**
     * Sends due readings oldest-first. Stops at the first transient/auth/forbidden
     * failure so a later reading never overtakes an earlier one.
     */
    fun flush(send: (QueuedFix) -> SendOutcome): FlushResult {
        var sent = 0
        var held = 0
        while (true) {
            val list = pending()
            val head = list.firstOrNull() ?: return FlushResult(sent, held, null)
            val now = clock()
            if (head.nextAttemptAt > now) return FlushResult(sent, held, "backoff")
            when (val outcome = send(head)) {
                is SendOutcome.Confirmed -> { save(PENDING_KEY, list.drop(1)); sent++ }
                is SendOutcome.Rejected -> { hold(head, outcome.reason); save(PENDING_KEY, list.drop(1)); held++ }
                is SendOutcome.AuthRequired -> return FlushResult(sent, held, "auth:" + outcome.reason)
                is SendOutcome.Forbidden -> return FlushResult(sent, held, "forbidden:" + outcome.reason)
                is SendOutcome.Transient -> {
                    val attempts = head.attempts + 1
                    if (attempts >= MAX_ATTEMPTS) {
                        hold(head.copy(attempts = attempts), "retries_exhausted:" + outcome.reason)
                        save(PENDING_KEY, list.drop(1))
                        held++
                        continue
                    }
                    val backoff = minOf(MAX_BACKOFF_MS, BASE_BACKOFF_MS shl (attempts - 1))
                    save(PENDING_KEY, listOf(head.copy(attempts = attempts, nextAttemptAt = now + backoff)) + list.drop(1))
                    return FlushResult(sent, held, "transient:" + outcome.reason)
                }
            }
        }
    }

    /** Connectivity returned: retry immediately instead of waiting for backoff. */
    fun resetBackoff() {
        val list = pending()
        if (list.isNotEmpty()) save(PENDING_KEY, list.map { it.copy(nextAttemptAt = 0L) })
    }

    private fun hold(fix: QueuedFix, reason: String) {
        // Keep the reason and time; drop coordinates since they will never be sent again.
        val list = (held() + fix.copy(latitude = 0.0, longitude = 0.0, heldReason = reason)).takeLast(MAX_HELD)
        save(HELD_KEY, list)
    }

    private fun save(key: String, list: List<QueuedFix>) = store.write(key, encode(list))

    private fun encode(list: List<QueuedFix>) = list.joinToString("\n") {
        listOf(it.capturedAt, it.latitude, it.longitude, it.accuracy, it.attempts, it.nextAttemptAt, (it.heldReason ?: "").replace("|", "/").replace("\n", " ")).joinToString("|")
    }

    private fun decode(raw: String?): List<QueuedFix> {
        if (raw.isNullOrBlank()) return emptyList()
        return raw.split("\n").mapNotNull { line ->
            val p = line.split("|")
            if (p.size < 7) return@mapNotNull null
            try {
                QueuedFix(p[0].toLong(), p[1].toDouble(), p[2].toDouble(), p[3].toFloat(), p[4].toInt(), p[5].toLong(), p[6].ifBlank { null })
            } catch (_: NumberFormatException) { null }
        }
    }
}

/** Maps an HTTP status + server error code to a queue outcome. */
fun classifyGpsReply(status: Int, error: String): SendOutcome = when {
    status in 200..299 -> SendOutcome.Confirmed
    status == 401 -> SendOutcome.AuthRequired(error.ifBlank { "unauthorized" })
    status == 403 -> SendOutcome.Forbidden(error.ifBlank { "forbidden" })
    status == 400 && error in setOf("stale_gps_reading", "invalid_gps_reading") -> SendOutcome.Rejected(error)
    status == 408 || status == 429 || status >= 500 -> SendOutcome.Transient("http_$status:" + error)
    status == 400 -> SendOutcome.Transient("http_400:" + error)
    else -> SendOutcome.Rejected("http_$status:" + error)
}
