import React, { useState, useEffect } from 'react';
import ForgeReconciler, { Button, Text, Stack, Checkbox, Form } from '@forge/react';
import { invoke } from '@forge/bridge';
import { useProductContext } from '@forge/react';

/**
 * Project settings (D38, D42).
 *
 * The text-field catalogue is installation-wide and lives on the Admin page
 * (D42), not here: a canvas creator picks from the global list. This page only
 * holds the project's default status filter and console-capture defaults.
 */
const ProjectConfig = () => {
  const context = useProductContext();
  const projectKey = (context && context.extension && context.extension.project && context.extension.project.key) || '';
  const [cfg, setCfg] = useState({ enabled: true, filteredStatusIds: null, captureConsoleLogs: false, consoleLogsDefaultChecked: false });
  const [statuses, setStatuses] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!projectKey) return;
    invoke('getProjectConfig', { projectKey }).then((res) => {
      if (res && res.ok) {
        setCfg(res.data);
        setError(null);
      } else {
        setError((res && res.error && res.error.message) || 'You do not have permission to view project settings.');
      }
    }).catch(() => {
      setError('Unable to load project settings.');
    });
    invoke('getProjectStatuses', { projectKey }).then((res) => {
      if (res && res.ok) setStatuses(res.data.statuses);
    }).catch(() => {
      // Status list stays null; the default rule still applies.
    });
  }, [projectKey]);

  const save = async () => {
    if (!projectKey) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const res = await invoke('setProjectConfig', { projectKey, settings: cfg });
      if (res && res.ok) {
        setCfg(res.data);
        setSaved(true);
      } else {
        setError((res && res.error && res.error.message) || 'Unable to save project settings.');
      }
    } catch (e) {
      setError(e && e.message ? e.message : 'Unable to save project settings.');
    }
    setLoading(false);
  };

  const useDefault = !Array.isArray(cfg.filteredStatusIds);
  const toggleStatus = (id, checked) => {
    const current = Array.isArray(cfg.filteredStatusIds) ? cfg.filteredStatusIds : [];
    const next = checked
      ? [...current, id]
      : current.filter((existing) => existing !== id);
    setCfg({ ...cfg, filteredStatusIds: next });
    setSaved(false);
  };

  return (
    <Form onSubmit={save}>
      <Stack space="space.200">
        <Text>Project configuration{projectKey ? `: ${projectKey}` : ''}</Text>
        {error && <Text>{error}</Text>}
        <Checkbox label="Enabled" isChecked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: !!(e && e.target ? e.target.checked : e) })} />
        <Text>Default filter setting</Text>
        <Text>The starting point for everyone viewing this project's canvases. Each reviewer can tick a different set of statuses on the canvas itself; nothing here locks them.</Text>
        <Checkbox
          label="Use default (hide Done statuses)"
          isChecked={useDefault}
          onChange={(e) => setCfg({ ...cfg, filteredStatusIds: (e && e.target ? e.target.checked : e) ? null : [] })}
        />
        {!useDefault && (
          <Text>Hidden by default:</Text>
        )}
        {!useDefault && statuses && statuses.map((status) => (
          <Checkbox
            key={status.id}
            label={`${status.name}${status.statusCategory ? ` (${status.statusCategory.name})` : ''}`}
            isChecked={cfg.filteredStatusIds.includes(status.id)}
            onChange={(e) => toggleStatus(status.id, !!(e && e.target ? e.target.checked : e))}
          />
        ))}
        {!useDefault && !statuses && <Text>Statuses could not be loaded; nothing extra will be hidden.</Text>}
        <Text>
          Pre-filled fields are configured per canvas, from the installation-wide catalogue on the
          Admin page.
        </Text>
        <Checkbox label="Capture console logs" isChecked={cfg.captureConsoleLogs} onChange={(e) => setCfg({ ...cfg, captureConsoleLogs: !!(e && e.target ? e.target.checked : e) })} />
        <Checkbox label="Console logs default checked" isChecked={cfg.consoleLogsDefaultChecked} onChange={(e) => setCfg({ ...cfg, consoleLogsDefaultChecked: !!(e && e.target ? e.target.checked : e) })} />
        {saved && <Text>Saved.</Text>}
        <Button onClick={save} isDisabled={loading || !projectKey}>Save</Button>
      </Stack>
    </Form>
  );
};

ForgeReconciler.render(<ProjectConfig />);
