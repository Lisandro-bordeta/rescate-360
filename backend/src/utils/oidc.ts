import jwt from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * Validación de ID Tokens OIDC emitidos por Mi Argentina (AUTENTICAR).
 *
 * Se obtiene la clave pública desde el endpoint JWKS del proveedor de identidad
 * y se cachea en memoria por `JWKS_CACHE_TTL_MS` para no golpear el IdP en cada login.
 * En producción, detrás de este módulo puede agregarse rotación de claves del IdP
 * sin reiniciar el servicio (el cache expira y se refetcha).
 */

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

interface JwkRsa {
  kid: string;
  kty: 'RSA';
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

interface JwksCacheEntry {
  keys: Map<string, string>; // kid -> PEM público
  fetchedAt: number;
}

let jwksCache: JwksCacheEntry | null = null;

/** Convierte un JWK RSA a PEM PKCS#8 para usar con jsonwebtoken. */
const jwkToPem = (jwk: JwkRsa): string => {
  const b64ToBuf = (b64: string): Buffer =>
    Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  const modulusBuf = b64ToBuf(jwk.n);
  const exponentBuf = b64ToBuf(jwk.e);

  // DER INTEGER: si el bit más significativo está encendido, requiere 0x00 inicial.
  const asDerInteger = (buf: Buffer): Buffer =>
    (buf[0] & 0x80) !== 0 ? Buffer.concat([Buffer.from([0x00]), buf]) : buf;

  const modulus = asDerInteger(modulusBuf);
  const exponent = asDerInteger(exponentBuf);

  // RFC 3279: Secuencia DER de SubjectPublicKeyInfo para RSA.
  const rsaPublicKeyDer = Buffer.concat([
    Buffer.from('30', 'hex'),
    derLength(2 + modulus.length + 2 + exponent.length),
    Buffer.from('02', 'hex'),
    derLength(modulus.length),
    modulus,
    Buffer.from('02', 'hex'),
    derLength(exponent.length),
    exponent,
  ]);

  const algorithmOid = Buffer.from('06092a864886f70d0101010500', 'hex'); // OID rsaEncryption
  const algorithmSeq = Buffer.concat([
    Buffer.from('30', 'hex'),
    derLength(algorithmOid.length),
    algorithmOid,
  ]);
  const bitString = Buffer.concat([
    Buffer.from('03', 'hex'),
    derLength(rsaPublicKeyDer.length + 1),
    Buffer.from('00', 'hex'),
    rsaPublicKeyDer,
  ]);
  const spki = Buffer.concat([
    Buffer.from('30', 'hex'),
    derLength(algorithmSeq.length + bitString.length),
    algorithmSeq,
    bitString,
  ]);

  return `-----BEGIN PUBLIC KEY-----\n${spki.toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END PUBLIC KEY-----`;
};

const derLength = (len: number): Buffer => {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
};

const fetchJwksKeys = async (force = false): Promise<Map<string, string>> => {
  if (!force && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  const res = await fetch(env.MI_ARGENTINA_JWKS_URI, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`JWKS no disponible (HTTP ${res.status}) desde ${env.MI_ARGENTINA_JWKS_URI}`);
  }

  const body = (await res.json()) as { keys?: JwkRsa[] };
  const keys = new Map<string, string>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty === 'RSA') keys.set(jwk.kid, jwkToPem(jwk));
  }
  if (keys.size === 0) throw new Error('El documento JWKS no contiene claves RSA válidas.');

  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
};

export interface MiArgentinaClaims {
  sub: string;
  /** Atributos de identidad básica; el claim exacto depende del alcance (scope) otorgado. */
  dni?: string;
  nombre?: string;
  apellido?: string;
  email?: string;
  phone_number?: string;
  [key: string]: unknown;
}

/**
 * Verifica la firma, issuer y audience de un ID Token de Mi Argentina.
 * Lanza una excepción con mensaje claro ante cualquier falla de validación.
 */
export const verifyIdToken = async (idToken: string): Promise<MiArgentinaClaims> => {
  const header = jwt.decode(idToken, { complete: true })?.header;
  if (!header?.kid) throw new Error('ID Token inválido: falta cabecera kid.');

  const verifyWithKey = async (retry: boolean): Promise<MiArgentinaClaims> => {
    const keys = await fetchJwksKeys(retry);
    const pem = keys.get(header.kid as string);
    if (!pem) {
      if (!retry) {
        // El kid puede corresponder a una clave rotada: forzamos un refetch una vez.
        return verifyWithKey(true);
      }
      throw new Error(`ID Token inválido: kid "${header.kid}" no presente en JWKS.`);
    }
    return jwt.verify(idToken, pem, {
      issuer: env.MI_ARGENTINA_ISSUER,
      audience: env.MI_ARGENTINA_CLIENT_ID,
      algorithms: ['RS256', 'RS384', 'RS512'],
      clockTolerance: 30, // tolerancia de 30s a desfases de reloj
    }) as MiArgentinaClaims;
  };

  try {
    return await verifyWithKey(false);
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      throw new Error(`ID Token inválido: ${err.message}`);
    }
    throw err;
  }
};
