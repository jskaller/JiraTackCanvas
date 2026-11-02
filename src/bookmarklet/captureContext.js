/**
 * What the element and the environment looked like at capture time (plan 5.1).
 *
 * The point is reproducibility: a reviewer should be able to see which element
 * was pinned and on what viewport, without guessing from a screenshot. Every
 * value is capped — the record lands in a Jira entity property with a value
 * ceiling, so an unbounded `outerHTML` would fail the write.
 */
const MAX_HTML = 2000;
const MAX_STYLES = 1000;
const MAX_UA = 512;

const STYLE_KEYS = [
  'display', 'position', 'font-size', 'font-weight', 'color',
  'background-color', 'overflow', 'z-index', 'width', 'height',
];

function browserName(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown';
}

function osName(ua) {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

function styleSummary(element) {
  try {
    const computed = window.getComputedStyle(element);
    return STYLE_KEYS
      .map((key) => `${key}: ${computed.getPropertyValue(key)}`)
      .join('; ')
      .slice(0, MAX_STYLES);
  } catch (e) {
    return null;
  }
}

export function collectCaptureContext(element) {
  const ua = String(navigator.userAgent || '');
  const context = {
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    environment: {
      browser: browserName(ua),
      os: osName(ua),
      userAgent: ua.slice(0, MAX_UA),
    },
  };

  if (element && element.tagName) {
    context.element = {
      tag: String(element.tagName).toLowerCase().slice(0, 32),
      htmlSnippet: String(element.outerHTML || '').slice(0, MAX_HTML),
      styles: styleSummary(element),
    };
  }

  return context;
}
