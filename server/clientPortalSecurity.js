"use strict";

const crypto = require("crypto");

const PASSWORD_ITERATIONS = 210000;
const PASSWORD_BYTES = 32;
const PASSWORD_DIGEST = "sha512";

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ""), "base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.isBuffer(left)
    ? left
    : Buffer.from(String(left || ""));
  const rightBuffer = Buffer.isBuffer(right)
    ? right
    : Buffer.from(String(right || ""));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeSecret(secret) {
  const value = String(secret || "").trim();

  if (value.length >= 32) {
    return value;
  }

  return crypto
    .createHash("sha256")
    .update(value || "tax-savings-planner-local-session")
    .digest("hex");
}

function createClientPortalSecurity(options = {}) {
  const secret = normalizeSecret(options.secret);
  const cookieName = String(
    options.cookieName || "tsp_client_portal_session"
  ).trim();

  function passwordPolicy(password) {
    const value = String(password || "");
    const errors = [];

    if (value.length < 10) {
      errors.push("Use at least 10 characters.");
    }

    if (!/[A-Za-z]/.test(value)) {
      errors.push("Include at least one letter.");
    }

    if (!/\d/.test(value)) {
      errors.push("Include at least one number.");
    }

    if (value.length > 200) {
      errors.push("The password is too long.");
    }

    return {
      ok: errors.length === 0,
      errors
    };
  }

  function hashPassword(password, saltValue) {
    const salt = saltValue
      ? fromBase64Url(saltValue)
      : crypto.randomBytes(16);

    const hash = crypto.pbkdf2Sync(
      String(password || ""),
      salt,
      PASSWORD_ITERATIONS,
      PASSWORD_BYTES,
      PASSWORD_DIGEST
    );

    return {
      algorithm: `pbkdf2-${PASSWORD_DIGEST}`,
      iterations: PASSWORD_ITERATIONS,
      salt: toBase64Url(salt),
      hash: toBase64Url(hash)
    };
  }

  function verifyPassword(password, record = {}) {
    try {
      const salt = fromBase64Url(record.salt);
      const expected = fromBase64Url(record.hash);
      const iterations = Number(
        record.iterations || PASSWORD_ITERATIONS
      );

      if (!salt.length || !expected.length) {
        return false;
      }

      const actual = crypto.pbkdf2Sync(
        String(password || ""),
        salt,
        iterations,
        expected.length,
        PASSWORD_DIGEST
      );

      return safeEqual(actual, expected);
    } catch (error) {
      return false;
    }
  }

  function generateActivationCode() {
    return String(
      crypto.randomInt(0, 1000000)
    ).padStart(6, "0");
  }

  function hashActivationCode(code, saltValue) {
    const salt = saltValue
      ? fromBase64Url(saltValue)
      : crypto.randomBytes(16);

    const hash = crypto
      .createHmac("sha256", secret)
      .update(salt)
      .update(String(code || "").trim())
      .digest();

    return {
      salt: toBase64Url(salt),
      hash: toBase64Url(hash)
    };
  }

  function verifyActivationCode(code, record = {}) {
    try {
      const expected = fromBase64Url(record.hash);
      const actualRecord = hashActivationCode(
        code,
        record.salt
      );
      const actual = fromBase64Url(actualRecord.hash);

      return safeEqual(actual, expected);
    } catch (error) {
      return false;
    }
  }

  function createSessionToken(payload = {}) {
    const encoded = toBase64Url(
      JSON.stringify(payload)
    );

    const signature = crypto
      .createHmac("sha256", secret)
      .update(encoded)
      .digest("base64url");

    return `${encoded}.${signature}`;
  }

  function verifySessionToken(token) {
    const parts = String(token || "").split(".");

    if (parts.length !== 2) {
      return null;
    }

    const [encoded, signature] = parts;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(encoded)
      .digest("base64url");

    if (!safeEqual(signature, expected)) {
      return null;
    }

    try {
      const payload = JSON.parse(
        fromBase64Url(encoded).toString("utf8")
      );

      if (
        !payload ||
        typeof payload !== "object" ||
        Number(payload.expiresAt || 0) <= Date.now()
      ) {
        return null;
      }

      return payload;
    } catch (error) {
      return null;
    }
  }

  function parseCookies(headerValue) {
    return String(headerValue || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .reduce((cookies, part) => {
        const separator = part.indexOf("=");

        if (separator <= 0) {
          return cookies;
        }

        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();

        try {
          cookies[name] = decodeURIComponent(value);
        } catch (error) {
          cookies[name] = value;
        }

        return cookies;
      }, {});
  }

  function getSessionTokenFromRequest(req) {
    const cookies = parseCookies(
      req?.headers?.cookie || ""
    );

    return cookies[cookieName] || "";
  }

  function buildSessionCookie(token, options = {}) {
    const maxAgeSeconds = Math.max(
      0,
      Math.round(Number(options.maxAgeSeconds || 0))
    );

    const pieces = [
      `${cookieName}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax"
    ];

    if (maxAgeSeconds > 0) {
      pieces.push(`Max-Age=${maxAgeSeconds}`);
    }

    if (options.secure) {
      pieces.push("Secure");
    }

    return pieces.join("; ");
  }

  function buildClearCookie(options = {}) {
    const pieces = [
      `${cookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0"
    ];

    if (options.secure) {
      pieces.push("Secure");
    }

    return pieces.join("; ");
  }

  return {
    cookieName,
    passwordPolicy,
    hashPassword,
    verifyPassword,
    generateActivationCode,
    hashActivationCode,
    verifyActivationCode,
    createSessionToken,
    verifySessionToken,
    getSessionTokenFromRequest,
    buildSessionCookie,
    buildClearCookie
  };
}

module.exports = {
  createClientPortalSecurity
};
