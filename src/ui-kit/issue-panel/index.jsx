import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text,
  Stack,
  Button,
  Textfield,
  Link,
  Image,
  SectionMessage,
  useProductContext,
} from '@forge/react';
import { invoke, router } from '@forge/bridge';
import { toSafeHttpUrl } from '../../shared/safeUrl';

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

  const safePageUrl = toSafeHttpUrl(data.url);

  return (
    <Stack space="space.100">
      <Text>Canvas: {data.canvasName}</Text>

      {data.guest && (
        <Text>
          Guest: {data.guest.name} ({data.guest.email})
        </Text>
      )}

      {safePageUrl ? (
        <Link href={safePageUrl} openNewTab>
          {safePageUrl}
        </Link>
      ) : (
        <Text>Page URL unavailable</Text>
      )}

      {data.pin && (
        <Stack space="space.050">
          <Text>Pin position: {data.pin.position}</Text>
          <Text>Selector: {data.pin.selector || 'none'}</Text>
        </Stack>
      )}

      {data.screenshot && data.screenshot.dataUrl && (
        <Stack space="space.050">
          <Text>Screenshot</Text>
          <Image src={data.screenshot.dataUrl} alt={data.screenshot.filename || 'JiraTack screenshot'} />
        </Stack>
      )}

      {safePageUrl && (
        <Stack space="space.050">
          <Button onClick={() => router.open(safePageUrl)}>Open page to view pins</Button>
          <Text>Once the page opens, click your JiraTack bookmarklet to view this canvas.</Text>
        </Stack>
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
