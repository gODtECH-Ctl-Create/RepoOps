import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";

import {
  GITHUB_APP_DEFAULT_API_BASE_URL,
  GitHubAppConfigError,
  parseGitHubAppConfig
} from "../src/control-plane/github-app/config.mjs";
import {
  GITHUB_APP_JWT_ISSUED_AT_SKEW_SECONDS,
  GITHUB_APP_JWT_LIFETIME_SECONDS,
  GitHubAppJwtError,
  createGitHubAppJwt
} from "../src/control-plane/github-app/jwt.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });

function decodePart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

test("GitHub App secret config parses RSA identity without retaining raw PEM text", () => {
  const config = parseGitHubAppConfig({
    REPOOPS_GITHUB_APP_CLIENT_ID: "Iv1.repoops-client",
    REPOOPS_GITHUB_APP_PRIVATE_KEY: privatePem
  });

  assert.equal(config.clientId, "Iv1.repoops-client");
  assert.equal(config.apiBaseUrl, GITHUB_APP_DEFAULT_API_BASE_URL);
  assert.equal(config.privateKey.type, "private");
  assert.equal(config.privateKey.asymmetricKeyType, "rsa");
  assert.equal(JSON.stringify(config).includes("BEGIN PRIVATE KEY"), false);
  assert.equal(Object.isFrozen(config), true);
});

test("GitHub App config supports an explicit HTTPS API root and local HTTP test endpoint", () => {
  const httpsConfig = parseGitHubAppConfig({
    REPOOPS_GITHUB_APP_CLIENT_ID: "client-1",
    REPOOPS_GITHUB_APP_PRIVATE_KEY: privatePem,
    REPOOPS_GITHUB_API_BASE_URL: "https://github.example.com/api/v3/"
  });
  assert.equal(httpsConfig.apiBaseUrl, "https://github.example.com/api/v3");

  const localConfig = parseGitHubAppConfig({
    REPOOPS_GITHUB_APP_CLIENT_ID: "client-1",
    REPOOPS_GITHUB_APP_PRIVATE_KEY: privatePem,
    REPOOPS_GITHUB_API_BASE_URL: "http://127.0.0.1:3001/"
  });
  assert.equal(localConfig.apiBaseUrl, "http://127.0.0.1:3001");
});

test("GitHub App config fails closed without echoing private-key or URL credentials", () => {
  const secretKey = "-----BEGIN PRIVATE KEY----- super-secret-material -----END PRIVATE KEY-----";
  const secretUrl = "https://user:super-secret@example.com/api/v3";

  for (const env of [
    {},
    { REPOOPS_GITHUB_APP_CLIENT_ID: "bad id", REPOOPS_GITHUB_APP_PRIVATE_KEY: privatePem },
    { REPOOPS_GITHUB_APP_CLIENT_ID: "client-1", REPOOPS_GITHUB_APP_PRIVATE_KEY: secretKey },
    {
      REPOOPS_GITHUB_APP_CLIENT_ID: "client-1",
      REPOOPS_GITHUB_APP_PRIVATE_KEY: privatePem,
      REPOOPS_GITHUB_API_BASE_URL: secretUrl
    }
  ]) {
    assert.throws(
      () => parseGitHubAppConfig(env),
      (error) => {
        assert.equal(error instanceof GitHubAppConfigError, true);
        assert.equal(error.message.includes("super-secret"), false);
        assert.equal(error.message.includes("PRIVATE KEY"), false);
        return true;
      }
    );
  }
});

test("GitHub App JWT is RS256 signed with deterministic GitHub-safe claims", () => {
  const nowMs = Date.parse("2026-09-29T06:30:00Z");
  const token = createGitHubAppJwt({
    clientId: "Iv1.repoops-client",
    privateKey,
    nowMs
  });

  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  assert.deepEqual(decodePart(encodedHeader), { alg: "RS256", typ: "JWT" });

  const payload = decodePart(encodedPayload);
  const nowSeconds = Math.floor(nowMs / 1000);
  assert.deepEqual(payload, {
    iat: nowSeconds - GITHUB_APP_JWT_ISSUED_AT_SKEW_SECONDS,
    exp: nowSeconds + GITHUB_APP_JWT_LIFETIME_SECONDS,
    iss: "Iv1.repoops-client"
  });
  assert.equal(payload.exp - nowSeconds < 10 * 60, true);

  const signature = Buffer.from(encodedSignature, "base64url");
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
      publicKey,
      signature
    ),
    true
  );
});

test("GitHub App JWT errors never include private-key material", () => {
  const secret = "super-secret-private-key-material";
  assert.throws(
    () => createGitHubAppJwt({ clientId: "client-1", privateKey: secret, nowMs: 0 }),
    (error) => {
      assert.equal(error instanceof GitHubAppJwtError, true);
      assert.equal(error.message.includes(secret), false);
      return true;
    }
  );

  assert.throws(
    () => createGitHubAppJwt({ clientId: "client-1", privateKey, nowMs: -1 }),
    GitHubAppJwtError
  );
});
