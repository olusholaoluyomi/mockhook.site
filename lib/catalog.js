// The field types the schema builder offers. The server only runs generators
// listed here, so nothing a user types can call arbitrary code.

export const LOCALES = {
  en: 'English (generic)',
  en_NG: 'English (Nigeria)',
  en_GH: 'English (Ghana)',
  en_ZA: 'English (South Africa)',
  en_GB: 'English (UK)',
  en_US: 'English (US)',
  en_IN: 'English (India)',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt_BR: 'Portuguese (Brazil)',
};

// opts: [name, kind, default, label]
const n = (name, def, label) => ({ name, kind: 'number', default: def, label: label || name });
const s = (name, def, label) => ({ name, kind: 'text', default: def, label: label || name });

export const TYPES = [
  // ---- Structure ----
  { key: 'object', label: 'Object (group of fields)', group: 'Structure', container: true },
  { key: 'array', label: 'List of items', group: 'Structure', container: true,
    opts: [n('min', 1, 'Min items'), n('max', 3, 'Max items')] },

  // ---- Basics ----
  { key: 'seq', label: 'Sequential ID (1, 2, 3…)', group: 'Basics', opts: [n('start', 1, 'Start at')] },
  { key: 'uuid', label: 'UUID', group: 'Basics', fk: 'string.uuid' },
  { key: 'number', label: 'Number', group: 'Basics', opts: [n('min', 0), n('max', 1000), n('decimals', 0)] },
  { key: 'boolean', label: 'True / false', group: 'Basics', opts: [n('chanceTrue', 50, 'Chance of true (%)')] },
  { key: 'pick', label: 'One of (pick from list)', group: 'Basics', opts: [s('values', 'pending, paid, failed', 'Values, comma separated')] },
  { key: 'fixed', label: 'Fixed value', group: 'Basics', opts: [s('value', '', 'Value (JSON or text)')] },
  { key: 'pattern', label: 'Pattern (e.g. ORD-####)', group: 'Basics', opts: [s('pattern', 'ORD-####-??', '# = digit, ? = letter, * = either')] },
  { key: 'date', label: 'Date / time', group: 'Basics',
    opts: [s('from', '2024-01-01', 'From'), s('to', '2026-12-31', 'To'), s('format', 'iso', 'iso | date | unix | unixms')] },
  { key: 'null', label: 'null', group: 'Basics' },

  // ---- From the incoming request ----
  { key: 'request', label: 'Value from the request', group: 'From request',
    opts: [s('path', 'query.userId', 'Path, e.g. query.x, body.user.id, headers.x-api-key, method, path'), s('fallback', '', 'Fallback if missing')] },

  // ---- Person ----
  { key: 'person.fullName', label: 'Full name', group: 'Person' },
  { key: 'person.firstName', label: 'First name', group: 'Person' },
  { key: 'person.lastName', label: 'Last name', group: 'Person' },
  { key: 'person.sex', label: 'Sex', group: 'Person' },
  { key: 'person.jobTitle', label: 'Job title', group: 'Person' },
  { key: 'person.bio', label: 'Short bio', group: 'Person' },
  { key: 'age', label: 'Age', group: 'Person', opts: [n('min', 18), n('max', 70)] },
  { key: 'image.avatar', label: 'Avatar URL', group: 'Person' },

  // ---- Contact / internet ----
  { key: 'internet.email', label: 'Email', group: 'Internet' },
  { key: 'internet.username', label: 'Username', group: 'Internet' },
  { key: 'phone.number', label: 'Phone number', group: 'Internet' },
  { key: 'internet.url', label: 'URL', group: 'Internet' },
  { key: 'internet.domainName', label: 'Domain', group: 'Internet' },
  { key: 'internet.ipv4', label: 'IPv4 address', group: 'Internet' },
  { key: 'internet.userAgent', label: 'User agent', group: 'Internet' },
  { key: 'internet.password', label: 'Password', group: 'Internet' },
  { key: 'string.alphanumeric', label: 'Random token', group: 'Internet', opts: [n('length', 24)] },

  // ---- Location ----
  { key: 'location.streetAddress', label: 'Street address', group: 'Location' },
  { key: 'location.city', label: 'City', group: 'Location' },
  { key: 'location.state', label: 'State', group: 'Location' },
  { key: 'location.country', label: 'Country', group: 'Location' },
  { key: 'location.countryCode', label: 'Country code', group: 'Location' },
  { key: 'location.zipCode', label: 'Postcode / ZIP', group: 'Location' },
  { key: 'location.latitude', label: 'Latitude', group: 'Location' },
  { key: 'location.longitude', label: 'Longitude', group: 'Location' },

  // ---- Business / money ----
  { key: 'company.name', label: 'Company name', group: 'Business' },
  { key: 'company.catchPhrase', label: 'Catch phrase', group: 'Business' },
  { key: 'commerce.productName', label: 'Product name', group: 'Business' },
  { key: 'commerce.department', label: 'Department / category', group: 'Business' },
  { key: 'commerce.productDescription', label: 'Product description', group: 'Business' },
  { key: 'commerce.isbn', label: 'ISBN', group: 'Business' },
  { key: 'amount', label: 'Money amount', group: 'Business', opts: [n('min', 100), n('max', 50000), n('decimals', 2)] },
  { key: 'finance.currencyCode', label: 'Currency code', group: 'Business' },
  { key: 'finance.accountNumber', label: 'Account number', group: 'Business' },
  { key: 'finance.accountName', label: 'Account type name', group: 'Business' },
  { key: 'finance.transactionType', label: 'Transaction type', group: 'Business' },
  { key: 'finance.creditCardNumber', label: 'Card number (fake)', group: 'Business' },

  // ---- Text ----
  { key: 'lorem.word', label: 'Word', group: 'Text' },
  { key: 'lorem.words', label: 'Few words', group: 'Text' },
  { key: 'lorem.sentence', label: 'Sentence', group: 'Text' },
  { key: 'lorem.paragraph', label: 'Paragraph', group: 'Text' },
  { key: 'lorem.slug', label: 'Slug', group: 'Text' },
  { key: 'hacker.phrase', label: 'Tech phrase', group: 'Text' },

  // ---- Misc ----
  { key: 'image.url', label: 'Image URL', group: 'Misc' },
  { key: 'color.human', label: 'Colour name', group: 'Misc' },
  { key: 'color.rgb', label: 'Colour hex', group: 'Misc' },
  { key: 'vehicle.vehicle', label: 'Vehicle', group: 'Misc' },
  { key: 'animal.type', label: 'Animal', group: 'Misc' },
  { key: 'food.dish', label: 'Food dish', group: 'Misc' },
  { key: 'system.fileName', label: 'File name', group: 'Misc' },
  { key: 'system.mimeType', label: 'MIME type', group: 'Misc' },
];

export const TYPE_MAP = Object.fromEntries(TYPES.map((t) => [t.key, t]));
