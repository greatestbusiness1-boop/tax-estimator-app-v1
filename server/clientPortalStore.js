"use strict";

const fs = require("fs");
const path = require("path");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function createClientPortalStore(options = {}) {
  const supabaseAdmin = options.supabaseAdmin || null;
  const tableName = String(
    options.tableName || "client_portal_accounts"
  ).trim();
  const localFile = String(
    options.localFile ||
    path.join(process.cwd(), "client-portal-accounts.local.json")
  );
  const allowLocalFallback =
    options.allowLocalFallback === true;

  const mode = supabaseAdmin
    ? "supabase-service-role"
    : allowLocalFallback
      ? "local-development"
      : "unavailable";

  function isAvailable() {
    return mode !== "unavailable";
  }

  function isLiveReady() {
    return mode === "supabase-service-role";
  }

  function readLocal() {
    try {
      if (!fs.existsSync(localFile)) {
        return [];
      }

      const text = fs.readFileSync(localFile, "utf8").trim();
      const data = text ? JSON.parse(text) : [];

      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error(
        "[client portal store] Local read failed:",
        error.message || error
      );
      return [];
    }
  }

  function writeLocal(records) {
    const directory = path.dirname(localFile);
    fs.mkdirSync(directory, { recursive: true });

    const temporary = `${localFile}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify(records, null, 2),
      "utf8"
    );
    fs.renameSync(temporary, localFile);
  }

  function mapDatabaseRow(row = {}) {
    return {
      leadId: String(row.lead_id || ""),
      portalId: String(row.portal_id || ""),
      email: normalizeEmail(row.email),
      status: String(row.status || "pending-activation"),
      passwordAlgorithm: String(
        row.password_algorithm || ""
      ),
      passwordIterations: Number(
        row.password_iterations || 0
      ),
      passwordSalt: String(row.password_salt || ""),
      passwordHash: String(row.password_hash || ""),
      sessionVersion: Number(row.session_version || 0),
      activation:
        row.activation &&
        typeof row.activation === "object"
          ? row.activation
          : null,
      activatedAt: String(row.activated_at || ""),
      passwordUpdatedAt: String(
        row.password_updated_at || ""
      ),
      lastLoginAt: String(row.last_login_at || ""),
      lastActivityAt: String(row.last_activity_at || ""),
      setupRequestedAt: String(
        row.setup_requested_at || ""
      ),
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || "")
    };
  }

  function toDatabaseRow(record = {}) {
    return {
      lead_id: String(record.leadId || ""),
      portal_id: String(record.portalId || ""),
      email: normalizeEmail(record.email),
      status: String(record.status || "pending-activation"),
      password_algorithm: String(
        record.passwordAlgorithm || ""
      ),
      password_iterations: Number(
        record.passwordIterations || 0
      ),
      password_salt: String(record.passwordSalt || ""),
      password_hash: String(record.passwordHash || ""),
      session_version: Number(record.sessionVersion || 0),
      activation:
        record.activation &&
        typeof record.activation === "object"
          ? record.activation
          : null,
      activated_at: record.activatedAt || null,
      password_updated_at:
        record.passwordUpdatedAt || null,
      last_login_at: record.lastLoginAt || null,
      last_activity_at: record.lastActivityAt || null,
      setup_requested_at:
        record.setupRequestedAt || null,
      updated_at: new Date().toISOString()
    };
  }

  async function getByLeadId(leadId) {
    const cleanId = String(leadId || "").trim();

    if (!cleanId || !isAvailable()) {
      return null;
    }

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from(tableName)
        .select("*")
        .eq("lead_id", cleanId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data ? mapDatabaseRow(data) : null;
    }

    return readLocal().find(
      (record) =>
        String(record.leadId || "") === cleanId
    ) || null;
  }

  async function getActiveByEmail(email) {
    const normalized = normalizeEmail(email);

    if (!normalized || !isAvailable()) {
      return null;
    }

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from(tableName)
        .select("*")
        .eq("email", normalized)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data ? mapDatabaseRow(data) : null;
    }

    return readLocal()
      .filter(
        (record) =>
          normalizeEmail(record.email) === normalized &&
          String(record.status || "") === "active"
      )
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt || 0) -
          Date.parse(left.updatedAt || 0)
      )[0] || null;
  }

  async function upsert(record = {}) {
    const cleanId = String(record.leadId || "").trim();
    const email = normalizeEmail(record.email);

    if (!cleanId || !email) {
      return {
        ok: false,
        error: "Portal lead ID and email are required."
      };
    }

    if (!isAvailable()) {
      return {
        ok: false,
        error:
          "Secure portal credential storage is not configured."
      };
    }

    const now = new Date().toISOString();
    const next = {
      ...record,
      leadId: cleanId,
      email,
      createdAt: record.createdAt || now,
      updatedAt: now
    };

    if (supabaseAdmin) {
      const row = toDatabaseRow(next);
      row.created_at = next.createdAt;

      const { data, error } = await supabaseAdmin
        .from(tableName)
        .upsert(row, { onConflict: "lead_id" })
        .select("*")
        .single();

      if (error) {
        return {
          ok: false,
          error: error.message || String(error)
        };
      }

      return {
        ok: true,
        source: mode,
        record: mapDatabaseRow(data)
      };
    }

    const records = readLocal();
    const index = records.findIndex(
      (item) =>
        String(item.leadId || "") === cleanId
    );

    if (index >= 0) {
      records[index] = next;
    } else {
      records.push(next);
    }

    writeLocal(records);

    return {
      ok: true,
      source: mode,
      record: next
    };
  }

  async function checkLiveReadiness() {
    const result = {
      mode,
      liveCredentialStorageReady: false,
      tableReady: false,
      errors: []
    };

    if (!supabaseAdmin) {
      result.errors.push(
        "A server-only Supabase secret key is not configured."
      );

      return result;
    }

    try {
      const {
        error
      } = await supabaseAdmin
        .from(tableName)
        .select(
          "lead_id",
          {
            head: true,
            count: "exact"
          }
        )
        .limit(1);

      if (error) {
        throw error;
      }

      result.tableReady = true;
      result.liveCredentialStorageReady = true;
    } catch (error) {
      result.errors.push(
        `Portal credential table: ${
          error.message ||
          String(error)
        }`
      );
    }

    return result;
  }

  return {
    mode,
    localFile,
    isAvailable,
    isLiveReady,
    checkLiveReadiness,
    getByLeadId,
    getActiveByEmail,
    upsert
  };
}

module.exports = {
  createClientPortalStore
};
