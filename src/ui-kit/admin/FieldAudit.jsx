import React, { useState } from 'react';
import { invoke } from '@forge/bridge';
import { Button, Stack, Text, SectionMessage } from '@forge/react';

export default function FieldAudit({ onUpdated }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await invoke('autoUpdateFieldMappings');
      if (res && res.ok) {
        setResult(res.data || { updatedScreens: [], warnings: [] });
        if (onUpdated) onUpdated();
      } else {
        setError((res && res.error && res.error.message) || 'Failed to update field mappings.');
      }
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    }
    setLoading(false);
  };

  const updatedScreens = (result && result.updatedScreens) || [];
  const warnings = (result && result.warnings) || [];

  return (
    <Stack space="space.100">
      <Text>Field mapping audit</Text>
      <Text>Adds the four JiraTack fields to the default screen(s) automatically.</Text>
      <Button onClick={run} isDisabled={loading}>
        {loading ? 'Updating…' : 'Auto Update Field Mappings'}
      </Button>
      {error && (
        <SectionMessage appearance="error" title="Field mapping error">
          <Text>{error}</Text>
        </SectionMessage>
      )}
      {result && updatedScreens.length === 0 && warnings.length === 0 && (
        <Text>All default screens already include the JiraTack fields.</Text>
      )}
      {updatedScreens.map((screen) => (
        <Text key={screen.id}>
          {screen.name}: added {screen.added.join(', ')}
        </Text>
      ))}
      {warnings.map((warning, index) => (
        <Text key={index}>{warning}</Text>
      ))}
    </Stack>
  );
}
