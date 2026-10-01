import { getAppTimeZone, listOpenServices } from "../../admin/services/actions";
import { Header } from "../ui";
import { ServiceList } from "./service-list";

export const metadata = { title: "Services · AquaFix" };

// Service_Overview_PWA: open services, soonest due first.
export default async function ServicesPage() {
  const [services, timeZone] = await Promise.all([listOpenServices(), getAppTimeZone()]);
  return (
    <>
      <Header title="Services" backHref="/m" />
      <ServiceList services={services} timeZone={timeZone} />
    </>
  );
}
