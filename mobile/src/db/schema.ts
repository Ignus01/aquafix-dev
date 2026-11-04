// The phone's SQLite schema (spec "Local database schema"). Table and column
// names match Postgres so the same SQL reads on both sides. Streams send
// `SELECT *`; only the columns declared here are kept. PowerSync adds `id`
// (text). Booleans arrive as 0/1, timestamps as ISO text, numerics as real.
//
// Adding a column or table here needs a new app build; PowerSync re-syncs it.
import { column, Schema, Table } from "@powersync/react-native";

const { text, integer, real } = column;

// ---- reference_data --------------------------------------------------------
const location = new Table({ name: text, active: integer, is_asset_manager: integer });
const asset = new Table(
  { name: text, code: text, active: integer, last_inspection_date: text, asset_type_id: text, location_id: text },
  { indexes: { by_location: ["location_id"] } },
);
const asset_type = new Table({ name: text });
const grading = new Table({ legacy_uid: integer, name: text, priority: integer, colour_container_id: text });
const colour_container = new Table({ hex_colour: text });
const inspection_allocation = new Table(
  { inspection_id: text, asset_type_id: text, priority: integer },
  { indexes: { by_type: ["asset_type_id"] } },
);
const inspection = new Table({
  name: text,
  description: text,
  value_type: text,
  is_required: integer,
  active: integer,
  nr_of_images_required: integer,
  quality_parameter_id: text,
});
const inspection_drop_down_option = new Table({
  inspection_id: text,
  name: text,
  priority: integer,
  active: integer,
  grading_id: text,
});
const inspection_rule = new Table({
  legacy_uid: integer,
  inspection_id: text,
  lower_limit: real,
  upper_limit: real,
  nr_of_images_required: integer,
  grading_id: text,
});
const feedback = new Table({
  inspection_rule_id: text,
  feedback: text,
  max_nr_of_retries: integer,
  auto_create_incident: integer,
  incident_type_id: text,
});
const inspection_cumulative_value = new Table(
  { inspection_id: text, asset_id: text, latest_value: real },
  { indexes: { by_pair: ["inspection_id", "asset_id"] } },
);
const quality_parameter = new Table({ name: text });
const incident_type = new Table({ name: text, is_image_required: integer, disables_location: integer, active: integer });
const storage_area = new Table({ code: text, name: text, active: integer });
const item = new Table({ name: text, code: text, active: integer });
const profiles = new Table({ username: text });
const mobile_app_config = new Table({ min_app_version: text, updated_at: text });

// ---- my_roles ----------------------------------------------------------------
const user_masterdata_roles = new Table({ user_id: text, role: text });

// ---- my_instructions ---------------------------------------------------------
const instruction = new Table({
  legacy_uid: integer,
  name: text,
  comment: text,
  status: text,
  nr_of_allocations: integer,
  nr_completed: integer,
  required_completed_date: text,
  account_id: text,
});
const instruction_asset_allocation = new Table(
  { instruction_id: text, asset_id: text, is_completed: integer },
  { indexes: { by_instruction: ["instruction_id"] } },
);

// ---- my_inspections ----------------------------------------------------------
const inspection_activity = new Table(
  { legacy_uid: integer, asset_id: text, instruction_id: text, grading_id: text, inspection_date: text, created_by: text },
  { indexes: { by_date: ["inspection_date"] } },
);
const inspection_value = new Table(
  {
    inspection_activity_id: text,
    inspection_id: text,
    inspection_drop_down_option_id: text,
    grading_id: text,
    text_value: text,
    decimal_value: real,
    date_value: text,
    display_value: text,
    is_current: integer,
    sort_order: integer,
  },
  { indexes: { by_activity: ["inspection_activity_id"] } },
);
const inspection_image = new Table(
  { inspection_value_id: text, thumbnail_path: text, storage_path: text, created_at: text },
  { indexes: { by_value: ["inspection_value_id"] } },
);

// ---- open_incidents, my_incidents -------------------------------------------
const incident = new Table({
  reference: integer,
  incident_date: text,
  status: text,
  completed_at: text,
  comment: text,
  location_id: text,
  incident_type_id: text,
  created_by: text,
});
const incident_note = new Table(
  { incident_id: text, body: text, created_at: text, created_by: text },
  { indexes: { by_incident: ["incident_id"] } },
);
const incident_image = new Table(
  { incident_id: text, incident_note_id: text, thumbnail_path: text, storage_path: text, created_at: text },
  { indexes: { by_incident: ["incident_id"] } },
);

// ---- open_services -----------------------------------------------------------
const organisation = new Table({ name: text });
const service = new Table({
  reference: integer,
  service_type: text,
  due_date: text,
  is_completed: integer,
  completed_date: text,
  invoice_nr: text,
  total_part_cost: real,
  total_labour_cost: real,
  total_cost: real,
  comment: text,
  asset_id: text,
  supplier_id: text,
});

// ---- my_stock ----------------------------------------------------------------
const transfer_main = new Table({
  reference: integer,
  transfer_type: text,
  transfer_date: text,
  from_storage_area_id: text,
  to_storage_area_id: text,
  comment: text,
  created_by: text,
});
const transfer_item = new Table({ transfer_id: text, item_id: text, qty: real });
const work_order = new Table({ reference: integer, order_date: text, storage_area_id: text, comment: text, created_by: text });
const work_order_item = new Table({ work_order_id: text, item_id: text, qty: real, is_return: integer, transaction_date: text });
const stock_take = new Table({ reference: integer, take_date: text, storage_area_id: text, comment: text, created_by: text });
const stock_take_item = new Table({ stock_take_id: text, item_id: text, counted_qty: real, adjustment_qty: real });
const load = new Table({
  reference: integer,
  load_type: text,
  load_date: text,
  driver: text,
  vehicle_reg_nr: text,
  comment: text,
  created_by: text,
});

// ---- Local-only --------------------------------------------------------------
// One row per Save. insertOnly: the row is never stored locally; it only
// rides in the Save's upload transaction, where uploadData() reads it.
export const OUTBOX = "outbox";
const outbox = new Table({ command_id: text, command: text, payload: text, captured_at: text }, { insertOnly: true });

// Saves the server rejected, until the user fixes or discards them.
const needs_attention = new Table(
  { command_id: text, command: text, payload: text, messages: text, failed_at: text },
  { localOnly: true },
);

// Photo files on the phone. id = the photo id that names the file
// (`<user id>/<photo id>.jpg`). Photos taken here are kept until their save
// is confirmed; the table is also the thumbnail cache for synced photos.
const photo_file = new Table(
  {
    bucket: text,
    storage_path: text,
    thumbnail_path: text,
    local_uri: text,
    thumb_uri: text,
    mime_type: text,
    size_bytes: integer,
    uploaded: integer,
    // 1 = taken on this phone; 0 = a downloaded thumbnail of a synced photo.
    taken_here: integer,
    created_at: text,
  },
  { localOnly: true, indexes: { by_path: ["storage_path"] } },
);

// app_time_zone and the last successful sync time.
const app_setting = new Table({ key: text, value: text }, { localOnly: true, indexes: { by_key: ["key"] } });

export const AppSchema = new Schema({
  location,
  asset,
  asset_type,
  grading,
  colour_container,
  inspection_allocation,
  inspection,
  inspection_drop_down_option,
  inspection_rule,
  feedback,
  inspection_cumulative_value,
  quality_parameter,
  incident_type,
  storage_area,
  item,
  profiles,
  mobile_app_config,
  user_masterdata_roles,
  instruction,
  instruction_asset_allocation,
  inspection_activity,
  inspection_value,
  inspection_image,
  incident,
  incident_note,
  incident_image,
  organisation,
  service,
  transfer_main,
  transfer_item,
  work_order,
  work_order_item,
  stock_take,
  stock_take_item,
  load,
  outbox,
  needs_attention,
  photo_file,
  app_setting,
});

export type Database = (typeof AppSchema)["types"];
