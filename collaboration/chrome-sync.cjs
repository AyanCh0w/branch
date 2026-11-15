// Match the origin used by the unpacked Chrome extension.
const CHROME_SYNC_ORIGIN = 'http://localhost:4390';
const isChromeSyncOrigin = origin => origin === CHROME_SYNC_ORIGIN;
module.exports = { CHROME_SYNC_ORIGIN, isChromeSyncOrigin };
