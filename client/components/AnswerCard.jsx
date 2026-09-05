/**
 * Renders a grounded Swiss Cheese answer: headline figures, the breakdown table, and
 * the trail showing how it was produced.
 *
 * Everything here comes from the server payload, never from the model's prose,
 * so the table still appears when the phrasing call fails.
 */
import { useState } from 'react';
import { FaFileCsv, FaCheck } from 'react-icons/fa';
import { downloadPayloadCsv } from '../utils/answerExport';

const KIND_LABEL = {
    answer: 'Grounded answer',
    empty: 'No rows in this window',
    clarify: 'Needs a choice',
    refuse: 'Not answerable from this schema'
};

export function AnswerCard({ payload }) {
    const [exported, setExported] = useState(false);

    if (!payload) return null;

    const { headline = [], table, trail, alternatives = [], notes = [] } = payload;
    const hasTable = Boolean(table?.columns?.length && table?.rows?.length);

    const handleExport = () => {
        const result = downloadPayloadCsv(payload);
        if (result.ok) {
            setExported(true);
            setTimeout(() => setExported(false), 2000);
        }
    };

    return (
        <div className={`answer-card answer-card-${payload.kind}`}>
            <div className="answer-card-head">
                <span className="answer-card-kind">{KIND_LABEL[payload.kind] || payload.kind}</span>
                {hasTable && (
                    <button className="answer-card-export" onClick={handleExport} title="Download breakdown as CSV">
                        {exported ? <FaCheck /> : <FaFileCsv />}
                        <span>{exported ? 'Saved' : 'CSV'}</span>
                    </button>
                )}
            </div>

            {headline.length > 0 && (
                <div className="answer-card-stats">
                    {headline.map(stat => (
                        <div className="answer-stat" key={`${stat.label}-${stat.value}`}>
                            <div className="answer-stat-value">{stat.value}</div>
                            <div className="answer-stat-label">{stat.label}</div>
                        </div>
                    ))}
                </div>
            )}

            {hasTable && (
                <div className="answer-table-wrap">
                    <table className="answer-table">
                        <thead>
                            <tr>
                                {table.columns.map((column, index) => (
                                    <th
                                        key={column}
                                        className={table.numericColumns?.includes(index) ? 'numeric' : undefined}
                                    >
                                        {column}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {table.rows.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                    {row.map((cell, cellIndex) => (
                                        <td
                                            key={cellIndex}
                                            className={table.numericColumns?.includes(cellIndex) ? 'numeric' : undefined}
                                        >
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {alternatives.length > 0 && (
                <div className="answer-card-alternatives">
                    <span className="answer-card-subhead">
                        {payload.kind === 'clarify' ? 'Did you mean' : 'You can ask instead'}
                    </span>
                    <ul>
                        {alternatives.map(item => <li key={item}>{item}</li>)}
                    </ul>
                </div>
            )}

            {notes.length > 0 && (
                <ul className="answer-card-notes">
                    {notes.map(note => <li key={note}>{note}</li>)}
                </ul>
            )}

            {trail && (
                <details className="answer-trail">
                    <summary>How this was produced</summary>
                    <div className="answer-trail-body">
                        <div><strong>template</strong> {trail.template}</div>
                        <div><strong>rows</strong> {trail.rowCount}</div>
                        {Object.entries(trail.filters || {}).map(([key, value]) => (
                            <div key={key}><strong>{key}</strong> {value}</div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}
