// Local reads shared by more than one screen.

// Location Status: Off when the location has a not-completed incident whose
// type disables_location (the same rule as the location_status view).
export const LOCATION_STATUS_SQL = `
  SELECT l.id, l.name,
         EXISTS (
           SELECT 1 FROM incident i JOIN incident_type t ON t.id = i.incident_type_id
            WHERE i.location_id = l.id AND i.status != 'completed' AND t.disables_location = 1
         ) AS is_off
    FROM location l
   WHERE l.active = 1 AND l.is_asset_manager = 1
   ORDER BY l.name COLLATE NOCASE`;

export const OFF_COUNT_SQL = `SELECT count(*) AS n FROM (${LOCATION_STATUS_SQL}) WHERE is_off = 1`;

// My open instructions (INS-R07), by due date then legacy_uid.
export const OPEN_INSTRUCTIONS_SQL = `
  SELECT id, legacy_uid, name, comment, status, nr_of_allocations, nr_completed, required_completed_date
    FROM instruction
   WHERE status != 'completed' AND account_id = ?
   ORDER BY required_completed_date, legacy_uid`;

export const ACTIVE_LOCATIONS_SQL =
  "SELECT id, name FROM location WHERE active = 1 AND is_asset_manager = 1 ORDER BY name COLLATE NOCASE";

export const SERVICE_TYPE_LABELS: Record<string, string> = {
  scheduled_maintenance: "Scheduled maintenance",
  repair: "Repair",
};
