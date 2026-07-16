"use strict";

const fs = require("fs");
const path = require("path");

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function cleanSegment(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return cleaned || fallback;
}

function createClientDocumentStore(
  options = {}
) {
  const supabaseAdmin =
    options.supabaseAdmin || null;

  const tableName = String(
    options.tableName ||
    "client_portal_documents"
  ).trim();

  const bucketName = String(
    options.bucketName ||
    "client-portal-documents"
  ).trim();

  const localMetadataFile = String(
    options.localMetadataFile ||
    path.join(
      process.cwd(),
      "client-portal-documents.local.json"
    )
  );

  const localDirectory = String(
    options.localDirectory ||
    path.join(
      process.cwd(),
      "client-portal-documents.local"
    )
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
    return (
      mode ===
      "supabase-service-role"
    );
  }

  function readLocal() {
    try {
      if (
        !fs.existsSync(
          localMetadataFile
        )
      ) {
        return [];
      }

      const text = fs
        .readFileSync(
          localMetadataFile,
          "utf8"
        )
        .trim();

      const records = text
        ? JSON.parse(text)
        : [];

      return Array.isArray(records)
        ? records
        : [];
    } catch (error) {
      console.error(
        "[client document store] Local metadata read failed:",
        error.message || error
      );

      return [];
    }
  }

  function writeLocal(records) {
    const directory = path.dirname(
      localMetadataFile
    );

    fs.mkdirSync(
      directory,
      {
        recursive: true
      }
    );

    const temporary =
      `${localMetadataFile}.tmp`;

    fs.writeFileSync(
      temporary,
      JSON.stringify(
        records,
        null,
        2
      ),
      {
        encoding: "utf8",
        mode: 0o600
      }
    );

    fs.renameSync(
      temporary,
      localMetadataFile
    );

    try {
      fs.chmodSync(
        localMetadataFile,
        0o600
      );
    } catch {
      // Windows may not apply POSIX modes.
    }
  }

  function buildStoragePath(
    record = {}
  ) {
    const portalSegment =
      cleanSegment(
        record.portalId,
        "portal"
      );

    const yearSegment =
      cleanSegment(
        record.taxYear,
        "not-sure"
      );

    const documentSegment =
      cleanSegment(
        record.documentId,
        "document"
      );

    const extension = String(
      record.extension || ""
    )
      .toLowerCase()
      .replace(
        /[^a-z0-9.]/g,
        ""
      )
      .slice(0, 10);

    return [
      portalSegment,
      yearSegment,
      `${documentSegment}${extension}`
    ].join("/");
  }

  function resolveLocalStoragePath(
    storagePath
  ) {
    const root = path.resolve(
      localDirectory
    );

    const relative = String(
      storagePath || ""
    )
      .replace(/\\/g, "/")
      .replace(/^\/+/g, "");

    const absolute = path.resolve(
      root,
      relative
    );

    if (
      absolute !== root &&
      !absolute.startsWith(
        `${root}${path.sep}`
      )
    ) {
      throw new Error(
        "Invalid local document path."
      );
    }

    return absolute;
  }

  function mapDatabaseRow(
    row = {}
  ) {
    return {
      documentId: String(
        row.document_id || ""
      ),
      portalId: String(
        row.portal_id || ""
      ),
      accountLeadId: String(
        row.account_lead_id || ""
      ),
      linkedLeadId: String(
        row.linked_lead_id || ""
      ),
      email: normalizeEmail(
        row.email
      ),
      taxYear: String(
        row.tax_year || ""
      ),
      category: String(
        row.category || ""
      ),
      originalName: String(
        row.original_name || ""
      ),
      storagePath: String(
        row.storage_path || ""
      ),
      contentType: String(
        row.content_type || ""
      ),
      extension: String(
        row.extension || ""
      ),
      sizeBytes: Number(
        row.size_bytes || 0
      ),
      sha256: String(
        row.sha256 || ""
      ),
      note: String(
        row.note || ""
      ),
      reviewStatus: String(
        row.review_status ||
        "awaiting-review"
      ),
      clientVisible:
        row.client_visible !== false,
      officeNote: String(
        row.office_note || ""
      ),
      clientMessage: String(
        row.client_message || ""
      ),
      retentionUntil: String(
        row.retention_until || ""
      ),
      reviewedAt: String(
        row.reviewed_at || ""
      ),
      reviewedBy: String(
        row.reviewed_by || ""
      ),
      statusChangedAt: String(
        row.status_changed_at || ""
      ),
      uploadedAt: String(
        row.uploaded_at || ""
      ),
      updatedAt: String(
        row.updated_at || ""
      ),
      withdrawnAt: String(
        row.withdrawn_at || ""
      )
    };
  }

  function toDatabaseRow(
    record = {}
  ) {
    return {
      document_id: String(
        record.documentId || ""
      ),
      portal_id: String(
        record.portalId || ""
      ),
      account_lead_id: String(
        record.accountLeadId || ""
      ),
      linked_lead_id:
        record.linkedLeadId ||
        null,
      email: normalizeEmail(
        record.email
      ),
      tax_year: String(
        record.taxYear || ""
      ),
      category: String(
        record.category || ""
      ),
      original_name: String(
        record.originalName || ""
      ),
      storage_path: String(
        record.storagePath || ""
      ),
      content_type: String(
        record.contentType || ""
      ),
      extension: String(
        record.extension || ""
      ),
      size_bytes: Number(
        record.sizeBytes || 0
      ),
      sha256: String(
        record.sha256 || ""
      ),
      note:
        record.note ||
        null,
      review_status: String(
        record.reviewStatus ||
        "awaiting-review"
      ),
      client_visible:
        record.clientVisible !== false,
      office_note:
        record.officeNote ||
        null,
      client_message:
        record.clientMessage ||
        null,
      retention_until:
        record.retentionUntil ||
        null,
      reviewed_at:
        record.reviewedAt ||
        null,
      reviewed_by:
        record.reviewedBy ||
        null,
      status_changed_at:
        record.statusChangedAt ||
        null,
      uploaded_at:
        record.uploadedAt ||
        new Date().toISOString(),
      updated_at:
        record.updatedAt ||
        new Date().toISOString(),
      withdrawn_at:
        record.withdrawnAt ||
        null
    };
  }

  async function listForPortal({
    portalId,
    email,
    includeWithdrawn = false
  } = {}) {
    const cleanPortalId = String(
      portalId || ""
    ).trim();

    const cleanEmail =
      normalizeEmail(email);

    if (
      !cleanPortalId ||
      !cleanEmail ||
      !isAvailable()
    ) {
      return [];
    }

    if (supabaseAdmin) {
      let query = supabaseAdmin
        .from(tableName)
        .select("*")
        .eq(
          "portal_id",
          cleanPortalId
        )
        .eq(
          "email",
          cleanEmail
        )
        .eq(
          "client_visible",
          true
        )
        .order(
          "uploaded_at",
          {
            ascending: false
          }
        );

      if (!includeWithdrawn) {
        query = query.neq(
          "review_status",
          "withdrawn"
        );
      }

      const {
        data,
        error
      } = await query;

      if (error) {
        throw error;
      }

      return (
        data || []
      ).map(
        mapDatabaseRow
      );
    }

    return readLocal()
      .filter(
        (record) =>
          String(
            record.portalId || ""
          ) === cleanPortalId &&
          normalizeEmail(
            record.email
          ) === cleanEmail &&
          record.clientVisible !== false &&
          (
            includeWithdrawn ||
            String(
              record.reviewStatus ||
              ""
            ) !== "withdrawn"
          )
      )
      .sort(
        (left, right) =>
          Date.parse(
            right.uploadedAt || 0
          ) -
          Date.parse(
            left.uploadedAt || 0
          )
      );
  }

  async function getForPortal({
    documentId,
    portalId,
    email
  } = {}) {
    const cleanDocumentId = String(
      documentId || ""
    ).trim();

    const cleanPortalId = String(
      portalId || ""
    ).trim();

    const cleanEmail =
      normalizeEmail(email);

    if (
      !cleanDocumentId ||
      !cleanPortalId ||
      !cleanEmail ||
      !isAvailable()
    ) {
      return null;
    }

    if (supabaseAdmin) {
      const {
        data,
        error
      } = await supabaseAdmin
        .from(tableName)
        .select("*")
        .eq(
          "document_id",
          cleanDocumentId
        )
        .eq(
          "portal_id",
          cleanPortalId
        )
        .eq(
          "email",
          cleanEmail
        )
        .eq(
          "client_visible",
          true
        )
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data
        ? mapDatabaseRow(data)
        : null;
    }

    return readLocal().find(
      (record) =>
        String(
          record.documentId || ""
        ) === cleanDocumentId &&
        String(
          record.portalId || ""
        ) === cleanPortalId &&
        normalizeEmail(
          record.email
        ) === cleanEmail &&
        record.clientVisible !== false
    ) || null;
  }

  async function findDuplicate({
    portalId,
    email,
    taxYear,
    sha256
  } = {}) {
    const records =
      await listForPortal({
        portalId,
        email
      });

    return records.find(
      (record) =>
        String(
          record.taxYear || ""
        ) ===
          String(
            taxYear || ""
          ) &&
        String(
          record.sha256 || ""
        ) ===
          String(
            sha256 || ""
          )
    ) || null;
  }

  async function upload({
    record,
    buffer
  } = {}) {
    if (
      !record ||
      !Buffer.isBuffer(buffer)
    ) {
      return {
        ok: false,
        error:
          "Document metadata and content are required."
      };
    }

    if (!isAvailable()) {
      return {
        ok: false,
        error:
          "Secure document storage is not configured."
      };
    }

    const now =
      new Date().toISOString();

    const storagePath =
      buildStoragePath(record);

    const next = {
      ...record,
      storagePath,
      uploadedAt:
        record.uploadedAt ||
        now,
      updatedAt: now,
      clientVisible:
        record.clientVisible !== false
    };

    if (supabaseAdmin) {
      const {
        error: uploadError
      } = await supabaseAdmin
        .storage
        .from(bucketName)
        .upload(
          storagePath,
          buffer,
          {
            contentType:
              next.contentType,
            cacheControl: "3600",
            upsert: false
          }
        );

      if (uploadError) {
        return {
          ok: false,
          error:
            uploadError.message ||
            String(uploadError)
        };
      }

      const {
        data,
        error: metadataError
      } = await supabaseAdmin
        .from(tableName)
        .insert(
          toDatabaseRow(next)
        )
        .select("*")
        .single();

      if (metadataError) {
        await supabaseAdmin
          .storage
          .from(bucketName)
          .remove(
            [storagePath]
          );

        return {
          ok: false,
          error:
            metadataError.message ||
            String(metadataError)
        };
      }

      return {
        ok: true,
        source: mode,
        record:
          mapDatabaseRow(data)
      };
    }

    try {
      const destination =
        resolveLocalStoragePath(
          storagePath
        );

      fs.mkdirSync(
        path.dirname(
          destination
        ),
        {
          recursive: true
        }
      );

      fs.writeFileSync(
        destination,
        buffer,
        {
          flag: "wx",
          mode: 0o600
        }
      );

      try {
        fs.chmodSync(
          destination,
          0o600
        );
      } catch {
        // Windows may not apply POSIX modes.
      }

      const records =
        readLocal();

      records.push(next);

      try {
        writeLocal(records);
      } catch (error) {
        fs.rmSync(
          destination,
          {
            force: true
          }
        );

        throw error;
      }

      return {
        ok: true,
        source: mode,
        record: next
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error.message ||
          String(error)
      };
    }
  }

  async function download({
    documentId,
    portalId,
    email
  } = {}) {
    const record =
      await getForPortal({
        documentId,
        portalId,
        email
      });

    if (
      !record ||
      String(
        record.reviewStatus || ""
      ) === "withdrawn"
    ) {
      return {
        ok: false,
        error:
          "The requested document was not found."
      };
    }

    if (supabaseAdmin) {
      const {
        data,
        error
      } = await supabaseAdmin
        .storage
        .from(bucketName)
        .download(
          record.storagePath
        );

      if (error || !data) {
        return {
          ok: false,
          error:
            error?.message ||
            "The document could not be downloaded."
        };
      }

      return {
        ok: true,
        source: mode,
        record,
        buffer: Buffer.from(
          await data.arrayBuffer()
        )
      };
    }

    try {
      const source =
        resolveLocalStoragePath(
          record.storagePath
        );

      const buffer =
        fs.readFileSync(source);

      return {
        ok: true,
        source: mode,
        record,
        buffer
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error.message ||
          String(error)
      };
    }
  }

  async function listForOffice(
    filters = {}
  ) {
    if (!isAvailable()) {
      return [];
    }

    const status = String(
      filters.status || ""
    ).trim();

    const portalId = String(
      filters.portalId || ""
    ).trim();

    const email =
      normalizeEmail(
        filters.email
      );

    const search = String(
      filters.search || ""
    )
      .trim()
      .toLowerCase();

    let records;

    if (supabaseAdmin) {
      let query = supabaseAdmin
        .from(tableName)
        .select("*")
        .order(
          "uploaded_at",
          {
            ascending: false
          }
        )
        .limit(500);

      if (status) {
        query = query.eq(
          "review_status",
          status
        );
      }

      if (portalId) {
        query = query.eq(
          "portal_id",
          portalId
        );
      }

      if (email) {
        query = query.eq(
          "email",
          email
        );
      }

      const {
        data,
        error
      } = await query;

      if (error) {
        throw error;
      }

      records = (
        data || []
      ).map(
        mapDatabaseRow
      );
    } else {
      records = readLocal()
        .filter(
          (record) =>
            (
              !status ||
              String(
                record.reviewStatus || ""
              ) === status
            ) &&
            (
              !portalId ||
              String(
                record.portalId || ""
              ) === portalId
            ) &&
            (
              !email ||
              normalizeEmail(
                record.email
              ) === email
            )
        )
        .sort(
          (left, right) =>
            Date.parse(
              right.uploadedAt || 0
            ) -
            Date.parse(
              left.uploadedAt || 0
            )
        );
    }

    if (!search) {
      return records;
    }

    return records.filter(
      (record) => {
        const haystack = [
          record.originalName,
          record.email,
          record.taxYear,
          record.category,
          record.note,
          record.clientMessage,
          record.officeNote,
          record.accountLeadId,
          record.linkedLeadId
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(
          search
        );
      }
    );
  }

  async function getForOffice({
    documentId
  } = {}) {
    const cleanDocumentId = String(
      documentId || ""
    ).trim();

    if (
      !cleanDocumentId ||
      !isAvailable()
    ) {
      return null;
    }

    if (supabaseAdmin) {
      const {
        data,
        error
      } = await supabaseAdmin
        .from(tableName)
        .select("*")
        .eq(
          "document_id",
          cleanDocumentId
        )
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data
        ? mapDatabaseRow(data)
        : null;
    }

    return readLocal().find(
      (record) =>
        String(
          record.documentId || ""
        ) === cleanDocumentId
    ) || null;
  }

  async function updateReview({
    documentId,
    patch = {}
  } = {}) {
    const existing =
      await getForOffice({
        documentId
      });

    if (!existing) {
      return {
        ok: false,
        error:
          "The document could not be found."
      };
    }

    const now =
      new Date().toISOString();

    const next = {
      ...existing,
      reviewStatus:
        patch.reviewStatus ??
        existing.reviewStatus,
      officeNote:
        patch.officeNote ??
        existing.officeNote,
      clientMessage:
        patch.clientMessage ??
        existing.clientMessage,
      retentionUntil:
        patch.retentionUntil ??
        existing.retentionUntil,
      reviewedAt:
        patch.reviewedAt ??
        existing.reviewedAt,
      reviewedBy:
        patch.reviewedBy ??
        existing.reviewedBy,
      statusChangedAt:
        patch.statusChangedAt ??
        now,
      clientVisible:
        patch.clientVisible ??
        existing.clientVisible,
      withdrawnAt:
        patch.withdrawnAt ??
        (
          patch.reviewStatus ===
          "withdrawn"
            ? now
            : existing.withdrawnAt
        ),
      updatedAt: now
    };

    if (supabaseAdmin) {
      const {
        data,
        error
      } = await supabaseAdmin
        .from(tableName)
        .update(
          toDatabaseRow(next)
        )
        .eq(
          "document_id",
          existing.documentId
        )
        .select("*")
        .single();

      if (error) {
        return {
          ok: false,
          error:
            error.message ||
            String(error)
        };
      }

      return {
        ok: true,
        source: mode,
        record:
          mapDatabaseRow(data)
      };
    }

    const records =
      readLocal();

    const index = records.findIndex(
      (record) =>
        String(
          record.documentId || ""
        ) === existing.documentId
    );

    if (index < 0) {
      return {
        ok: false,
        error:
          "The document could not be found."
      };
    }

    records[index] = next;
    writeLocal(records);

    return {
      ok: true,
      source: mode,
      record: next
    };
  }

  async function downloadForOffice({
    documentId
  } = {}) {
    const record =
      await getForOffice({
        documentId
      });

    if (!record) {
      return {
        ok: false,
        error:
          "The requested document was not found."
      };
    }

    if (supabaseAdmin) {
      const {
        data,
        error
      } = await supabaseAdmin
        .storage
        .from(bucketName)
        .download(
          record.storagePath
        );

      if (error || !data) {
        return {
          ok: false,
          error:
            error?.message ||
            "The document could not be downloaded."
        };
      }

      return {
        ok: true,
        source: mode,
        record,
        buffer: Buffer.from(
          await data.arrayBuffer()
        )
      };
    }

    try {
      const source =
        resolveLocalStoragePath(
          record.storagePath
        );

      return {
        ok: true,
        source: mode,
        record,
        buffer:
          fs.readFileSync(source)
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error.message ||
          String(error)
      };
    }
  }

  async function deletePermanently({
    documentId
  } = {}) {
    const existing =
      await getForOffice({
        documentId
      });

    if (!existing) {
      return {
        ok: false,
        error:
          "The document could not be found."
      };
    }

    if (supabaseAdmin) {
      const {
        error: storageError
      } = await supabaseAdmin
        .storage
        .from(bucketName)
        .remove(
          [existing.storagePath]
        );

      if (storageError) {
        return {
          ok: false,
          error:
            storageError.message ||
            String(storageError)
        };
      }

      const {
        error: metadataError
      } = await supabaseAdmin
        .from(tableName)
        .delete()
        .eq(
          "document_id",
          existing.documentId
        );

      if (metadataError) {
        return {
          ok: false,
          error:
            metadataError.message ||
            String(metadataError)
        };
      }

      return {
        ok: true,
        source: mode,
        record: existing
      };
    }

    const records =
      readLocal();

    const next = records.filter(
      (record) =>
        String(
          record.documentId || ""
        ) !== existing.documentId
    );

    try {
      const source =
        resolveLocalStoragePath(
          existing.storagePath
        );

      fs.rmSync(
        source,
        {
          force: true
        }
      );

      writeLocal(next);

      return {
        ok: true,
        source: mode,
        record: existing
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error.message ||
          String(error)
      };
    }
  }

  async function checkLiveReadiness() {
    const result = {
      mode,
      liveStorageReady:
        isLiveReady(),
      tableReady: false,
      bucketReady: false,
      privateBucket: false,
      errors: []
    };

    if (!supabaseAdmin) {
      result.errors.push(
        "SUPABASE_SERVICE_ROLE_KEY is not configured."
      );

      return result;
    }

    try {
      const {
        error
      } = await supabaseAdmin
        .from(tableName)
        .select(
          "document_id",
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
    } catch (error) {
      result.errors.push(
        `Document table: ${
          error.message ||
          String(error)
        }`
      );
    }

    try {
      const {
        data,
        error
      } = await supabaseAdmin
        .storage
        .getBucket(
          bucketName
        );

      if (error) {
        throw error;
      }

      result.bucketReady =
        Boolean(data);

      result.privateBucket =
        data?.public === false;

      if (
        data &&
        data.public !== false
      ) {
        result.errors.push(
          "The document bucket is public. It must be private."
        );
      }
    } catch (error) {
      result.errors.push(
        `Document bucket: ${
          error.message ||
          String(error)
        }`
      );
    }

    result.liveStorageReady =
      result.tableReady &&
      result.bucketReady &&
      result.privateBucket;

    return result;
  }

  function buildSummary(
    records = []
  ) {
    const active = records.filter(
      (record) =>
        String(
          record.reviewStatus || ""
        ) !== "withdrawn"
    );

    const awaitingReview =
      active.filter(
        (record) =>
          String(
            record.reviewStatus ||
            "awaiting-review"
          ) ===
          "awaiting-review"
      ).length;

    const inReview =
      active.filter(
        (record) =>
          String(
            record.reviewStatus ||
            ""
          ) === "in-review"
      ).length;

    const accepted =
      active.filter(
        (record) =>
          String(
            record.reviewStatus ||
            ""
          ) === "accepted"
      ).length;

    const needsReplacement =
      active.filter(
        (record) =>
          String(
            record.reviewStatus ||
            ""
          ) ===
          "needs-replacement"
      ).length;

    const latest =
      [...active].sort(
        (left, right) =>
          Date.parse(
            right.uploadedAt || 0
          ) -
          Date.parse(
            left.uploadedAt || 0
          )
      )[0] || null;

    return {
      totalDocuments:
        active.length,
      awaitingReview,
      inReview,
      accepted,
      needsReplacement,
      latestUploadAt:
        latest?.uploadedAt ||
        "",
      latestFileName:
        latest?.originalName ||
        ""
    };
  }

  return {
    mode,
    tableName,
    bucketName,
    localMetadataFile,
    localDirectory,
    isAvailable,
    isLiveReady,
    listForPortal,
    getForPortal,
    findDuplicate,
    upload,
    download,
    listForOffice,
    getForOffice,
    updateReview,
    downloadForOffice,
    deletePermanently,
    checkLiveReadiness,
    buildSummary
  };
}

module.exports = {
  createClientDocumentStore
};
