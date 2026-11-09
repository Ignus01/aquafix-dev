import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCollection, fetchCount, fetchPage, fetchRow, type ODataRow } from "./client";

// Create-or-update migration from the legacy OData services, in three groups:
// "reference" (master data + inspection setup), "transactions" (instructions,
// inspections, incidents, services) and "images" (the photos on incidents,
// notes and inspection values, which need the transactions in place first).
//
// Safe to run repeatedly. Every migrated row stores the source object ID in
// `odata_id`; a re-run updates rows that carry it and creates the rest. Rows
// created in Supabase by hand are adopted (not duplicated) when they match a
// source row on the table's natural key (name / code). Nothing is deleted.
//
// Images don't fit in one run: there are thousands and each is a separate
// download. A run does as much as its time budget allows and returns `next`,
// the cursor to call it with again. Migrated images are skipped, not updated,
// so starting over only re-reads the list.

export type MigrationEntityResult = {
  label: string;
  fetched: number;
  created: number;
  updated: number;
  // Already migrated, or nothing to migrate (a source image with no file).
  skipped: number;
  failed: number;
  errors: string[];
  // Rows in the source; only set by groups that take several runs.
  total?: number;
};

// Where the next image run starts: IMAGE_SPECS index + rows already read.
export type ImageCursor = { source: number; skip: number };

export type MigrationResult = {
  entities: MigrationEntityResult[];
  notes: string[];
  fatal: string | null;
  next?: ImageCursor | null;
};

export type MigrationGroup = "reference" | "transactions" | "images";

type Table =
  | "region"
  | "organisation"
  | "colour_container"
  | "asset_type"
  | "location"
  | "grading"
  | "asset"
  | "incident_type"
  | "inspection"
  | "inspection_allocation"
  | "inspection_drop_down_option"
  | "inspection_rule"
  | "instruction"
  | "instruction_asset_allocation"
  | "inspection_activity"
  | "inspection_value"
  | "inspection_cumulative_value"
  | "incident"
  | "incident_note"
  | "service";

type Row = Record<string, unknown>;
// Source ID -> Supabase id, per table. `account` maps legacy accounts to auth
// users (null when no matching user could be found).
type IdMaps = Record<Table, Map<string, string>> & {
  account: Map<string, string | null>;
  timeZone: string;
};

type Spec = {
  table: Table;
  group: Exclude<MigrationGroup, "images">;
  label: string;
  service: "masterdata" | "inspectionsetup" | "assetmanagement";
  collection: string;
  // Columns read from existing rows to match unmigrated ones to source rows.
  keyColumns?: string[];
  // Natural key shared by an existing row and a mapped source row.
  key?: (row: Row) => string | null;
  // Columns written only when the row is created: on an existing row Supabase
  // owns them, so a re-run doesn't undo changes made there.
  createOnly?: string[];
  // Maps a source record to a table row (without id), or throws with the reason.
  map: (src: ODataRow, ids: IdMaps) => Row;
};

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
const bool = (v: unknown) => v === true;
const date = (v: unknown) => (typeof v === "string" && v ? v : null);
const lower = (v: unknown) => str(v).trim().toLowerCase();

function ref(ids: IdMaps, table: Table, sourceId: unknown, what: string, required = true): string | null {
  if (sourceId == null) {
    if (required) throw new Error(`no ${what} on the source record`);
    return null;
  }
  const id = ids[table].get(String(sourceId));
  if (!id) throw new Error(`${what} ${sourceId} was not migrated`);
  return id;
}

// Legacy enum text ("_New", "In_Progress", "Completed") -> snake_case value.
const enumValue = (v: unknown) => str(v).trim().replace(/^_+/, "").toLowerCase();

// A timestamp's calendar date in the app's time zone (for date-only columns).
function localDate(iso: string, ids: IdMaps): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ids.timeZone }).format(new Date(iso));
}

function user(ids: IdMaps, accountId: unknown): string | null {
  return accountId == null ? null : (ids.account.get(String(accountId)) ?? null);
}

const base = (src: ODataRow): Row => ({
  odata_id: String(src.ID),
  ...(date(src.createdDate) ? { created_at: date(src.createdDate) } : {}),
});

// Dependency order: parents before the rows that reference them.
const SPECS: Spec[] = [
  {
    table: "region",
    group: "reference",
    label: "Regions",
    service: "masterdata",
    collection: "Regions",
    keyColumns: ["name"],
    key: (r) => lower(r.name),
    map: (s) => ({ ...base(s), name: str(s.Name), active: bool(s.Active) }),
  },
  {
    table: "organisation",
    group: "reference",
    label: "Organisations",
    service: "masterdata",
    collection: "Organisations",
    keyColumns: ["name"],
    // The database upper-cases organisation names (ORG-R02).
    key: (r) => str(r.name).trim().toUpperCase(),
    map: (s) => ({
      ...base(s),
      name: str(s.Name),
      active: bool(s.Active),
      is_supplier: bool(s.IsSupplier),
      is_service_supplier: bool(s.IsServiceSupplier),
    }),
  },
  {
    table: "colour_container",
    group: "reference",
    label: "Colour containers",
    service: "masterdata",
    collection: "ColourContainers",
    keyColumns: ["name"],
    key: (r) => lower(r.name),
    map: (s) => ({
      ...base(s),
      name: str(s.Name),
      hex_colour: s.HexColour ?? null,
      class_name: str(s.ClassName),
    }),
  },
  {
    table: "asset_type",
    group: "reference",
    label: "Asset types",
    service: "masterdata",
    collection: "AssetTypes",
    keyColumns: ["name"],
    key: (r) => lower(r.name),
    // `classification` isn't exposed by the source: new rows get the default,
    // existing rows keep whatever was set in Supabase. So does the name: the
    // meter types were split and renamed in Supabase
    // (20261109120000_asset_classification.sql), e.g. Water Meter → Other Meter.
    createOnly: ["name"],
    map: (s) => ({ ...base(s), name: str(s.Name), active: bool(s.Active) }),
  },
  {
    table: "location",
    group: "reference",
    label: "Locations",
    service: "masterdata",
    collection: "Locations",
    keyColumns: ["name"],
    key: (r) => lower(r.name),
    map: (s, ids) => ({
      ...base(s),
      name: str(s.Name),
      active: bool(s.Active),
      transfer_type: s.TransferType === "MANUAL" ? "MANUAL" : "AUTO",
      is_stock_manager: bool(s.IsStockManager),
      is_asset_manager: bool(s.IsAssetManager),
      region_id: ref(ids, "region", s.RegionID, "region"),
      organisation_id: ref(ids, "organisation", s.OrganisationID, "organisation"),
    }),
  },
  {
    table: "grading",
    group: "reference",
    label: "Gradings",
    service: "masterdata",
    collection: "Gradings",
    keyColumns: ["name"],
    key: (r) => lower(r.name),
    map: (s, ids) => ({
      ...base(s),
      name: str(s.Name),
      priority: num(s._Priority),
      colour_container_id: ref(ids, "colour_container", s.ColourContainerID, "colour container"),
    }),
  },
  {
    table: "asset",
    group: "reference",
    label: "Assets",
    service: "masterdata",
    collection: "Assets",
    keyColumns: ["code"],
    key: (r) => lower(r.code),
    // Meters were moved onto new asset types in Supabase
    // (20261109120000_asset_classification.sql); the source still has them
    // all on Water Meter.
    createOnly: ["asset_type_id"],
    map: (s, ids) => ({
      ...base(s),
      name: str(s.Name),
      code: str(s.Code),
      purchase_date: date(s.PurchaseDate),
      active: bool(s.Active),
      last_inspection_date: date(s._LastInspectionDate),
      has_service_plan: bool(s.HasServicePlan),
      service_interval: num(s.ServiceInterval),
      asset_type_id: ref(ids, "asset_type", s.AssetTypeID, "asset type"),
      location_id: ref(ids, "location", s.LocationID, "location"),
    }),
  },
  {
    table: "incident_type",
    group: "reference",
    label: "Incident types",
    service: "inspectionsetup",
    collection: "IncidentTypes",
    keyColumns: ["name"],
    key: (r) => lower(r.name),
    map: (s) => ({
      ...base(s),
      name: str(s.Name),
      is_image_required: bool(s.IsImageRequired),
      active: bool(s.Active),
    }),
  },
  {
    table: "inspection",
    group: "reference",
    label: "Inspections",
    service: "inspectionsetup",
    collection: "Inspections",
    map: (s) => {
      if (!s.ValueType) throw new Error("no value type on the source record");
      return {
        ...base(s),
        name: str(s.Name),
        description: str(s.Description),
        value_type: s.ValueType,
        is_required: bool(s.IsRequired),
        active: bool(s.Active),
        nr_of_images_required: num(s.NrOfImagesRequired),
      };
    },
  },
  {
    table: "inspection_allocation",
    group: "reference",
    label: "Inspection allocations",
    service: "inspectionsetup",
    collection: "InspectionAllocations",
    keyColumns: ["inspection_id", "asset_type_id"],
    key: (r) => `${r.inspection_id}|${r.asset_type_id}`,
    map: (s, ids) => ({
      ...base(s),
      priority: num(s._Priority),
      inspection_id: ref(ids, "inspection", s.InspectionID, "inspection"),
      asset_type_id: ref(ids, "asset_type", s.AssetTypeID, "asset type"),
    }),
  },
  {
    table: "inspection_drop_down_option",
    group: "reference",
    label: "Drop-down options",
    service: "inspectionsetup",
    collection: "InspectionDropDownOptions",
    map: (s, ids) => ({
      ...base(s),
      name: str(s.Name),
      nr_of_images_required: num(s.NrOfImagesRequired),
      priority: num(s._Priority),
      active: bool(s.Active),
      inspection_id: ref(ids, "inspection", s.InspectionID, "inspection"),
      grading_id: ref(ids, "grading", s.GradingID, "grading"),
    }),
  },
  {
    table: "inspection_rule",
    group: "reference",
    label: "Inspection rules",
    service: "inspectionsetup",
    collection: "InspectionRules",
    map: (s, ids) => ({
      ...base(s),
      lower_limit: num(s.LowerLimit),
      upper_limit: num(s.UpperLimit),
      nr_of_images_required: num(s.NrOfImagesRequired),
      is_first: bool(s._IsFirst),
      inspection_id: ref(ids, "inspection", s.InspectionID, "inspection"),
      grading_id: ref(ids, "grading", s.GradingID, "grading", false),
    }),
  },

  // --- Transactions --------------------------------------------------------
  // Where a table's audit trigger stamps created_at itself (incidents, notes,
  // incident images, services) the original creation time can't be kept.
  {
    table: "instruction",
    group: "transactions",
    label: "Instructions",
    service: "assetmanagement",
    collection: "Instructions",
    // Progress counts and status are recalculated from the allocations by
    // the database as they are migrated.
    map: (s, ids) => ({
      ...base(s),
      name: str(s.Name),
      comment: str(s.Comment),
      status: enumValue(s.Status) || "new",
      is_scheduled: bool(s._Scheduled),
      required_completed_date: localDate(
        date(s.RequiredCompletedDate) ?? date(s.createdDate) ?? new Date().toISOString(),
        ids,
      ),
      account_id: user(ids, s.AccountID),
    }),
  },
  {
    table: "instruction_asset_allocation",
    group: "transactions",
    label: "Instruction assets",
    service: "assetmanagement",
    collection: "InstructionAssetAllocations",
    keyColumns: ["instruction_id", "asset_id"],
    key: (r) => `${r.instruction_id}|${r.asset_id}`,
    map: (s, ids) => ({
      ...base(s),
      is_completed: bool(s.IsCompleted),
      instruction_id: ref(ids, "instruction", s.InstructionID, "instruction"),
      asset_id: ref(ids, "asset", s.AssetID, "asset"),
    }),
  },
  {
    table: "inspection_activity",
    group: "transactions",
    label: "Inspection activities",
    service: "assetmanagement",
    collection: "InspectionActivities",
    map: (s, ids) => ({
      ...base(s),
      inspection_date: date(s.InspectionDate) ?? date(s.createdDate),
      asset_id: ref(ids, "asset", s.AssetID, "asset"),
      instruction_id: ref(ids, "instruction", s.InspectionActivity_Instruction, "instruction", false),
      grading_id: ref(ids, "grading", s.GradingID, "grading", false),
      created_by: user(ids, s.AccountID),
    }),
  },
  {
    table: "inspection_value",
    group: "transactions",
    label: "Inspection values",
    service: "assetmanagement",
    collection: "InspectionValues",
    map: (s, ids) => ({
      ...base(s),
      inspection_activity_id: ref(ids, "inspection_activity", s.InspectionActivityID, "inspection activity"),
      inspection_id: ref(ids, "inspection", s.InspectionID, "inspection"),
      inspection_drop_down_option_id: ref(
        ids,
        "inspection_drop_down_option",
        s.InspectionDropDownOptionID,
        "drop-down option",
        false,
      ),
      grading_id: ref(ids, "grading", s.GradingID, "grading", false),
      text_value: str(s.TextValue),
      decimal_value: num(s.DecimalValue),
      date_value: date(s.DateValue),
      display_value: str(s._DisplayValue).slice(0, 200),
    }),
  },
  {
    table: "inspection_cumulative_value",
    group: "transactions",
    label: "Cumulative values",
    service: "assetmanagement",
    collection: "InspectionCumulativeValues",
    keyColumns: ["inspection_id", "asset_id"],
    key: (r) => `${r.inspection_id}|${r.asset_id}`,
    // No created_at column on this table.
    map: (s, ids) => ({
      odata_id: String(s.ID),
      latest_value: num(s.LatestValue),
      inspection_id: ref(ids, "inspection", s.InspectionID, "inspection"),
      asset_id: ref(ids, "asset", s.AssetID, "asset"),
    }),
  },
  {
    table: "incident",
    group: "transactions",
    label: "Incidents",
    service: "assetmanagement",
    collection: "Incidents",
    map: (s, ids) => {
      const status = enumValue(s.IncidentStatus) || "new";
      return {
        odata_id: String(s.ID),
        incident_date: date(s.IncidentDate) ?? date(s.createdDate),
        status,
        completed_at:
          status === "completed"
            ? (date(s.CompletedDate) ?? date(s.changedDate) ?? date(s.IncidentDate))
            : null,
        comment: str(s.Comment).trim() ? str(s.Comment) : "(no comment)",
        location_id: ref(ids, "location", s.LocationID, "location"),
        incident_type_id: ref(ids, "incident_type", s.IncidentTypeID, "incident type"),
        created_by: user(ids, s.AccountID),
      };
    },
  },
  {
    table: "incident_note",
    group: "transactions",
    label: "Incident notes",
    service: "assetmanagement",
    collection: "IncidentNotes",
    map: (s, ids) => ({
      odata_id: String(s.ID),
      body: str(s.Notes).trim() ? str(s.Notes) : "(empty note)",
      incident_id: ref(ids, "incident", s.IncidentID, "incident"),
    }),
  },
  {
    table: "service",
    group: "transactions",
    label: "Services",
    service: "assetmanagement",
    collection: "Services",
    // Assets with a service plan get an open service automatically; adopt it
    // rather than collide with the one-open-service-per-asset rule.
    keyColumns: ["asset_id", "is_completed"],
    key: (r) => (r.is_completed ? null : `open|${r.asset_id}`),
    map: (s, ids) => {
      const completed = bool(s.IsCompleted);
      const comment = str(s.Comment).slice(0, 200);
      return {
        odata_id: String(s.ID),
        service_type: /maint/i.test(str(s.ServiceType)) ? "scheduled_maintenance" : "repair",
        due_date: date(s.DueDate) ?? date(s.createdDate),
        is_completed: completed,
        completed_date: completed ? (date(s.CompletedDate) ?? date(s.changedDate)) : null,
        invoice_nr: s.InvoiceNr ?? null,
        total_part_cost: num(s.TotalPartCost),
        total_labour_cost: num(s.TotalLabourCost),
        comment: comment || null,
        performed_by: s.PerformedBy ?? null,
        asset_id: ref(ids, "asset", s.AssetID, "asset"),
        supplier_id: ref(ids, "organisation", s.OrganisationID, "supplier", false),
      };
    },
  },
];

type ImageTable = "incident_image" | "inspection_image";

type ImageSpec = {
  table: ImageTable;
  label: string;
  collection: string;
  bucket: string;
  // The feed's page rows, without Contents (base64, about 1.4 MB per image).
  select: string;
  // Tables whose source IDs `parent` needs.
  parents: Table[];
  // The row's link to its parent, or throws with the reason.
  parent: (src: ODataRow, ids: IdMaps) => Row;
};

const IMAGE_SERVICE = "assetmanagement";

const IMAGE_SPECS: ImageSpec[] = [
  {
    table: "incident_image",
    label: "Incident images",
    collection: "IncidentImages",
    bucket: "incident-images",
    select: "ID,HasContents,createdDate,owner,IncidentImage_Incident,IncidentImage_IncidentNote",
    parents: ["incident", "incident_note"],
    // On the incident or on one of its notes, never both (ICI-R02).
    parent: (s, ids) => ({
      incident_id: ref(ids, "incident", s.IncidentImage_Incident, "incident", false),
      incident_note_id: ref(ids, "incident_note", s.IncidentImage_IncidentNote, "incident note", false),
    }),
  },
  {
    table: "inspection_image",
    label: "Inspection images",
    collection: "InspectionImages",
    bucket: "inspection-images",
    select: "ID,HasContents,createdDate,owner,InspectionImage_InspectionValue",
    parents: ["inspection_value"],
    parent: (s, ids) => ({
      inspection_value_id: ref(ids, "inspection_value", s.InspectionImage_InspectionValue, "inspection value"),
    }),
  },
];

const PAGE = 1000; // PostgREST's default row cap per request
const CHUNK = 500;
const MAX_ERRORS = 10;
// Stop retrying rows one by one after this many failures in one entity — a
// systematic problem would otherwise mean thousands of single requests.
const MAX_FAILURES = 50;
// Leave headroom under the route's maxDuration (300s).
const TIME_BUDGET_MS = 270_000;
// Short image runs, so progress shows often and a lost request costs little.
const IMAGE_TIME_BUDGET_MS = 120_000;
const IMAGE_REQUEST_TIMEOUT_MS = 45_000;
// Simultaneous image copies; the legacy host starts dropping connections if
// pushed much harder.
const IMAGE_CONCURRENCY = 5;

type Admin = ReturnType<typeof createAdminClient>;

async function loadExisting(admin: Admin, table: Table | ImageTable, extra: string[]): Promise<Row[]> {
  const columns = ["id", "odata_id", ...extra].join(", ");
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function migrateEntity(
  admin: Admin,
  spec: Spec,
  ids: IdMaps,
  deadline: number,
  // Filled in as rows are written, so progress survives a timeout.
  result: MigrationEntityResult,
): Promise<void> {
  const fail = (message: string) => {
    result.failed++;
    if (result.errors.length < MAX_ERRORS) result.errors.push(message);
  };

  const source = await fetchCollection(spec.service, spec.collection);
  result.fetched = source.length;

  const existing = await loadExisting(admin, spec.table, spec.keyColumns ?? []);
  const bySourceId = new Map<string, string>();
  const unclaimedByKey = new Map<string, string>();
  for (const row of existing) {
    if (row.odata_id) {
      bySourceId.set(String(row.odata_id), String(row.id));
      ids[spec.table].set(String(row.odata_id), String(row.id));
    } else if (spec.key) {
      const k = spec.key(row);
      if (k && !unclaimedByKey.has(k)) unclaimedByKey.set(k, String(row.id));
    }
  }

  type Pending = { src: ODataRow; row: Row; label: string; isNew: boolean };
  const pending: Pending[] = [];
  for (const src of source) {
    const sourceId = String(src.ID);
    const label = str(src.Name ?? src.Code ?? `#${sourceId}`);
    try {
      const mapped = spec.map(src, ids);
      let id = bySourceId.get(sourceId);
      if (!id && spec.key) {
        const k = spec.key(mapped);
        const adopt = k ? unclaimedByKey.get(k) : undefined;
        if (adopt) {
          id = adopt;
          unclaimedByKey.delete(k!);
        }
      }
      const row: Row = { ...mapped, id: id ?? randomUUID() };
      if (id) for (const column of spec.createOnly ?? []) delete row[column];
      pending.push({ src, row, label, isNew: !id });
    } catch (e) {
      fail(`${label}: ${(e as Error).message}`);
    }
  }

  // A batch upsert sends the union of its rows' columns and nulls the ones a
  // row lacks, so rows missing createOnly columns (existing ones) go in their
  // own batches.
  if (spec.createOnly?.length) pending.sort((a, b) => Number(a.isNew) - Number(b.isNew));

  const succeeded = (p: Pending) => {
    if (p.isNew) result.created++;
    else result.updated++;
    ids[spec.table].set(String(p.src.ID), String(p.row.id));
  };

  let size = 0;
  for (let i = 0; i < pending.length; i += size) {
    if (Date.now() > deadline) throw new TimeoutError();
    let chunk = pending.slice(i, i + CHUNK);
    // Never mix existing and new rows in one batch (see the sort above).
    if (spec.createOnly?.length) {
      const cut = chunk.findIndex((p) => p.isNew !== chunk[0].isNew);
      if (cut > 0) chunk = chunk.slice(0, cut);
    }
    size = chunk.length;
    const { error } = await admin.from(spec.table).upsert(
      chunk.map((p) => p.row),
      { onConflict: "id" },
    );
    if (!error) {
      chunk.forEach(succeeded);
      continue;
    }
    // One bad row fails the whole batch; retry singly to isolate it.
    for (const [j, p] of chunk.entries()) {
      if (result.failed >= MAX_FAILURES) {
        const skipped = pending.length - i - j;
        result.failed += skipped;
        result.errors.push(
          `Stopped after ${MAX_FAILURES} failures; ${skipped} remaining rows skipped. Batch error: ${error.message}`,
        );
        return;
      }
      const { error: rowError } = await admin.from(spec.table).upsert(p.row, { onConflict: "id" });
      if (rowError) fail(`${p.label}: ${rowError.message}`);
      else succeeded(p);
    }
  }
}

class TimeoutError extends Error {
  constructor() {
    super("Ran out of time. Everything migrated so far is saved — run it again to continue.");
  }
}

// Same sizes and quality as browser uploads (lib/incidents/image-upload.ts), so
// migrated photos behave like any other. `rotate` applies the EXIF orientation,
// which re-encoding would otherwise lose.
async function renderJpeg(input: Buffer, maxSide: number, quality: number): Promise<Buffer> {
  // Imported here so a problem with the native module only affects this step,
  // not every page that loads the settings actions.
  const { default: sharp } = await import("sharp");
  return sharp(input, { failOn: "error" })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality })
    .toBuffer();
}

// Files before the row, so a row never points at a missing file. The paths are
// derived from the source ID and overwritten on retry, so a run that dies
// between the two steps leaves nothing behind.
async function copyImage(admin: Admin, spec: ImageSpec, src: ODataRow, parent: Row, ids: IdMaps): Promise<void> {
  const sourceId = String(src.ID);
  const { Contents: contents } = await fetchRow(
    IMAGE_SERVICE,
    spec.collection,
    sourceId,
    "Contents",
    IMAGE_REQUEST_TIMEOUT_MS,
  );
  if (typeof contents !== "string" || !contents) throw new Error("the source returned no file");

  const input = Buffer.from(contents, "base64");
  const [full, thumb] = await Promise.all([renderJpeg(input, 1600, 82), renderJpeg(input, 400, 72)]);

  const storagePath = `legacy/${sourceId}.jpg`;
  const thumbnailPath = `legacy/${sourceId}_thumb.jpg`;
  const storage = admin.storage.from(spec.bucket);
  for (const [path, body] of [
    [storagePath, full],
    [thumbnailPath, thumb],
  ] as const) {
    const { error } = await storage.upload(path, body, { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error(`upload failed: ${error.message}`);
  }

  const { error } = await admin.from(spec.table).upsert(
    {
      ...base(src),
      ...parent,
      storage_path: storagePath,
      thumbnail_path: thumbnailPath,
      mime_type: "image/jpeg",
      size_bytes: full.length,
      created_by: user(ids, src.owner),
    },
    { onConflict: "odata_id" },
  );
  if (error) throw new Error(error.message);
}

// Copies images page by page from `skip` until the feed ends (returns null) or
// time is up (returns the rows read so far, to resume from). Only the rows still
// missing are downloaded, so re-reading migrated pages stays cheap.
async function migrateImages(
  admin: Admin,
  spec: ImageSpec,
  ids: IdMaps,
  skip: number,
  deadline: number,
  result: MigrationEntityResult,
): Promise<number | null> {
  const fail = (sourceId: unknown, message: string) => {
    result.failed++;
    if (result.errors.length < MAX_ERRORS) result.errors.push(`#${sourceId}: ${message}`);
  };

  result.total = await fetchCount(IMAGE_SERVICE, spec.collection, IMAGE_REQUEST_TIMEOUT_MS);
  const existing = new Set((await loadExisting(admin, spec.table, [])).map((r) => String(r.odata_id)));

  // Counts failed copies only: a missing parent costs nothing to find, and is
  // not a sign the rest of the run is doomed.
  let copyFailures = 0;
  for (let position = skip; Date.now() < deadline; ) {
    const page = await fetchPage(IMAGE_SERVICE, spec.collection, spec.select, position, IMAGE_REQUEST_TIMEOUT_MS);
    result.fetched += page.rows.length;

    const queue: { src: ODataRow; parent: Row }[] = [];
    for (const src of page.rows) {
      if (existing.has(String(src.ID)) || !bool(src.HasContents)) {
        result.skipped++;
        continue;
      }
      try {
        queue.push({ src, parent: spec.parent(src, ids) });
      } catch (e) {
        fail(src.ID, (e as Error).message);
      }
    }

    let nextInQueue = 0;
    await Promise.all(
      Array.from({ length: IMAGE_CONCURRENCY }, async () => {
        while (nextInQueue < queue.length) {
          const { src, parent } = queue[nextInQueue++];
          try {
            await copyImage(admin, spec, src, parent, ids);
            result.created++;
          } catch (e) {
            copyFailures++;
            fail(src.ID, (e as Error).message);
          }
        }
      }),
    );
    if (copyFailures >= MAX_FAILURES) {
      throw new Error(`${spec.label}: stopped after ${copyFailures} failed copies. See the errors below.`);
    }

    if (page.done) return null;
    position += page.rows.length;
    if (Date.now() >= deadline) return position;
  }
  return skip;
}

// Source ID -> id for rows migrated earlier, for tables outside this run.
async function preloadIds(admin: Admin, table: Table, ids: IdMaps) {
  for (const row of await loadExisting(admin, table, [])) {
    if (row.odata_id) ids[table].set(String(row.odata_id), String(row.id));
  }
}

const nameKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

// Legacy accounts only carry a full name ("Ignus Potgieter [AquaFix]"). Match
// it to a Supabase user by username ("IgnusP", "IgnusPotgieter") or email
// local part. Unmatched accounts leave the user columns empty.
async function loadAccounts(admin: Admin, ids: IdMaps, notes: string[]) {
  const accounts = await fetchCollection("masterdata", "Accounts");
  const { data: profiles, error } = await admin.from("profiles").select("id, username");
  if (error) throw new Error(`profiles: ${error.message}`);
  const { data: authData, error: authError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (authError) throw new Error(`users: ${authError.message}`);

  const byKey = new Map<string, string>();
  const add = (key: string, id: string) => {
    if (key && !byKey.has(key)) byKey.set(key, id);
  };
  for (const p of profiles ?? []) add(nameKey(p.username), p.id);
  for (const p of profiles ?? []) add(nameKey(p.username.replace(/_.*$/, "")), p.id);
  for (const u of authData.users) add(nameKey((u.email ?? "").split("@")[0]), u.id);

  const unmatched = new Set<string>();
  for (const a of accounts) {
    const full = str(a.FullName).replace(/\[.*?\]/g, "").trim();
    const [first = "", ...rest] = full.split(/\s+/);
    const last = rest.join("");
    const candidates = [first + last, first + last.slice(0, 1), first].map(nameKey).filter(Boolean);
    const id = candidates.map((c) => byKey.get(c)).find(Boolean) ?? null;
    ids.account.set(String(a.ID), id);
    if (!id && full) unmatched.add(full);
  }
  if (unmatched.size) {
    notes.push(
      `No Supabase user found for: ${[...unmatched].join(", ")}. Their records are migrated without a user.`,
    );
  }
}

// One image run, from `cursor` until the time budget runs out. `next` is null
// once every source has been read to the end.
export async function runODataImageMigration(cursor: ImageCursor): Promise<MigrationResult> {
  const deadline = Date.now() + IMAGE_TIME_BUDGET_MS;
  const admin = createAdminClient();
  const ids = newIdMaps();
  const entities: MigrationEntityResult[] = [];
  const notes: string[] = [];
  try {
    await loadAccounts(admin, ids, notes);
    for (let source = cursor.source; source < IMAGE_SPECS.length; source++) {
      const spec = IMAGE_SPECS[source];
      for (const table of spec.parents) await preloadIds(admin, table, ids);
      const result = emptyResult(spec.label);
      entities.push(result);
      const skip = source === cursor.source ? cursor.skip : 0;
      const resume = await migrateImages(admin, spec, ids, skip, deadline, result);
      if (resume !== null) return { entities, notes, fatal: null, next: { source, skip: resume } };
      if (Date.now() >= deadline && source + 1 < IMAGE_SPECS.length) {
        return { entities, notes, fatal: null, next: { source: source + 1, skip: 0 } };
      }
    }
  } catch (e) {
    return { entities, notes, fatal: (e as Error).message, next: null };
  }
  return { entities, notes, fatal: null, next: null };
}

const emptyResult = (label: string): MigrationEntityResult => ({
  label,
  fetched: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  errors: [],
});

function newIdMaps(): IdMaps {
  return {
    ...Object.fromEntries(SPECS.map((s) => [s.table, new Map<string, string>()])),
    account: new Map(),
    timeZone: "UTC",
  } as IdMaps;
}

export async function runODataMigration(group: Exclude<MigrationGroup, "images">): Promise<MigrationResult> {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const admin = createAdminClient();
  const ids = newIdMaps();
  const entities: MigrationEntityResult[] = [];
  const notes: string[] = [];
  try {
    if (group === "transactions") {
      for (const s of SPECS.filter((s) => s.group !== group)) await preloadIds(admin, s.table, ids);
      const { data } = await admin.from("system_settings").select("time_zone").eq("id", 1).single();
      if (data?.time_zone) ids.timeZone = data.time_zone;
      await loadAccounts(admin, ids, notes);
    }
    for (const spec of SPECS.filter((s) => s.group === group)) {
      const result = emptyResult(spec.label);
      entities.push(result);
      await migrateEntity(admin, spec, ids, deadline, result);
    }
  } catch (e) {
    return { entities, notes, fatal: (e as Error).message };
  }
  return { entities, notes, fatal: null };
}
