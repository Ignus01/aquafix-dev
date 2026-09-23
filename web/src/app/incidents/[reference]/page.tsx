import { redirect } from "next/navigation";

// The "View incident" link in notification emails is
// `{app_url}/incidents/{reference}` (EML-R07). It forwards to the report; the
// middleware sends signed-out users to /login first and back afterwards.
export default async function IncidentLinkPage(props: PageProps<"/incidents/[reference]">) {
  const { reference } = await props.params;
  redirect(`/admin/incidents/${encodeURIComponent(reference)}`);
}
