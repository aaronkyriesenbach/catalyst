export const monitoringNamespace = "monitoring";

// The operator derives each Service name from the resource kind and this name.
export const victoriaFullname = "vm";

const serviceUrl = (service: string, port: number) =>
  `http://${service}-${victoriaFullname}.${monitoringNamespace}.svc:${port}`;

export const vmSingleUrl = serviceUrl("vmsingle", 8428);
export const vlSingleUrl = serviceUrl("vlsingle", 9428);
export const vtSingleUrl = serviceUrl("vtsingle", 10428);

export const grafanaServiceName = `${victoriaFullname}-grafana`;
