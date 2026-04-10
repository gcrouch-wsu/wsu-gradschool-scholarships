import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDatabasePoolOptions } from "@/lib/db";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("database pool options", () => {
  it("keeps strict TLS by default", () => {
    const options = buildDatabasePoolOptions(
      "postgresql://user:pass@example.com:5432/app?sslmode=require"
    );

    expect(options.connectionString).toBe(
      "postgresql://user:pass@example.com:5432/app?sslmode=require"
    );
    expect(options.ssl).toBeUndefined();
  });

  it("uses an explicit CA certificate when provided", () => {
    vi.stubEnv("DATABASE_CA_CERT", "-----BEGIN CERTIFICATE-----\\nLINE\\n-----END CERTIFICATE-----");

    const options = buildDatabasePoolOptions(
      "postgresql://user:pass@example.com:5432/app?sslmode=require"
    );

    expect(options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\nLINE\n-----END CERTIFICATE-----",
    });
  });

  it("strips sslmode=no-verify when the insecure flag is off", () => {
    const options = buildDatabasePoolOptions(
      "postgresql://user:pass@example.com:5432/app?sslmode=no-verify"
    );

    expect(options.connectionString).toBe("postgresql://user:pass@example.com:5432/app");
    expect(options.ssl).toBeUndefined();
  });

  it("forces sslmode=no-verify only when the insecure flag is enabled", () => {
    vi.stubEnv("SCHOLARSHIP_DATABASE_INSECURE_SSL", "true");

    const options = buildDatabasePoolOptions(
      "postgresql://user:pass@example.com:5432/app?sslmode=verify-full"
    );

    expect(options.connectionString).toBe(
      "postgresql://user:pass@example.com:5432/app?sslmode=no-verify"
    );
    expect(options.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("treats false-like insecure flag values as disabled", () => {
    vi.stubEnv("SCHOLARSHIP_DATABASE_INSECURE_SSL", "false");

    const options = buildDatabasePoolOptions(
      "postgresql://user:pass@example.com:5432/app?sslmode=no-verify"
    );

    expect(options.connectionString).toBe("postgresql://user:pass@example.com:5432/app");
    expect(options.ssl).toBeUndefined();
  });
});
