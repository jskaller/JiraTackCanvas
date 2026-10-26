import React, { useState } from 'react';
import { recoverPins } from '../api';

export default function RecoveryPanel({ onRecovered }) {
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run(dryRun) {
    setBusy(true);
    setError(null);
    if (!dryRun) setResult(null);
    try {
      const response = await recoverPins(dryRun);
      if (response && response.ok && response.data) {
        if (dryRun) {
          setScan(response.data);
        } else {
          setResult(response.data);
          if (onRecovered) onRecovered();
        }
      } else {
        setError((response && response.error && response.error.message) || 'Recovery failed.');
      }
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    }
    setBusy(false);
  }

  return (
    <section className="jt-section">
      <h2>Maintenance</h2>
      <div className="jt-recovery">
        <p className="jt-recovery-copy">
          Tickets created before the JiraTack fields were added to your project&apos;s screens still contain the
          pin data in their description. Scan and recover it here.
        </p>
        <div className="jt-recovery-actions">
          <button type="button" className="jt-button" disabled={busy} onClick={() => run(true)}>
            {busy ? 'Scanning…' : 'Scan for lost pin fields'}
          </button>
          {scan && scan.recovered > 0 && (
            <button type="button" className="jt-button jt-button-primary" disabled={busy} onClick={() => run(false)}>
              {`Recover ${scan.recovered} tickets`}
            </button>
          )}
        </div>

        {scan && (
          <div className="jt-recovery-result">
            Scanned: {scan.scanned ?? '—'} · Already populated: {scan.alreadyPopulated ?? 0} · Would
            recover: {scan.recovered} · Skipped: {scan.skipped}
            {scan.truncated ? ' · Only the first 500 recoverable tickets were processed' : ''}
          </div>
        )}

        {scan && scan.candidates === 0 && (
          <div className="jt-recovery-result">
            No JiraTack tickets with an empty canvas field were found. If you have only generated
            bookmarklets, create a ticket with the bookmarklet first — tokens alone do not create canvases.
          </div>
        )}

        {result && (
          <div className="jt-recovery-result">
            Recovered: {result.recovered} · Skipped: {result.skipped}
            {result.errors && result.errors.length > 0 ? ` · Errors: ${result.errors.length}` : ''}
          </div>
        )}

        {result && result.errors && result.errors.slice(0, 8).map((message, index) => (
          <div key={index} className="jt-recovery-error">{message}</div>
        ))}

        {error && <div className="jt-banner jt-banner-error">{error}</div>}
      </div>
    </section>
  );
}
