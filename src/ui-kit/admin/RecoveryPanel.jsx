import React, { useState } from 'react';
import { invoke } from '@forge/bridge';
import { Button, Stack, Text, SectionMessage } from '@forge/react';

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
      const res = await invoke('recoverPinsFromDescriptions', { dryRun });
      if (res && res.ok && res.data) {
        if (dryRun) {
          setScan(res.data);
        } else {
          setResult(res.data);
          if (onRecovered) onRecovered();
        }
      } else {
        setError((res && res.error && res.error.message) || 'Recovery failed.');
      }
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    }
    setBusy(false);
  }

  return (
    <Stack space="space.100">
      <Text>Recover lost pin fields</Text>
      <Text>
        Scans tickets whose description contains a JiraTack pin marker but whose JiraTack fields are empty, then
        repopulates the fields from the marker.
      </Text>
      <Button onClick={() => run(true)} isDisabled={busy}>
        {busy ? 'Scanning…' : 'Scan for lost pin fields'}
      </Button>

      {scan && (
        <Stack space="space.050">
          <Text>Would recover: {scan.recovered}</Text>
          <Text>Skipped (malformed/missing marker): {scan.skipped}</Text>
          {scan.truncated && <Text>Only the first 500 tickets were scanned.</Text>}
          <Button onClick={() => run(false)} isDisabled={busy || scan.recovered === 0}>
            {`Recover ${scan.recovered} tickets`}
          </Button>
        </Stack>
      )}

      {result && (
        <Stack space="space.050">
          <Text>Recovered: {result.recovered}</Text>
          <Text>Skipped: {result.skipped}</Text>
          {result.truncated && <Text>Only the first 500 tickets were processed.</Text>}
          {result.errors && result.errors.length > 0 && (
            <Stack space="space.050">
              <Text>Errors ({result.errors.length}):</Text>
              {result.errors.slice(0, 8).map((message, index) => (
                <Text key={index}>{message}</Text>
              ))}
            </Stack>
          )}
        </Stack>
      )}

      {error && (
        <SectionMessage appearance="error" title="Recovery error">
          <Text>{error}</Text>
        </SectionMessage>
      )}
    </Stack>
  );
}
