/**
 * CSV export for a Swiss Cheese answer.
 *
 * Exports the payload the server computed, not anything re-derived in the
 * browser, so a downloaded file always matches what was on screen.
 */
import { downloadText } from './conversationImportExport';

/** Wraps a cell for CSV, escaping quotes and preserving leading characters. */
function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Serializes a payload as CSV: the trail first so the file is self-describing,
 * then the breakdown table.
 */
export function payloadToCsv(payload) {
    if (!payload) return '';

    const lines = [];
    lines.push(['swiss cheese answer', payload.intent, payload.kind].map(csvCell).join(','));

    (payload.headline || []).forEach(stat => {
        lines.push([stat.label, stat.value].map(csvCell).join(','));
    });

    if (payload.trail) {
        lines.push(['template', payload.trail.template].map(csvCell).join(','));
        lines.push(['rows', payload.trail.rowCount].map(csvCell).join(','));
        Object.entries(payload.trail.filters || {}).forEach(([key, value]) => {
            lines.push([key, value].map(csvCell).join(','));
        });
    }

    const table = payload.table;
    if (table?.columns?.length) {
        lines.push('');
        lines.push(table.columns.map(csvCell).join(','));
        (table.rows || []).forEach(row => {
            lines.push(row.map(csvCell).join(','));
        });
    }

    return lines.join('\n');
}

/** Triggers a download of the answer's breakdown. */
export function downloadPayloadCsv(payload) {
    const csv = payloadToCsv(payload);
    if (!csv) return { ok: false, error: 'Nothing to export' };

    const date = new Date().toISOString().slice(0, 10);
    downloadText(`swiss-cheese-${payload.intent}-${date}.csv`, csv, 'text/csv;charset=utf-8');
    return { ok: true };
}
