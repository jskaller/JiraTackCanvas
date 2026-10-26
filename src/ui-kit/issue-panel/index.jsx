import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text,
  Stack,
  Button,
  Textfield,
  Link,
  SectionMessage,
  useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const IssuePanel = () => {
  const context = useProductContext();
  const issueKey = context && context.extension && context.extension.issue
    ? context.extension.issue.key
    : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!issueKey) {
      setLoading(false);
      return undefined;
    }
    let mounted = true;
    (async () => {
      try {
        const res = await invoke('issuePanelData', { issueKey });
        if (!mounted) return;
        if (res && res.ok && res.data) {
          setData(res.data);
        } else {
          setError((res && res.error && res.error.message) || 'Failed to load issue data.');
        }
      } catch (e) {
        if (mounted) setError(e && e.message ? e.message : String(e));
      }
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [issueKey]);

  const copyLink = async () => {
    if (!data || !data.deepLink) return;
    try {
      await navigator.clipboard.writeText(data.deepLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setCopied(false);
    }
  };

  if (loading) return <Text>Loading…</Text>;

  if (error) {
    return (
      <SectionMessage appearance="error" title="JiraTack">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  if (!data || data.isJiraTack === false) {
    return <Text>Not a JiraTack ticket</Text>;
  }

  return (
    <Stack space="space.100">
      <Text>Canvas: {data.canvasName}</Text>
      {data.url ? (
        <Link href={data.url} openNewTab>
          {data.url}
        </Link>
      ) : (
        <Text>Page URL unavailable</Text>
      )}
      <Button onClick={copyLink}>{copied ? 'Copied' : 'Copy link to this pin'}</Button>
      {data.deepLink && <Textfield label="Deep link" value={data.deepLink} isReadOnly />}

      <Text>Related tickets</Text>
      {data.relatedTickets && data.relatedTickets.length > 0 ? (
        data.relatedTickets.map((ticket) => (
          <Text key={ticket.key}>
            {ticket.key} — {ticket.summary} ({ticket.status.name})
          </Text>
        ))
      ) : (
        <Text>No related tickets on this page.</Text>
      )}
    </Stack>
  );
};

ForgeReconciler.render(<IssuePanel />);
