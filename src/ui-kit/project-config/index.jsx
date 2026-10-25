import React, { useState, useEffect } from 'react';
import ForgeReconciler, { Button, Text, Stack, Textfield, Checkbox, Form } from '@forge/react';
import { invoke } from '@forge/bridge';
import { useProductContext } from '@forge/react';

const ProjectConfig = () => {
  const context = useProductContext();
  const projectKey = (context && context.extension && context.extension.project && context.extension.project.key) || '';
  const [cfg, setCfg] = useState({ enabled: true, retirementDays: 0, captureConsoleLogs: false, consoleLogsDefaultChecked: false });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectKey) return;
    invoke('getProjectConfig', { projectKey }).then((res) => {
      if (res && res.ok) setCfg(res.data);
    }).catch(() => {});
  }, [projectKey]);

  const save = async () => {
    if (!projectKey) return;
    setLoading(true);
    try {
      const res = await invoke('setProjectConfig', { projectKey, settings: cfg });
      if (res && res.ok) setCfg(res.data);
    } catch (e) {
      // ignore
    }
    setLoading(false);
  };

  return (
    <Form onSubmit={save}>
      <Stack space="space.200">
        <Text>Project configuration{projectKey ? `: ${projectKey}` : ''}</Text>
        <Checkbox label="Enabled" isChecked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: !!(e && e.target ? e.target.checked : e) })} />
        <Textfield label="Retirement Days (0 = never)" type="number" value={String(cfg.retirementDays || 0)} onChange={(e) => setCfg({ ...cfg, retirementDays: Number((e && e.target ? e.target.value : e) || 0) })} />
        <Checkbox label="Capture console logs" isChecked={cfg.captureConsoleLogs} onChange={(e) => setCfg({ ...cfg, captureConsoleLogs: !!(e && e.target ? e.target.checked : e) })} />
        <Checkbox label="Console logs default checked" isChecked={cfg.consoleLogsDefaultChecked} onChange={(e) => setCfg({ ...cfg, consoleLogsDefaultChecked: !!(e && e.target ? e.target.checked : e) })} />
        <Button onClick={save} isDisabled={loading || !projectKey}>Save</Button>
      </Stack>
    </Form>
  );
};

ForgeReconciler.render(<ProjectConfig />);
