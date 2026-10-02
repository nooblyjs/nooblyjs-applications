const tls = require('node:tls');
const { URL } = require('node:url');

/**
 * Trusting a server certificate the system does not already trust.
 *
 * A development NooblyJS Wiki serves HTTPS with a certificate it signed
 * itself (`CN=localhost`, its own issuer), and Node refuses it with
 * `DEPTH_ZERO_SELF_SIGNED_CERT`. Node's own hint — "try --use-system-ca" — is
 * misleading here: that flag adds the OS certificate store as trust ANCHORS,
 * which fixes a certificate issued by an internal CA. It cannot fix a
 * certificate that is its own issuer, because there is no chain to anchor.
 * `DEPTH_ZERO` is Node saying exactly that: the failure is at the leaf.
 *
 * The two documented workarounds both live outside the application:
 * `NODE_EXTRA_CA_CERTS` must be a real environment variable (OpenSSL reads it
 * while Node boots, before dotenv runs), and `WIKI_TLS_INSECURE` means editing
 * a file. Neither is reachable from the setup screen where the error appears,
 * and neither survives into the installed build, whose launcher sets no such
 * variables. So the operator is told to fix it somewhere they are not.
 *
 * This module lets them fix it where they are: on a verification failure the
 * daemon fetches the certificate being offered, shows what it is, and — if the
 * operator accepts it — PINS it.
 *
 * Pinning, not disabling. The accepted certificate is added to the trust list
 * for subsequent connections, so verification stays fully on: the chain must
 * still validate, the hostname must still match, and expiry still applies. It
 * is the same trust decision SSH asks for on a first connection, and it is a
 * strictly smaller grant than `rejectUnauthorized: false`, which accepts any
 * certificate from anyone forever.
 */

/**
 * OpenSSL verification failures that mean "this certificate is not signed by
 * anything I trust" — the only family worth offering to pin.
 *
 * Deliberately excluded: an EXPIRED certificate (pinning it changes nothing,
 * Node still rejects on dates) and a HOSTNAME MISMATCH, which means the
 * certificate belongs to a different server and is the one case where the
 * warning may be telling the truth about an attack.
 */
const UNTRUSTED_ISSUER_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
]);

/** Does this failure mean "untrusted issuer", i.e. is pinning the right offer? */
function isUntrustedIssuerError(error) {
  if (!error) return false;
  const codes = [error.code];
  if (Array.isArray(error.errors)) codes.push(...error.errors.map(e => e && e.code));
  if (error.cause) codes.push(error.cause.code);
  return codes.some(c => UNTRUSTED_ISSUER_CODES.has(c));
}

/** Readable one-liner from a node PeerCertificate subject/issuer object. */
function formatName(name) {
  if (!name || typeof name !== 'object') return '(unknown)';
  const parts = [];
  for (const key of ['CN', 'O', 'OU', 'L', 'ST', 'C']) {
    if (name[key]) parts.push(`${key}=${name[key]}`);
  }
  return parts.join(', ') || '(unknown)';
}

function toPem(der) {
  const b64 = der.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

/**
 * Connect WITHOUT verification purely to read back the certificate the server
 * is offering, so it can be described to the operator and pinned on request.
 *
 * This performs no application request — it opens a TLS socket, reads the
 * certificate and closes. Nothing is sent, so no credential is exposed to a
 * server that has not yet been trusted.
 */
function fetchPeerCertificate(serverUrl, { timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(serverUrl);
    } catch {
      return reject(new Error(`Not a valid URL: ${serverUrl}`));
    }
    if (parsed.protocol !== 'https:') {
      return reject(new Error('Certificate inspection only applies to https:// servers'));
    }

    const socket = tls.connect({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 443,
      servername: parsed.hostname,
      rejectUnauthorized: false,
      timeout,
    }, () => {
      const cert = socket.getPeerCertificate(false);
      socket.end();
      if (!cert || !cert.raw) {
        return reject(new Error('The server did not present a certificate'));
      }
      resolve({
        subject: formatName(cert.subject),
        issuer: formatName(cert.issuer),
        // Subject == issuer is the signature of a genuinely self-signed
        // certificate, and it is the fact that makes --use-system-ca useless.
        selfSigned: formatName(cert.subject) === formatName(cert.issuer),
        fingerprint: cert.fingerprint256 || cert.fingerprint,
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        altNames: cert.subjectaltname || null,
        pem: toPem(cert.raw),
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`Timed out reading the certificate from ${parsed.host}`));
    });
    socket.on('error', (err) => reject(err));
  });
}

/**
 * The CA list for an https.Agent: everything Node already trusts, plus any
 * pinned certificates.
 *
 * Supplying `ca` REPLACES Node's defaults, so the current set has to be read
 * back and re-included — otherwise pinning one development certificate would
 * quietly stop the daemon trusting the public web, and a production server
 * would start failing the moment someone pinned a localhost cert.
 * `getCACertificates('default')` returns what Node is actually using, so it
 * already accounts for `--use-system-ca` and `NODE_EXTRA_CA_CERTS`.
 */
function trustStoreWith(pinnedPems) {
  const pins = (pinnedPems || []).filter(Boolean);
  if (!pins.length) return null; // no pins: leave the agent on Node's defaults

  let base;
  try {
    base = tls.getCACertificates('default');
  } catch {
    base = tls.rootCertificates;
  }
  return [...base, ...pins];
}

module.exports = {
  isUntrustedIssuerError,
  fetchPeerCertificate,
  trustStoreWith,
  UNTRUSTED_ISSUER_CODES,
};
