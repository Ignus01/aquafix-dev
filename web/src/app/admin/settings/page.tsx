import { requireRole } from "@/lib/auth";
import { odataConfigured } from "@/lib/odata/client";
import { PageHeader } from "../page-header";
import { getSettings, listEmailLog, listSettingsAudit } from "./actions";
import { SettingsView } from "./settings-view";

// The data migration server action runs under this route's time limit.
export const maxDuration = 300;

// Admin → System Settings (spec/incidents/system-settings.md, Part 2).
// Replaces Main.ControlPanel and the "Brevo Emails" tab of Main.Admin_Overview.
export default async function SettingsPage() {
  await requireRole(["system_admin"]);
  const odataReady = odataConfigured();
  const [settings, emailLog, audit] = await Promise.all([
    getSettings(),
    listEmailLog(),
    listSettingsAudit(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Setup / System Settings" title="System Settings" />
      <SettingsView settings={settings} emailLog={emailLog} audit={audit} odataConfigured={odataReady} />
    </div>
  );
}
