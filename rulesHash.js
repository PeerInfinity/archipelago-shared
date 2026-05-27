/**
 * rulesHash — stable content hash of the loaded rules data, used to
 * key per-rules-file caches (e.g. saved queues in
 * frontend/modules/loops/savedQueueStore.js) without relying on a
 * filename or seed ID. The rules might be loaded from a URL, from a
 * file picker, or assembled in-app, so we can't assume any external
 * identifier is available.
 *
 * Hash algorithm: FNV-1a 32-bit over JSON.stringify(rulesData). Not
 * cryptographic — collisions are theoretically possible but vanishingly
 * unlikely for the localStorage-keying use case here. Returned as an
 * 8-character lowercase hex string (e.g. "1a2b3c4d").
 *
 * Object-identity cache: hashing the rules every call is wasteful
 * (rulesData is typically large). We memoize by reference. The
 * stateManager loads rules as a fresh object each time, so reference
 * equality reliably distinguishes loads.
 */

let _cachedData = null;
let _cachedHash = null;

/**
 * Compute (or return cached) hash for the given rules-data object.
 *
 * @param {object|null} rulesData
 * @returns {string|null} 8-char hex hash, or null when rulesData is nullish.
 */
export function hashRulesData(rulesData) {
    if (rulesData == null) return null;
    if (rulesData === _cachedData) return _cachedHash;
    const json = JSON.stringify(rulesData);
    _cachedHash = fnv1a32Hex(json);
    _cachedData = rulesData;
    return _cachedHash;
}

/**
 * Drop the cache. Callers that subscribe to
 * stateManager:rawJsonDataLoaded can also rely on object-identity
 * invalidation in hashRulesData — this helper exists for explicit
 * cleanup (tests, module teardown).
 */
export function clearRulesHashCache() {
    _cachedData = null;
    _cachedHash = null;
}

function fnv1a32Hex(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        // 32-bit FNV-1a prime multiplication via shifts (avoids the
        // Math.imul reliance and stays inside u32 with the >>> 0 at the
        // end of each round).
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
