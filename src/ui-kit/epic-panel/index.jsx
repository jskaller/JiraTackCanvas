import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text,
  Stack,
  Button,
  Textfield,
  SectionMessage,
  useProductContext,
} from '@forge/react';
import { invoke, router } from '@forge/bridge';

function buildBookmarklet(data) {
  const canvasName = data.canvasName || data.canvasId || 'Canvas';
  const canvasId = data.canvasId || canvasName;
  const config = {
    token: data.token,
    apiUrl: data.apiUrl,
    sdkUrl: data.sdkUrl,
    canvasId,
    canvasName,
    sdkVersion: data.sdkVersion,
  };
  const code = `(function(){var c=${JSON.stringify(config)};if(window.__jiratackActiveCanvas===c.canvasId){window.__jiratackClose();return;}var s=document.createElement('script');s.src=c.sdkUrl+'?v='+c.sdkVersion;s.onload=function(){window.__jiratackInit(c);};document.head.appendChild(s);})();`;
  return `javascript:${code}`;
}

function buildJqlUrl(jiraBaseUrl, canvasFieldId, canvasName) {
  if (!jiraBaseUrl || !canvasFieldId) return null;
  const jql = `"${canvasFieldId}" = "${canvasName}"`;
  return `${String(jiraBaseUrl).replace(/\/$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

const EpicPanel = () => {
  const context = useProductContext();
  const epicKey = context && context.extension && context.extension.issue
    ? context.extension.issue.key
    : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [canvases, setCanvases] = useState([]);
  const [jiraBaseUrl, setJiraBaseUrl] = useState(null);
  const [canvasFieldId, setCanvasFieldId] = useState(null);
  const [bookmarklet, setBookmarklet] = useState(null);
  const [generating, setGenerating] = useState(null);

  useEffect(() => {
    if (!epicKey) {
      setLoading(false);
      return undefined;
    }
    let mounted = true;
    (async () => {
      try {
        const res = await invoke('epicPanelData', { epicKey });
        if (!mounted) return;
        if (res && res.ok && res.data) {
          setCanvases(res.data.canvases || []);
          setJiraBaseUrl(res.data.jiraBaseUrl || null);
          setCanvasFieldId(res.data.canvasFieldId || null);
        } else {
          setError((res && res.error && res.error.message) || 'Failed to load canvases.');
        }
      } catch (e) {
        if (mounted) setError(e && e.message ? e.message : String(e));
      }
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [epicKey]);

  const generateBookmarklet = async (canvasName) => {
    setGenerating(canvasName);
    setError(null);
    try {
      const res = await invoke('generateCanvasToken', { canvasName, scope: 'create' });
      if (res && res.ok && res.data) {
        setBookmarklet({ canvasName, url: buildBookmarklet(res.data) });
      } else {
        setError((res && res.error && res.error.message) || 'Failed to generate bookmarklet.');
      }
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    }
    setGenerating(null);
  };

  const openCanvas = (canvasName) => {
    const url = buildJqlUrl(jiraBaseUrl, canvasFieldId, canvasName);
    if (url) router.open(url);
  };

  if (loading) return <Text>Loading…</Text>;

  if (error && canvases.length === 0) {
    return (
      <SectionMessage appearance="error" title="JiraTack">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  if (canvases.length === 0) {
    return <Text>No JiraTack tickets in this epic yet.</Text>;
  }

  return (
    <Stack space="space.200">
      <Text>JiraTack Canvases referenced by this epic</Text>
      {error && <Text>{error}</Text>}
      {canvases.map((canvas) => (
        <Stack key={canvas.canvasName} space="space.100">
          <Text>{canvas.canvasName}</Text>
          <Text>
            {canvas.epicTicketCount} of {canvas.totalTicketCount} tickets · {canvas.urlCount} URLs
          </Text>
          <Button
            onClick={() => generateBookmarklet(canvas.canvasName)}
            isDisabled={generating === canvas.canvasName}
          >
            {generating === canvas.canvasName ? 'Generating…' : 'Get write bookmarklet'}
          </Button>
          <Button onClick={() => openCanvas(canvas.canvasName)}>Open canvas</Button>
          {bookmarklet && bookmarklet.canvasName === canvas.canvasName && (
            <Textfield label="Bookmarklet URL" value={bookmarklet.url} isReadOnly />
          )}
        </Stack>
      ))}
    </Stack>
  );
};

ForgeReconciler.render(<EpicPanel />);
