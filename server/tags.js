const { R } = require("redbean-node");

/**
 * Manages monitor-tag associations with an in-memory cache.
 *
 * All reads and writes to monitor_tag go through this class so the cache
 * stays consistent automatically. Callers never need to invalidate manually.
 *
 * SQLite uses a single DB connection (pool max: 1). Without caching,
 * N individual getTags() queries during monitor startup serialize behind
 * heartbeat DB operations and exhaust the connection pool.
 */
class Tags {
    /** @type {Map<number, Array>} */
    static _cache = new Map();

    /**
     * Load all monitor-tag mappings into the cache in a single query.
     * Call once at startup before monitors start.
     * @returns {Promise<void>}
     */
    static async loadAll() {
        const rows = await R.getAll(
            "SELECT mt.*, tag.name, tag.color FROM monitor_tag mt JOIN tag ON mt.tag_id = tag.id ORDER BY tag.name"
        );
        Tags._cache.clear();
        for (const row of rows) {
            if (!Tags._cache.has(row.monitor_id)) {
                Tags._cache.set(row.monitor_id, []);
            }
            Tags._cache.get(row.monitor_id).push(row);
        }
    }

    /**
     * Get tags for a monitor from the cache.
     * @param {number} monitorId Monitor ID
     * @returns {Array} List of tags (empty array if none)
     */
    static getMonitorTags(monitorId) {
        return Tags._cache.get(monitorId) || [];
    }

    /**
     * Add a tag to a monitor.
     * @param {number} tagId Tag ID
     * @param {number} monitorId Monitor ID
     * @param {string} value Tag value
     * @returns {Promise<void>}
     */
    static async addMonitorTag(tagId, monitorId, value) {
        await R.exec("INSERT INTO monitor_tag (tag_id, monitor_id, value) VALUES (?, ?, ?)", [
            tagId,
            monitorId,
            value,
        ]);
        await Tags._refreshMonitor(monitorId);
    }

    /**
     * Edit a monitor tag value.
     * @param {number} tagId Tag ID
     * @param {number} monitorId Monitor ID
     * @param {string} value New tag value
     * @returns {Promise<void>}
     */
    static async editMonitorTag(tagId, monitorId, value) {
        await R.exec("UPDATE monitor_tag SET value = ? WHERE tag_id = ? AND monitor_id = ?", [
            value,
            tagId,
            monitorId,
        ]);
        await Tags._refreshMonitor(monitorId);
    }

    /**
     * Delete a tag from a monitor.
     * @param {number} tagId Tag ID
     * @param {number} monitorId Monitor ID
     * @param {string} value Tag value
     * @returns {Promise<void>}
     */
    static async deleteMonitorTag(tagId, monitorId, value) {
        await R.exec("DELETE FROM monitor_tag WHERE tag_id = ? AND monitor_id = ? AND value = ?", [
            tagId,
            monitorId,
            value,
        ]);
        await Tags._refreshMonitor(monitorId);
    }

    /**
     * Reload the entire cache after a tag entity is edited or deleted.
     * Tag name/color changes affect Prometheus labels for all monitors using that tag.
     * @returns {Promise<void>}
     */
    static async reload() {
        await Tags.loadAll();
    }

    /**
     * Refresh the cache for a single monitor.
     * @param {number} monitorId Monitor ID
     * @returns {Promise<void>}
     */
    static async _refreshMonitor(monitorId) {
        const rows = await R.getAll(
            "SELECT mt.*, tag.name, tag.color FROM monitor_tag mt JOIN tag ON mt.tag_id = tag.id WHERE mt.monitor_id = ? ORDER BY tag.name",
            [monitorId]
        );
        Tags._cache.set(monitorId, rows);
    }
}

module.exports = {
    Tags,
};
